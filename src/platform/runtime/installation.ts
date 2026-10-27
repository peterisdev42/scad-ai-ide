import { anonymousGitHubRequest, type GitHubRequest } from '../github/client'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { pipeline } from 'node:stream/promises'
import * as tar from 'tar'
import * as yauzl from 'yauzl'
import { fileCandidate, probe } from './discovery'
import { matchesRuntimeBuild, type RuntimeBuild, type RuntimeSystem } from './releases'
import { requestGitHub } from '../github/errors'

export interface InstallProgress {
    buildId?: number
    label?: string
    message: string
    percent?: number
}

const maxArchiveSize = 1024 * 1024 * 1024
const maxExtractedSize = 4 * maxArchiveSize

export function managedDirectory(root: string, system: RuntimeSystem): string {
    return path.join(root, `${system.platform}-${system.architecture}`)
}

async function managedInstallDirectories(root: string, system: RuntimeSystem): Promise<string[]> {
    const directory = managedDirectory(root, system)
    try {
        const entries = await readdir(directory, { withFileTypes: true })
        return entries.filter((entry) => entry.isDirectory() && /^(?:\d+|local-[a-f0-9]{64})$/.test(entry.name)).map((entry) => path.join(directory, entry.name))
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return []
        }
        throw error
    }
}

export async function managedRuntimePaths(root: string, system: RuntimeSystem): Promise<string[]> {
    return (await managedInstallDirectories(root, system)).map((directory) => path.join(directory, 'bin', system.platform === 'win32' ? 'openscad.exe' : 'openscad'))
}

export interface InstalledRuntimeBuild {
    id: number
    directories: string[]
}

export async function installedRuntimeBuilds(root: string, system: RuntimeSystem, builds: RuntimeBuild[]): Promise<InstalledRuntimeBuild[]> {
    const packages = await Promise.all(
        (await managedInstallDirectories(root, system)).map(async (directory) => {
            let tag: string | undefined
            try {
                const metadata: unknown = JSON.parse(await readFile(path.join(directory, 'build-info.json'), 'utf8'))
                if (metadata && typeof metadata === 'object' && 'tag' in metadata && typeof metadata.tag === 'string') {
                    tag = metadata.tag.replace(/^openscad-/, 'openscad-cli-')
                }
            } catch {
                // Older or damaged installs can still be identified by the asset ID directory.
            }
            return { directory, assetId: path.basename(directory), tag }
        }),
    )
    return builds.flatMap((build) => {
        const directories = packages.filter((entry) => entry.assetId === String(build.id) || entry.tag === build.tag).map((entry) => entry.directory)
        return directories.length ? [{ id: build.id, directories }] : []
    })
}

function inside(root: string, file: string): boolean {
    const relative = path.relative(root, file)
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function validateEntry(root: string, name: string): void {
    if (name.includes('\\') || path.posix.isAbsolute(name) || path.win32.isAbsolute(name) || name.split('/').includes('..') || !inside(root, path.resolve(root, name))) {
        throw new Error(`Unsafe archive path: ${name}`)
    }
}

export async function extractRuntimeArchive(archive: string, directory: string): Promise<void> {
    await mkdir(directory, { recursive: true })
    let size = 0
    if (archive.endsWith('.tar.gz')) {
        let validationError: unknown
        // Validate the complete archive before extraction, including framework symlinks.
        await tar.t({
            file: archive,
            strict: true,
            onReadEntry: (entry) => {
                try {
                    validateEntry(directory, entry.path)
                    size += entry.size
                    if (size > maxExtractedSize || !['File', 'Directory', 'SymbolicLink', 'Link', 'ExtendedHeader', 'GlobalExtendedHeader'].includes(entry.type)) {
                        throw new Error('Unsupported or oversized runtime archive.')
                    }
                    if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
                        const base = entry.type === 'Link' ? directory : path.dirname(path.resolve(directory, entry.path))
                        if (!entry.linkpath || entry.linkpath.includes('\\') || path.isAbsolute(entry.linkpath) || path.win32.isAbsolute(entry.linkpath) || !inside(directory, path.resolve(base, entry.linkpath))) {
                            throw new Error('Runtime archive contains an external link.')
                        }
                    }
                } catch (error) {
                    validationError ??= error
                }
            },
        })
        if (validationError) {
            throw validationError
        }
        await tar.x({ file: archive, cwd: directory, strict: true, preservePaths: false })
        return
    }
    if (!archive.endsWith('.zip')) {
        throw new Error('Unsupported runtime archive format.')
    }
    await new Promise<void>((resolve, reject) => {
        yauzl.open(archive, { lazyEntries: true, strictFileNames: true }, (error, zip) => {
            if (error || !zip) {
                reject(error ?? new Error('Cannot open runtime archive.'))
                return
            }
            const fail = (error: unknown) => {
                zip.close()
                reject(error)
            }
            zip.on('error', fail)
            zip.on('end', resolve)
            zip.on('entry', (entry: yauzl.Entry) => {
                void (async () => {
                    validateEntry(directory, entry.fileName)
                    const mode = entry.externalFileAttributes >>> 16
                    size += entry.uncompressedSize
                    // Windows packages contain ordinary files and directories, never links.
                    if ((mode & 0o170000) === 0o120000 || size > maxExtractedSize) {
                        throw new Error('Unsupported link or oversized ZIP archive.')
                    }
                    const target = path.join(directory, entry.fileName)
                    if (entry.fileName.endsWith('/')) {
                        await mkdir(target, { recursive: true })
                    } else {
                        await mkdir(path.dirname(target), { recursive: true })
                        const stream = await new Promise<import('node:stream').Readable>((resolve, reject) => zip.openReadStream(entry, (error, stream) => (error || !stream ? reject(error ?? new Error('Invalid ZIP entry.')) : resolve(stream))))
                        await pipeline(stream, createWriteStream(target, { flags: 'wx', mode: mode & 0o777 || 0o644 }))
                    }
                    zip.readEntry()
                })().catch(fail)
            })
            zip.readEntry()
        })
    })
}

export interface InstallOptions {
    signal?: AbortSignal
    progress?: (value: InstallProgress) => void
    request?: GitHubRequest
    check?: typeof probe
    onRemoved?: () => Promise<void>
}

interface ArchiveSource {
    key?: string
    buildId?: number
    format: '.zip' | '.tar.gz'
    acquire: (archive: string, signal: AbortSignal, report: (message: string, percent?: number) => void) => Promise<string>
}

async function writeArchive(chunks: AsyncIterable<Uint8Array>, archive: string, size: number, signal: AbortSignal, progress: (percent: number) => void): Promise<string> {
    if (size > maxArchiveSize) {
        throw new Error('Runtime archive is too large.')
    }
    const file = await open(archive, 'wx')
    const hash = createHash('sha256')
    let received = 0
    let lastPercent = -1
    try {
        for await (const chunk of chunks) {
            signal.throwIfAborted()
            received += chunk.length
            if (received > maxArchiveSize || (size > 0 && received > size)) {
                throw new Error('Runtime archive has an unexpected size.')
            }
            hash.update(chunk)
            await file.writeFile(chunk)
            const percent = size > 0 ? Math.floor((received / size) * 100) : 0
            if (percent !== lastPercent) {
                progress(percent)
                lastPercent = percent
            }
        }
    } finally {
        await file.close()
    }
    if (size > 0 && received !== size) {
        throw new Error('Runtime archive is incomplete.')
    }
    signal.throwIfAborted()
    return hash.digest('hex')
}

async function installPackage(root: string, system: RuntimeSystem, source: ArchiveSource, options: InstallOptions): Promise<string> {
    const check = options.check ?? probe
    const signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(10 * 60 * 1000)])
    signal.throwIfAborted()
    const report = (message: string, percent?: number) => options.progress?.({ buildId: source.buildId, message, percent })
    const directory = managedDirectory(root, system)
    await mkdir(directory, { recursive: true })
    const executableName = system.platform === 'win32' ? 'openscad.exe' : 'openscad'
    const isUsable = async (key: string): Promise<boolean> => {
        try {
            const executable = path.join(directory, key, 'bin', executableName)
            await stat(executable)
            await check(fileCandidate(executable, 'managed'))
            return true
        } catch {
            return false
        }
    }
    if (source.key && (await isUsable(source.key))) {
        return path.join(directory, source.key, 'bin', executableName)
    }
    const staging = await mkdtemp(path.join(directory, '.install-'))
    let preserveBackup = false
    try {
        const archive = path.join(staging, `runtime${source.format}`)
        const checksum = await source.acquire(archive, signal, report)
        const key = source.key ?? `local-${checksum}`
        const destination = path.join(directory, key)
        const executable = path.join(destination, 'bin', executableName)
        if (!source.key && (await isUsable(key))) {
            return executable
        }
        report('Extracting…')
        signal.throwIfAborted()
        const extracted = path.join(staging, 'extracted')
        await extractRuntimeArchive(archive, extracted)
        // Identify the package by its contents, so renamed downloads can be imported.
        const packages = (await readdir(extracted, { withFileTypes: true })).filter((entry) => entry.isDirectory() && matchesRuntimeBuild(entry.name + source.format, system))
        if (packages.length !== 1) {
            throw new Error('The archive must contain one OpenSCAD CLI package matching this system and architecture.')
        }
        const packageRoot = path.join(extracted, packages[0].name)
        const stagedExecutable = path.join(packageRoot, 'bin', executableName)
        if (!inside(await realpath(packageRoot), await realpath(stagedExecutable))) {
            throw new Error('Runtime executable is outside its package.')
        }
        signal.throwIfAborted()
        report('Checking runtime…')
        await check(fileCandidate(stagedExecutable, 'managed'))
        signal.throwIfAborted()
        const backup = path.join(staging, 'previous')
        let replaced = false
        try {
            await stat(destination)
            await rename(destination, backup)
            replaced = true
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error
            }
        }
        let published = false
        try {
            await rename(packageRoot, destination)
            published = true
            // Verify again at the final location before keeping the installation.
            await check(fileCandidate(executable, 'managed'))
            signal.throwIfAborted()
        } catch (error) {
            try {
                if (published) {
                    await rm(destination, { recursive: true, force: true })
                }
                if (replaced) {
                    await rename(backup, destination)
                }
            } catch (rollbackError) {
                preserveBackup = true
                throw new Error(`Could not restore the previous runtime; recovery files remain at ${staging}`, { cause: rollbackError })
            }
            throw error
        }
        return executable
    } finally {
        if (!preserveBackup) {
            // Removes the copied/downloaded archive and any failed extraction or backup.
            await rm(staging, { recursive: true, force: true })
        }
    }
}

export async function installRuntimeBuild(root: string, system: RuntimeSystem, build: RuntimeBuild, options: InstallOptions = {}): Promise<string> {
    if (!Number.isSafeInteger(build.id) || build.id <= 0 || !matchesRuntimeBuild(build.name, system)) {
        throw new Error('This build does not match the current system and architecture.')
    }
    options.signal?.throwIfAborted()
    const installed = await installedRuntimeBuilds(root, system, [build])
    const directories = new Set([path.join(managedDirectory(root, system), String(build.id)), ...installed.flatMap((entry) => entry.directories)])
    if (installed.length) {
        options.progress?.({ buildId: build.id, message: 'Removing existing runtime…' })
    }
    for (const directory of directories) {
        options.signal?.throwIfAborted()
        await rm(directory, { recursive: true, force: true })
    }
    if (installed.length) {
        await options.onRemoved?.()
    }
    options.signal?.throwIfAborted()
    const request = options.request ?? anonymousGitHubRequest
    return installPackage(
        root,
        system,
        {
            key: String(build.id),
            buildId: build.id,
            format: build.name.endsWith('.zip') ? '.zip' : '.tar.gz',
            acquire: async (archive, signal, report) => {
                report('Downloading…', 0)
                const response = await requestGitHub(request, build.downloadUrl, { signal }, 'GitHub runtime download')
                if (!response.body) {
                    throw new Error(`GitHub runtime download returned no response body (HTTP ${response.status}).\nRequest: ${build.downloadUrl}`)
                }
                const hash = await writeArchive(response.body, archive, build.size, signal, (percent) => report('Downloading…', percent))
                if (build.checksumUrl) {
                    report('Verifying download…')
                    const response = await requestGitHub(request, build.checksumUrl, { signal }, 'GitHub checksum download')
                    const checksum = (await response.text()).trim().split(/\s+/)[0]
                    if (!/^[a-f0-9]{64}$/i.test(checksum) || hash !== checksum.toLowerCase()) {
                        throw new Error('Runtime checksum verification failed.')
                    }
                }
                return hash
            },
        },
        options,
    )
}

export async function installRuntimeArchive(root: string, system: RuntimeSystem, sourceFile: string, options: InstallOptions = {}): Promise<string> {
    const name = sourceFile.toLowerCase()
    const format = name.endsWith('.zip') ? '.zip' : name.endsWith('.tar.gz') ? '.tar.gz' : undefined
    if (!format) {
        throw new Error('Select a .zip or .tar.gz OpenSCAD CLI archive.')
    }
    return installPackage(
        root,
        system,
        {
            format,
            acquire: async (archive, signal, report) => {
                const info = await stat(sourceFile)
                if (!info.isFile()) {
                    throw new Error('Select an OpenSCAD CLI archive file.')
                }
                report('Copying archive…', 0)
                async function* chunks() {
                    yield* createReadStream(sourceFile, { signal })
                }
                return writeArchive(chunks(), archive, info.size, signal, (percent) => report('Copying archive…', percent))
            },
        },
        options,
    )
}
