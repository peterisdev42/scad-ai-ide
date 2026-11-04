import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, lstat, realpath, rm } from 'node:fs/promises'
import * as path from 'node:path'
import type { InstalledLibrary } from '../../core/libraries/types'
import { id, repository, sha, relativeRoot } from '../../core/libraries/validation'
import { atomicJson, canonicalPath, exists, readJson, withLock } from './files'
export function sameInventory(a: Record<string, string>, b: Record<string, string>) {
    return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([key, hash]) => b[key] === hash)
}
export async function inventory(directory: string) {
    const files: Record<string, string> = {}
    let sizeBytes = 0
    async function walk(dir: string) {
        for (const item of await readdir(dir, { withFileTypes: true })) {
            const file = path.join(dir, item.name)
            const info = await lstat(file)
            if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error('Store contains an unsupported link or special file.')
            if (info.isDirectory()) await walk(file)
            else {
                const hash = createHash('sha256')
                for await (const chunk of createReadStream(file)) hash.update(chunk)
                files[path.relative(directory, file).split(path.sep).join('/')] = hash.digest('hex')
                sizeBytes += info.size
            }
        }
    }
    await walk(directory)
    return { files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), sizeBytes }
}
export class GlobalLibraryStore {
    issues: { path: string; message: string }[] = []
    readonly root: string
    constructor(globalStorage: string) {
        this.root = path.join(canonicalPath(globalStorage), 'libraries', 'v1')
    }
    exclusive<T>(work: () => Promise<T>, signal?: AbortSignal) {
        return withLock(path.join(this.root, '.mutation-lock'), work, signal)
    }
    directory(libraryId: string, repositoryUrl: string, commit: string) {
        return path.join(this.root, 'store', id(libraryId), createHash('sha256').update(repository(repositoryUrl).url.toLowerCase()).digest('hex'), sha(commit))
    }
    async find(libraryId: string, repositoryUrl: string, commit: string): Promise<InstalledLibrary | undefined> {
        const directory = this.directory(libraryId, repositoryUrl, commit)
        if (!(await exists(directory))) return undefined
        // Metadata cannot redirect file access outside its derived immutable package directory.
        if (path.resolve(await realpath(directory)) !== path.resolve(directory) || (await lstat(path.join(directory, 'source'))).isSymbolicLink()) throw new Error('Store directory was replaced by a link.')
        const data = await readJson(path.join(directory, 'metadata.json'))
        if (data.libraryId !== libraryId || repository(data.repositoryUrl).url.toLowerCase() !== repository(repositoryUrl).url.toLowerCase() || data.commit !== sha(commit) || !Array.isArray(data.versions) || !data.files || typeof data.files !== 'object') throw new Error('Corrupted library metadata.')
        for (const [name, hash] of Object.entries(data.files)) {
            relativeRoot(name)
            if (!/^[a-f0-9]{64}$/.test(String(hash))) throw new Error('Corrupted file inventory.')
        }
        return { ...data, sourcePath: path.join(directory, 'source'), integrity: 'unknown' }
    }
    async verify(libraryId: string, repositoryUrl: string, commit: string) {
        try {
            const data = await this.find(libraryId, repositoryUrl, commit)
            if (!data) return false
            const actual = await inventory(data.sourcePath)
            return actual.sizeBytes === data.sizeBytes && sameInventory(actual.files, data.files)
        } catch {
            return false
        }
    }
    async list(): Promise<(InstalledLibrary & { status: 'ready' | 'corrupted' })[]> {
        const result: (InstalledLibrary & { status: 'ready' | 'corrupted' })[] = []
        this.issues = []
        const store = path.join(this.root, 'store')
        let previous: { packages?: InstalledLibrary[] } = {}
        try {
            previous = await readJson(path.join(this.root, 'index.json'), {})
        } catch {
            this.issues.push({ path: path.join(this.root, 'index.json'), message: 'Unreadable index; rebuilt from package metadata.' })
        }
        for (const entity of Array.isArray(previous.packages) ? previous.packages : []) {
            try {
                const directory = this.directory(entity.libraryId, entity.repositoryUrl, entity.commit)
                if (!(await exists(directory))) this.issues.push({ path: directory, message: 'Missing cached entity formerly recorded in the index. Restore Dependencies to recover it.' })
            } catch {
                /* Index paths and identities are never trusted. */
            }
        }
        if (!(await exists(store))) return result
        if ((await lstat(store)).isSymbolicLink() || path.resolve(await realpath(store)) !== path.resolve(store)) throw new Error('Unsafe global Store root.')
        for (const library of await readdir(store, { withFileTypes: true })) {
            if (!library.isDirectory()) continue
            for (const repo of await readdir(path.join(store, library.name), { withFileTypes: true })) {
                if (!repo.isDirectory()) continue
                for (const commit of await readdir(path.join(store, library.name, repo.name), { withFileTypes: true })) {
                    if (!commit.isDirectory()) continue
                    try {
                        const raw = await readJson(path.join(store, library.name, repo.name, commit.name, 'metadata.json'))
                        const derived = this.directory(library.name, raw.repositoryUrl, commit.name)
                        if (derived !== path.join(store, library.name, repo.name, commit.name)) throw new Error('Store identity does not match its directory.')
                        const data = await this.find(library.name, raw.repositoryUrl, commit.name)
                        if (data) result.push({ ...data, status: (await this.verify(library.name, raw.repositoryUrl, commit.name)) ? 'ready' : 'corrupted' })
                    } catch (error) {
                        this.issues.push({ path: path.join(store, library.name, repo.name, commit.name), message: `Unreadable or orphaned entity: ${String(error)}. Restore from its project lockfile to repair.` })
                    }
                }
            }
        }
        await atomicJson(path.join(this.root, 'index.json'), { version: 1, packages: result })
        return result
    }
    /** Caller must hold exclusive(), recheck references and obtain host confirmation. */
    async removeChecked(libraryId: string, repositoryUrl: string, commit: string) {
        const data = await this.find(libraryId, repositoryUrl, commit)
        if (!data) return
        const directory = this.directory(libraryId, repositoryUrl, commit)
        if (path.resolve(await realpath(directory)) !== path.resolve(directory)) throw new Error('Unsafe Store deletion.')
        await rm(directory, { recursive: true })
    }
}
