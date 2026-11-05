import { repository } from '../../core/libraries/validation'
import type { InstalledLibrary } from '../../core/libraries/types'
import { GlobalLibraryStore } from './GlobalLibraryStore'
import { LibraryReferenceIndex } from './LibraryReferenceIndex'
export type CleanupMode = 'all' | 'unused'
const identity = (entity: InstalledLibrary) => JSON.stringify([entity.libraryId, repository(entity.repositoryUrl).url.toLowerCase(), entity.commit])
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
    async previewAll(mode: CleanupMode) {
        if (mode !== 'all' && mode !== 'unused') throw new Error('Invalid cache cleanup mode.')
        const installed = await this.store.list()
        const candidates: InstalledLibrary[] = []
        let protectedCount = 0
        for (const entity of installed) {
            if (mode === 'unused') {
                const references = await this.references.references(entity)
                if (references.projects.length || references.unavailable.length) { protectedCount++; continue }
            }
            candidates.push(entity)
        }
        return { candidates, protectedCount, bytes: candidates.reduce((sum, entity) => sum + entity.sizeBytes, 0) }
    }
    async removeAll(mode: CleanupMode, confirm: (plan: Awaited<ReturnType<LibraryGarbageCollector['previewAll']>>) => Promise<boolean>) {
        const plan = await this.store.exclusive(() => this.previewAll(mode))
        if (!plan.candidates.length || !(await confirm(plan))) return { removed: 0, protectedCount: plan.protectedCount }
        return this.store.exclusive(async () => {
            // Recheck references after confirmation in unused mode, and never
            // delete a version added after the preview in either mode.
            const current = await this.previewAll(mode)
            const approved = new Set(plan.candidates.map(identity))
            let removed = 0
            for (const entity of current.candidates) {
                if (!approved.has(identity(entity))) continue
                if (mode === 'unused') {
                    const references = await this.references.references(entity)
                    if (references.projects.length || references.unavailable.length) { current.protectedCount++; continue }
                }
                await this.store.removeChecked(entity.libraryId, entity.repositoryUrl, entity.commit)
                removed++
            }
            return { removed, protectedCount: current.protectedCount }
        })
    }
    private assertUnused(preview: { projects: string[]; unavailable: string[] }) {
        if (preview.projects.length || preview.unavailable.length) throw new Error(`Cannot delete: known project references or unreadable projects remain: ${[...preview.projects, ...preview.unavailable].join(', ')}`)
    }
}
