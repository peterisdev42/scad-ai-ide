import { latestCached, libraryIdentity } from '../../core/libraries/latestCached'
import type { RegistryLibrary } from '../../core/libraries/types'
import type { InstalledLibrary } from '../../core/libraries/types'
import { GlobalLibraryStore } from './GlobalLibraryStore'
import { LibraryReferenceIndex } from './LibraryReferenceIndex'
type Identity = Pick<InstalledLibrary, 'libraryId' | 'repositoryUrl' | 'commit'>
export class LibraryGarbageCollector {
    constructor(
        private readonly store: GlobalLibraryStore,
        private readonly references: LibraryReferenceIndex,
    ) {}
    async preview(entity: Identity) {
        const installed = await this.store.find(entity.libraryId, entity.repositoryUrl, entity.commit)
        if (!installed) throw new Error('Cached version no longer exists.')
        return { installed, ...(await this.references.references(entity)) }
    }
    async remove(entity: Identity, confirm: (preview: Awaited<ReturnType<LibraryGarbageCollector['preview']>>) => Promise<boolean>) {
        const preview = await this.preview(entity)
        this.assertUnused(preview)
        if (!(await confirm(preview))) return false
        return this.store.exclusive(async () => {
            const current = await this.preview(entity)
            this.assertUnused(current)
            await this.store.removeChecked(entity.libraryId, entity.repositoryUrl, entity.commit)
            return true
        })
    }
    async previewAll(keepLatest: boolean, registry: readonly RegistryLibrary[] = []) {
        const installed = await this.store.list()
        const groups = new Map<string, InstalledLibrary[]>()
        for (const entity of installed) {
            const key = libraryIdentity(entity)
            const versions = groups.get(key) ?? []
            versions.push(entity)
            groups.set(key, versions)
        }
        const retained = new Set<InstalledLibrary>()
        if (keepLatest) for (const versions of groups.values()) {
            const metadata = registry.find((library) => libraryIdentity({ libraryId: library.id, repositoryUrl: library.repositoryUrl }) === libraryIdentity(versions[0]))
            retained.add(latestCached(versions, metadata))
        }
        const candidates: InstalledLibrary[] = []
        let protectedCount = 0
        for (const entity of installed) {
            if (retained.has(entity)) continue
            const references = await this.references.references(entity)
            if (references.projects.length || references.unavailable.length) protectedCount++
            else candidates.push(entity)
        }
        return { candidates, retained: retained.size, protectedCount, bytes: candidates.reduce((sum, entity) => sum + entity.sizeBytes, 0) }
    }
    async removeAll(keepLatest: boolean, registry: readonly RegistryLibrary[], confirm: (plan: Awaited<ReturnType<LibraryGarbageCollector['previewAll']>>) => Promise<boolean>) {
        const plan = await this.store.exclusive(() => this.previewAll(keepLatest, registry))
        if (!plan.candidates.length || !(await confirm(plan))) return { removed: 0, retained: plan.retained, protectedCount: plan.protectedCount }
        return this.store.exclusive(async () => {
            // Re-plan after confirmation: references/latest versions may have changed.
            // Never delete a version added after the preview.
            const current = await this.previewAll(keepLatest, registry)
            const approved = new Set(plan.candidates.map((entity) => `${libraryIdentity(entity)}:${entity.commit}`))
            let removed = 0
            for (const entity of current.candidates) {
                if (!approved.has(`${libraryIdentity(entity)}:${entity.commit}`)) continue
                const references = await this.references.references(entity)
                if (references.projects.length || references.unavailable.length) { current.protectedCount++; continue }
                await this.store.removeChecked(entity.libraryId, entity.repositoryUrl, entity.commit)
                removed++
            }
            return { removed, retained: current.retained, protectedCount: current.protectedCount }
        })
    }
    private assertUnused(preview: { projects: string[]; unavailable: string[] }) {
        if (preview.projects.length || preview.unavailable.length) throw new Error(`Cannot delete: known project references or unreadable projects remain: ${[...preview.projects, ...preview.unavailable].join(', ')}`)
    }
}
