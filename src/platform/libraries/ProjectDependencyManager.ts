import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import { mkdir, readdir, readFile, writeFile, rename, rm, lstat, readlink } from 'node:fs/promises'
import type { Manifest, Lockfile, LockedDependency, LinkMode } from '../../core/libraries/types'
import { versionLabel } from '../../core/libraries/types'
import { parseManifest, parseLockfile, installLayout, repository, id, safePart } from '../../core/libraries/validation'
import { atomicFile, atomicJson, canonicalPath, exists, missing, ownedDirectory, readJson, withLock } from './files'
import { RegistryClient } from './RegistryClient'
import { GlobalLibraryStore, inventory, sameInventory } from './GlobalLibraryStore'
import { LibraryInstaller } from './LibraryInstaller'
import { LibraryLinker } from './LibraryLinker'
import { LibraryReferenceIndex } from './LibraryReferenceIndex'
interface MountRecord {
    source: string
    mode: LinkMode
    files?: Record<string, string>
}
export class ProjectDependencyManager {
    readonly references: LibraryReferenceIndex
    constructor(
        readonly store: GlobalLibraryStore,
        readonly registry: RegistryClient,
        readonly installer: LibraryInstaller,
        readonly linker = new LibraryLinker(),
        private readonly changed: (root: string) => void = () => {},
    ) {
        this.references = new LibraryReferenceIndex(store.root)
    }
    async read(project: string) {
        const directory = path.join(project, '.scad')
        const manifest = parseManifest(await readJson(path.join(directory, 'dependencies.json'), { manifestVersion: 1, dependencies: {} }))
        const lock = parseLockfile(await readJson(path.join(directory, 'dependencies.lock.json'), { lockVersion: 1, dependencies: {} }))
        return { manifest, lock }
    }
    async install(project: string, libraryId: string, version: string, signal?: AbortSignal, progress?: (message: string) => void) {
        id(libraryId)
        const library = await this.registry.getLibrary(libraryId)
        if (library.validationError) throw new Error(library.validationError)
        if (library.sync.status === 'error') throw new Error('Registry synchronization failed for this library. Restore an existing lockfile instead.')
        const resolved = library.versions.find((v) => versionLabel(v) === version)
        if (!resolved) throw new Error('Select an exact registry tag or snapshot commit.')
        const mount = installLayout(library, resolved)
        const dependency: LockedDependency = { source: { provider: repository(library.repositoryUrl).provider, repositoryUrl: repository(library.repositoryUrl).url }, resolved: { kind: resolved.kind, tag: resolved.tag, commit: resolved.commit }, mount: { name: mount.includeName, includeRoot: mount.includeRoot } }
        return this.mutate(
            project,
            async (manifest, lock) => {
                manifest.dependencies[libraryId] = { version }
                lock.dependencies[libraryId] = dependency
            },
            signal,
            progress,
        )
    }
    remove(project: string, libraryId: string, signal?: AbortSignal, progress?: (message: string) => void) {
        id(libraryId)
        return this.mutate(
            project,
            async (manifest, lock) => {
                delete manifest.dependencies[libraryId]
                delete lock.dependencies[libraryId]
            },
            signal,
            progress,
        )
    }
    restore(project: string, signal?: AbortSignal, progress?: (message: string) => void) {
        return this.mutate(
            project,
            async (manifest, lock) => {
                // A lockfile is authoritative; never silently re-resolve moved tags.
                if (!this.matches(manifest, lock)) throw new Error('Manifest and lockfile differ. Select an explicit version to reconcile them before restoring.')
            },
            signal,
            progress,
        )
    }
    private matches(manifest: Manifest, lock: Lockfile) {
        return Object.keys(manifest.dependencies).length === Object.keys(lock.dependencies).length && Object.entries(manifest.dependencies).every(([key, dep]) => !!lock.dependencies[key] && dep.version === versionLabel(lock.dependencies[key].resolved))
    }
    private async mutate(project: string, change: (manifest: Manifest, lock: Lockfile) => Promise<void>, signal?: AbortSignal, progress?: (message: string) => void) {
        project = canonicalPath(project)
        await ownedDirectory(project)
        const directory = path.join(project, '.scad')
        await ownedDirectory(directory)
        return this.store.exclusive(
            () =>
                withLock(
                    path.join(directory, '.dependency-lock'),
                    async () => {
                        await this.recover(directory)
                        const { manifest, lock } = await this.read(project)
                        await change(manifest, lock)
                        parseManifest(manifest)
                        parseLockfile(lock)
                        if (!this.matches(manifest, lock)) throw new Error('Manifest and lockfile differ. Reconcile every dependency before applying changes.')
                        await this.validateManagedMounts(directory)
                        const sources: Record<string, string> = {}
                        for (const [key, dep] of Object.entries(lock.dependencies)) {
                            const installed = await this.installer.installLocked(key, dep, signal, progress)
                            sources[dep.mount.name] = path.join(installed.sourcePath, dep.mount.includeRoot)
                        }
                        signal?.throwIfAborted()
                        progress?.('Preparing project links…')
                        const transaction = path.join(directory, '.dependency-transaction')
                        await mkdir(transaction)
                        try {
                            await mkdir(path.join(transaction, 'next'))
                            const mounts: Record<string, MountRecord> = {}
                            for (const [name, source] of Object.entries(sources)) {
                                const mode = await this.linker.create(source, path.join(transaction, 'next', name))
                                mounts[name] = { source, mode, ...(mode === 'copy' ? { files: (await inventory(source)).files } : {}) }
                            }
                            signal?.throwIfAborted()
                            // Snapshot files before the ready marker. Recovery treats a pre-ready transaction as disposable.
                            const files = ['dependencies.json', 'dependencies.lock.json', 'mounts.json']
                            const existed: string[] = []
                            for (const name of files)
                                if (await exists(path.join(directory, name))) {
                                    existed.push(name)
                                    await writeFile(path.join(transaction, name), await readFile(path.join(directory, name)))
                                }
                            const hadLib = await exists(path.join(directory, 'lib'))
                            await atomicJson(path.join(transaction, 'journal.json'), { version: 1, existed, hadLib })
                            if (hadLib) await rename(path.join(directory, 'lib'), path.join(transaction, 'previous'))
                            await rename(path.join(transaction, 'next'), path.join(directory, 'lib'))
                            await atomicJson(path.join(directory, 'dependencies.json'), manifest)
                            await atomicJson(path.join(directory, 'dependencies.lock.json'), lock)
                            await atomicJson(path.join(directory, 'mounts.json'), { version: 1, mounts })
                            await writeFile(path.join(transaction, 'committed'), '')
                        } catch (error) {
                            await this.recover(directory)
                            throw error
                        }
                        await this.recover(directory)
                        await this.references.register(project)
                        const ignore = path.join(project, '.gitignore')
                        let content = ''
                        try {
                            content = await readFile(ignore, 'utf8')
                        } catch (e) {
                            if (!missing(e)) throw e
                        }
                        const additions = ['.scad/lib/', '.scad/mounts.json', '.scad/.dependency-*'].filter((line) => !content.split(/\r?\n/).includes(line))
                        if (additions.length && (!(await exists(ignore)) || !(await lstat(ignore)).isSymbolicLink())) await atomicFile(ignore, content + (content && !content.endsWith('\n') ? '\n' : '') + additions.join('\n') + '\n')
                        this.changed(project)
                    },
                    signal,
                ),
            signal,
        )
    }
    private async validateManagedMounts(directory: string) {
        const lib = path.join(directory, 'lib')
        if (!(await exists(lib))) return
        if ((await lstat(lib)).isSymbolicLink()) throw new Error('Project library root must not be a link.')
        const records = await readJson(path.join(directory, 'mounts.json'), { version: 1, mounts: {} })
        if (records.version !== 1 || !records.mounts || typeof records.mounts !== 'object') throw new Error('Invalid mount ownership metadata.')
        for (const name of await readdir(lib)) {
            safePart(name)
            const record = records.mounts[name] as MountRecord | undefined
            const target = path.join(lib, name)
            if (!record || !path.isAbsolute(record.source) || !path.resolve(record.source).startsWith(path.join(this.store.root, 'store') + path.sep)) throw new Error(`Refusing to overwrite unmanaged directory: ${name}`)
            const info = await lstat(target)
            if (info.isSymbolicLink()) {
                const rawTarget = await readlink(target)
                const prefix = String.fromCharCode(92, 92, 63, 92) // Windows extended-length path prefix
                const linkedTarget = rawTarget.startsWith(prefix) ? rawTarget.slice(4) : rawTarget
                const actual = path.resolve(path.dirname(target), linkedTarget)
                const identity = (value: string) => (process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value))
                if (identity(record.source) !== identity(actual)) throw new Error(`Dependency link was changed outside the manager: ${name}`)
            } else if (record.mode !== 'copy' || !sameInventory((await inventory(target)).files, record.files ?? {})) throw new Error(`Dependency contains local modifications: ${name}. Move it aside before repairing.`)
        }
    }
    /** Idempotent rollback of interrupted project publication. */
    private async recover(directory: string) {
        const transaction = path.join(directory, '.dependency-transaction')
        if (!(await exists(transaction))) return
        if ((await lstat(transaction)).isSymbolicLink()) throw new Error('Unsafe dependency transaction directory.')
        if (!(await exists(path.join(transaction, 'committed')))) {
            const journal = await readJson(path.join(transaction, 'journal.json'), null)
            if (journal) {
                if (journal.version !== 1 || !Array.isArray(journal.existed) || journal.existed.some((n: string) => !['dependencies.json', 'dependencies.lock.json', 'mounts.json'].includes(n))) throw new Error('Invalid dependency recovery journal.')
                // next disappears only after the new lib has been published.
                if (await exists(path.join(transaction, 'previous'))) {
                    await rm(path.join(directory, 'lib'), { recursive: true, force: true })
                    await rename(path.join(transaction, 'previous'), path.join(directory, 'lib'))
                } else if (!journal.hadLib && !(await exists(path.join(transaction, 'next')))) await rm(path.join(directory, 'lib'), { recursive: true, force: true })
                for (const name of ['dependencies.json', 'dependencies.lock.json', 'mounts.json']) {
                    if (journal.existed.includes(name)) {
                        const data = await readFile(path.join(transaction, name), 'utf8')
                        await atomicJson(path.join(directory, name), JSON.parse(data))
                    } else await rm(path.join(directory, name), { force: true })
                }
            }
        }
        const completed = path.join(directory, `.dependency-completed-${randomUUID()}`)
        await rename(transaction, completed)
        await rm(completed, { recursive: true, force: true })
    }
    async list(project: string) {
        const { manifest, lock } = await this.read(project)
        const rows = []
        for (const key of new Set([...Object.keys(manifest.dependencies), ...Object.keys(lock.dependencies)])) {
            const dep = lock.dependencies[key]
            let status = !dep || manifest.dependencies[key]?.version !== versionLabel(dep.resolved) ? 'Lockfile Mismatch' : 'Ready'
            let mode: string = 'unknown'
            if (dep) {
                const target = path.join(project, '.scad', 'lib', dep.mount.name)
                const link = await this.linker.inspect(target)
                mode = link.mode
                const records = await readJson(path.join(project, '.scad', 'mounts.json'), { mounts: {} })
                const record = records.mounts?.[dep.mount.name]
                if (record?.mode === 'copy' && mode === 'unknown' && link.valid) mode = 'copy'
                if (status === 'Ready') {
                    if (!(await this.store.verify(key, dep.source.repositoryUrl, dep.resolved.commit))) status = 'Missing / Corrupted Store'
                    else if (!link.valid || !record || record.source !== path.join(this.store.directory(key, dep.source.repositoryUrl, dep.resolved.commit), 'source', dep.mount.includeRoot) || (mode !== 'copy' && link.target !== record.source)) status = 'Broken Link'
                    else if (mode === 'copy' && !sameInventory((await inventory(target)).files, record.files ?? {})) status = 'Modified Copy'
                }
            }
            rows.push({ id: key, repositoryUrl: dep?.source.repositoryUrl, version: manifest.dependencies[key]?.version, commit: dep?.resolved.commit, name: dep?.mount.name, status, mode })
        }
        if (await exists(path.join(project, '.scad', '.dependency-transaction'))) rows.forEach((row) => (row.status = 'Interrupted transaction — Restore to recover'))
        return rows
    }
}
