import { libraryEnvironment } from '../libraries/LibraryEnvironment'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, join, relative, delimiter } from 'node:path'
import { tmpdir } from 'node:os'
import { extractRuntimeArchive } from '../runtime/installation'
import { EXPORTER_COMMIT, EXPORTER_TAG } from '../../core/preview/types'
import { PREVIEW_LIMITS, readPreviewScene } from '../../core/preview/read'
import type { PreviewTimings } from '../../core/preview/performance'
import { readCliDependencies } from '../../core/formats/dependencies'
export const EXPORTER_SHA256 = '42ebdbe75f3d8bf25c61675f756c86206b6a14077a5ea078fad355babf69a14f'
export const EXPORTER_ASSET = 'openscad-preview-exporter-macos-arm64.tar.gz'
export const EXPORTER_URL = `https://github.com/peterisdev42/openscad-cli-builder/releases/download/${EXPORTER_TAG}/${EXPORTER_ASSET}`
export function assertExporterPlatform(platform = process.platform, arch = process.arch) {
    if (platform !== 'darwin' || arch !== 'arm64') throw new Error('Fast Preview requires Preview Exporter on macOS ARM64. Full Render is available on this platform.')
}
export const managedExporterPath = (root: string) => join(root, 'preview-exporter', EXPORTER_TAG, 'bin', 'openscad-preview-exporter')
export async function probeExporter(executable: string) {
    assertExporterPlatform()
    if (!isAbsolute(executable) || !/openscad-preview-exporter$/.test(executable)) throw new Error('Select the independent bin/openscad-preview-exporter wrapper, not a normal OpenSCAD CLI.')
    await access(executable, constants.X_OK)
    const root = await realpath(join(dirname(executable), '..')),
        binary = await realpath(join(root, 'OpenSCAD.app/Contents/MacOS/OpenSCAD'))
    if (relative(root, binary).startsWith('..')) throw new Error('Exporter binary is outside its package.')
    const info = JSON.parse(await readFile(join(root, 'build-info.json'), 'utf8'))
    if (info.preview_exporter !== true || info.preview_scene_schema !== 1 || info.commit !== EXPORTER_COMMIT || info.tag !== EXPORTER_TAG || info.target !== 'macos-arm64') throw new Error('Preview Exporter build provenance/version mismatch.')
    const file = await open(binary, 'r')
    const header = Buffer.alloc(8)
    try {
        await file.read(header, 0, 8, 0)
    } finally {
        await file.close()
    }
    if (header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(4) !== 0x100000c) throw new Error('Preview Exporter must be Mach-O ARM64.')
    const wrapper = await readFile(executable, 'utf8')
    if (!wrapper.includes('OpenSCAD.app/Contents/MacOS/OpenSCAD') || !wrapper.includes('"$@"')) throw new Error('Invalid Preview Exporter wrapper.')
    const version = await new Promise<string>((resolve, reject) => execFile(executable, ['--version'], { timeout: 5000, maxBuffer: 65536 }, (e, out, err) => (e ? reject(e) : resolve(out + err))))
    if (!version.includes('2026.11-RC0')) throw new Error('Unexpected Preview Exporter version.')
    return { executable, tag: info.tag as string, commit: info.commit as string, schemaVersion: 1 as const }
}
export async function discoverExporters(root: string, configured?: string) {
    assertExporterPlatform()
    const paths = [
        ...new Set([
            ...(configured ? [configured] : []),
            managedExporterPath(root),
            ...(process.env.PATH ?? '')
                .split(delimiter)
                .filter(Boolean)
                .map((p) => join(p, 'openscad-preview-exporter')),
        ]),
    ]
    const found: Awaited<ReturnType<typeof probeExporter>>[] = []
    for (const path of paths)
        try {
            found.push(await probeExporter(path))
        } catch (e) {
            if (path === configured) throw e
        }
    return found
}
export async function installExporter(root: string, signal?: AbortSignal, request: typeof fetch = fetch) {
    assertExporterPlatform()
    signal?.throwIfAborted()
    signal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10 * 60 * 1000)])
    const parent = join(root, 'preview-exporter')
    await mkdir(parent, { recursive: true })
    const staging = await mkdtemp(join(parent, '.install-'))
    let preserveStaging = false
    try {
        const checksumResponse = await request(EXPORTER_URL + '.sha256', { signal })
        if (!checksumResponse.ok) throw new Error(`Exporter checksum download failed: HTTP ${checksumResponse.status}`)
        const checksum = (await checksumResponse.text()).trim().split(/\s+/)[0]
        if (checksum !== EXPORTER_SHA256) throw new Error('Preview Exporter published SHA256 mismatch.')
        const response = await request(EXPORTER_URL, { signal })
        if (!response.ok || !response.body) throw new Error(`Exporter download failed: HTTP ${response.status}`)
        const archive = join(staging, 'exporter.tar.gz'),
            file = await open(archive, 'wx'),
            hash = createHash('sha256')
        let size = 0
        try {
            for await (const chunk of response.body) {
                signal?.throwIfAborted()
                size += chunk.byteLength
                if (size > 128 * 1048576) throw new Error('Exporter archive too large.')
                hash.update(chunk)
                await file.writeFile(chunk)
            }
        } finally {
            await file.close()
        }
        if (hash.digest('hex') !== EXPORTER_SHA256) throw new Error('Preview Exporter SHA256 verification failed.')
        const extracted = join(staging, 'extracted')
        await extractRuntimeArchive(archive, extracted)
        const packageRoot = join(extracted, 'openscad-preview-exporter-macos-arm64')
        await probeExporter(join(packageRoot, 'bin/openscad-preview-exporter'))
        signal?.throwIfAborted()
        const destination = join(parent, EXPORTER_TAG)
        try {
            return await probeExporter(managedExporterPath(root))
        } catch {
            /* Publish only into an empty, owned version directory. */
        }
        const backup = join(staging, 'previous')
        let replaced = false,
            published = false
        try {
            await rename(destination, backup)
            replaced = true
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        try {
            await rename(packageRoot, destination)
            published = true
            const installed = await probeExporter(managedExporterPath(root))
            signal?.throwIfAborted()
            return installed
        } catch (error) {
            try {
                if (published) await rm(destination, { recursive: true, force: true })
                if (replaced) await rename(backup, destination)
            } catch (rollbackError) {
                preserveStaging = true
                throw new Error(`Preview Exporter installation recovery files remain at ${staging}`, { cause: rollbackError })
            }
            throw error
        }
    } finally {
        if (!preserveStaging) await rm(staging, { recursive: true, force: true })
    }
}
async function exportPreparedScene(executable: string, source: string, cwd: string, parameters: Record<string, unknown> = {}, signal?: AbortSignal, sourcePath?: string, onLog?: (chunk: string) => void, onTimings?: (timings: PreviewTimings) => void) {
    const runtimeStarted = performance.now()
    await probeExporter(executable)
    const runtimeMs = performance.now() - runtimeStarted
    onTimings?.({ runtimeMs })
    signal?.throwIfAborted()
    const directory = await mkdtemp(join(tmpdir(), 'scad-exporter-'))
    try {
        const output = join(directory, 'model.csgp'),
            deps = join(directory, 'model.d')
        const args = ['--export-format=preview-scene', '-d', deps, '-o', output, ...Object.entries(parameters).flatMap(([k, v]) => ['-D', `${k}=${JSON.stringify(v)}`]), '-D', '$preview=true', '-']
        const started = performance.now()
        const env = await libraryEnvironment.getEnvironment(sourcePath ?? join(cwd, '__markdown__.scad'))
        await new Promise<void>((resolve, reject) => {
            const child = execFile(executable, args, { cwd, env, signal, timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 1048576 }, (error, _out, err) => (error ? reject(new Error(`Preview Exporter failed: ${err.trim() || error.message}`)) : resolve()))
            child.stderr?.on('data', (chunk) => onLog?.(String(chunk)))
            child.stdin?.on('error', () => {})
            child.stdin?.end(source)
        })
        const exporterMs = performance.now() - started,
            readStarted = performance.now()
        onTimings?.({ exporterMs })
        if ((await stat(output)).size > PREVIEW_LIMITS.bytes) throw new Error('Preview Exporter output exceeds byte budget.')
        const bytes = await readFile(output),
            readMs = performance.now() - readStarted
        signal?.throwIfAborted()
        const scene = readPreviewScene(bytes)
        scene.timings.exporterMs = exporterMs
        scene.timings.runtimeMs = runtimeMs
        scene.timings.readMs = readMs
        scene.timings.readParseMs += readMs
        onTimings?.(scene.timings)
        const dependencyStarted = performance.now()
        scene.dependencies = await readCliDependencies(deps, cwd, sourcePath ? [sourcePath] : [])
        const root = join(dirname(executable), '..')
        for (const dependency of [executable, join(root, 'build-info.json'), join(root, 'OpenSCAD.app/Contents/MacOS/OpenSCAD')]) {
            const info = await stat(dependency)
            scene.dependencies.push({ path: dependency, stamp: `${info.mtimeMs}:${info.size}` })
        }
        signal?.throwIfAborted()
        scene.timings.dependenciesMs = performance.now() - dependencyStarted
        onTimings?.(scene.timings)
        return scene
    } finally {
        const cleanupStarted = performance.now()
        await rm(directory, { recursive: true, force: true })
        onTimings?.({ cleanupMs: performance.now() - cleanupStarted })
    }
}

let exporterResolver: (() => Promise<string>) | undefined
export function configureExporterResolver(resolve: () => Promise<string>) {
    exporterResolver = resolve
}
export async function resolveExporterExecutable() {
    if (!exporterResolver) throw new Error('Preview Exporter is not configured. Install Preview Exporter or select Full Render.')
    return exporterResolver()
}

/** Export/validate official prepared products; no final-mesh evaluation. */
export async function runExporter(...args: Parameters<typeof exportPreparedScene>): Promise<Buffer> {
    const timings: PreviewTimings = {},
        report = (value: PreviewTimings) => {
            Object.assign(timings, value)
            args[7]?.(value)
        }
    const [executable, source, cwd, parameters, signal, sourcePath, onLog] = args
    const scene = await exportPreparedScene(executable, source, cwd, parameters, signal, sourcePath, onLog, report)
    Object.assign(scene.timings, timings)
    const started = performance.now(),
        buffer = Buffer.from(JSON.stringify(scene))
    report({ serializationMs: performance.now() - started })
    return buffer
}
