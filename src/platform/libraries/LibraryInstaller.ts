import { auditedLayouts } from '../../core/libraries/layouts'
import { mkdir, mkdtemp, open, readdir, rename, rm, stat } from 'node:fs/promises'
import * as path from 'node:path'
import type { Layout, LockedDependency } from '../../core/libraries/types'
import { archiveUrl, layout, repository, sha, id } from '../../core/libraries/validation'
import { GlobalLibraryStore, inventory } from './GlobalLibraryStore'
import { atomicJson, exists, ownedDirectory } from './files'
import { extractLibraryArchive } from './archive'
export class LibraryInstaller {
    constructor(
        readonly store: GlobalLibraryStore,
        private readonly request: typeof fetch = fetch,
    ) {}
    ensureInstalled(libraryId: string, dep: LockedDependency, signal?: AbortSignal, progress?: (message: string) => void) {
        return this.store.exclusive(() => this.installLocked(libraryId, dep, signal, progress), signal)
    }
    /** Internal transaction entry; caller holds Store exclusive lock through project commit. */
    async installLocked(libraryId: string, dep: LockedDependency, signal?: AbortSignal, progress?: (message: string) => void) {
        id(libraryId)
        sha(dep.resolved.commit)
        const repo = repository(dep.source.repositoryUrl)
        const mount: Layout = layout({ includeName: dep.mount.name, includeRoot: dep.mount.includeRoot })
        if (await this.store.verify(libraryId, repo.url, dep.resolved.commit)) {
            const cached = (await this.store.find(libraryId, repo.url, dep.resolved.commit))!
            await this.validateLayout(cached.sourcePath, libraryId, mount)
            const label = dep.resolved.tag ?? `snapshot:${dep.resolved.commit}`
            if (!cached.versions.includes(label)) {
                cached.versions.push(label)
                const { sourcePath: _sourcePath, ...metadata } = cached
                await atomicJson(path.join(path.dirname(cached.sourcePath), 'metadata.json'), metadata)
            }
            return cached
        }
        signal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5 * 60 * 1000)])
        signal.throwIfAborted()
        const stagingRoot = path.join(this.store.root, 'staging')
        await ownedDirectory(stagingRoot)
        const staging = await mkdtemp(path.join(stagingRoot, 'install-'))
        try {
            progress?.('Downloading commit archive…')
            const url = archiveUrl(repo.url, dep.resolved.commit)
            let requestUrl = url
            // Fetch handles only approved repository archive redirects, never arbitrary Registry URLs.
            let response = await this.request(url, { signal, redirect: 'manual' })
            for (let redirects = 0; response.status >= 300 && response.status < 400; redirects++) {
                if (redirects >= 3) throw new Error('Too many archive redirects.')
                const target = new URL(response.headers.get('location') ?? '', requestUrl)
                const hosts = repo.provider === 'github' ? ['github.com', 'codeload.github.com'] : ['codeberg.org']
                if (target.protocol !== 'https:' || target.username || target.password || target.port || !hosts.includes(target.hostname)) throw new Error('Unsafe archive redirect.')
                await response.body?.cancel()
                requestUrl = target.href
                response = await this.request(target, { signal, redirect: 'manual' })
            }
            if (!response.ok || !response.body) throw new Error(`Library archive: HTTP ${response.status}`)
            const expectedBytes = Number(response.headers.get('content-length'))
            if (expectedBytes > 128 * 1048576) throw new Error('Library archive exceeds 128 MiB.')
            const archive = path.join(staging, 'library.zip')
            const file = await open(archive, 'wx')
            let size = 0
            try {
                for await (const chunk of response.body) {
                    signal.throwIfAborted()
                    size += chunk.length
                    if (size > 128 * 1048576) throw new Error('Library archive exceeds 128 MiB.')
                    await file.writeFile(chunk)
                }
            } finally {
                await file.close()
            }
            if (expectedBytes > 0 && size !== expectedBytes) throw new Error('Library archive download is incomplete.')
            progress?.('Extracting and validating library…')
            const extracted = path.join(staging, 'extracted')
            await extractLibraryArchive(archive, extracted, signal)
            const roots = await readdir(extracted, { withFileTypes: true })
            if (roots.length !== 1 || !roots[0].isDirectory()) throw new Error('Expected one repository archive root.')
            const source = path.join(extracted, roots[0].name)
            await this.validateLayout(source, libraryId, mount)
            const contents = await inventory(source)
            if (!Object.keys(contents.files).some((f) => f.toLowerCase().endsWith('.scad'))) throw new Error('Library contains no OpenSCAD source files.')
            const data = { libraryId, repositoryUrl: repo.url, commit: sha(dep.resolved.commit), versions: [dep.resolved.tag ?? `snapshot:${dep.resolved.commit}`], installedAt: new Date().toISOString(), ...contents, integrity: 'unknown' as const }
            const prepared = path.join(staging, 'prepared')
            await mkdir(prepared)
            await rename(source, path.join(prepared, 'source'))
            await atomicJson(path.join(prepared, 'metadata.json'), data)
            const destination = this.store.directory(libraryId, repo.url, dep.resolved.commit)
            await ownedDirectory(path.dirname(destination))
            if (await exists(destination)) {
                // Keep damaged content for recovery; never mutate a published source tree in place.
                await rename(destination, path.join(stagingRoot, `corrupted-${libraryId}-${Date.now()}`))
            }
            signal.throwIfAborted()
            progress?.('Publishing global library…')
            await rename(prepared, destination)
            return (await this.store.find(libraryId, repo.url, dep.resolved.commit))!
        } finally {
            await rm(staging, { recursive: true, force: true })
        }
    }
    private async validateLayout(source: string, libraryId: string, mount: Layout) {
        if (!(await stat(path.join(source, mount.includeRoot))).isDirectory()) throw new Error('The selected commit has no declared includeRoot.')
        const audited = auditedLayouts.find((entry) => entry.id === libraryId && entry.includeName === mount.includeName && entry.includeRoot === mount.includeRoot)
        if (audited?.entryPoint && !(await exists(path.join(source, mount.includeRoot, audited.entryPoint)))) throw new Error('Audited library entry point is missing at this commit.')
        if (libraryId === 'bosl2' && !(await exists(path.join(source, mount.includeRoot, 'std.scad')))) throw new Error('BOSL2 std.scad entry point is missing at this commit.')
    }
}
