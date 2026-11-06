import { assertWorkspacePath } from '../../platform/WorkspacePaths'
import { randomUUID } from 'node:crypto'
import { CapabilityError, type CapabilityContext } from '../../core/capabilities/CapabilityTypes'
import { LibraryGarbageCollector } from '../../platform/libraries/LibraryGarbageCollector'
import * as vscode from 'vscode'
import { createHash } from 'node:crypto'
import { installLayout, repository } from '../../core/libraries/validation'
import { versionLabel, type RegistryLibrary, type InstalledLibrary } from '../../core/libraries/types'
import { libraryEnvironment } from '../../platform/libraries/LibraryEnvironment'
import { ProjectDependencyManager } from '../../platform/libraries/ProjectDependencyManager'
import { confirmLibraryCleanup, confirmLibraryBulkCleanup } from '../../platform/notifications'
export class LibraryService implements vscode.Disposable {
    protected readonly changed = new vscode.EventEmitter<void>()
    readonly onDidChange = this.changed.event
    private selected?: string
    private busy = false
    isBusy() { return this.busy }
    activity() { return { busy: this.busy, cancellable: this.busy && !!this.abort, message: this.message, error: this.error, bulkResult: this.bulkResult, trusted: vscode.workspace.isTrusted } }
    cancel() {
        if (!this.abort) return false
        this.abort.abort()
        return true
    }
    private message = ''
    protected error = ''
    private query = ''
    private bulkResult = ''
    private registryError = ''
    private registryBusy = false
    private registryLoaded = false
    private registryPending?: Promise<void>
    private registryLibraries: Awaited<ReturnType<ProjectDependencyManager['registry']['search']>> = []
    private subscriptions: vscode.Disposable[] = []
    constructor(readonly manager: ProjectDependencyManager, private readonly confirmBulkCleanup = confirmLibraryBulkCleanup) {
        this.subscriptions.push(
            libraryEnvironment.onDidChange(() => this.changed.fire()),
            vscode.window.onDidChangeActiveTextEditor(() => this.changed.fire()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.changed.fire()),
        )
    }
    async projects() {
        const roots = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath)
        const active = vscode.window.activeTextEditor?.document.uri
        if (active?.scheme === 'file') {
            const project = await libraryEnvironment.resolveProjectRoot(active.fsPath)
            if (project && !roots.includes(project)) roots.push(project)
        }
        return roots
    }
    async getState() {
        await this.restoreRegistryList()
        const projects = await this.projects()
        const active = vscode.window.activeTextEditor?.document.uri
        const activeProject = active?.scheme === 'file' ? await libraryEnvironment.resolveProjectRoot(active.fsPath) : undefined
        if (activeProject && projects.includes(activeProject)) this.selected = activeProject
        else if (!this.selected || !projects.includes(this.selected)) this.selected = projects[0]
        let projectDependencies: unknown[] = []
        let projectError = ''
        if (this.selected) {
            try {
                projectDependencies = await this.manager.list(this.selected)
            } catch (e) {
                projectError = String(e)
            }
        }
        const installed = await this.manager.store.list()
        const global = await Promise.all(installed.map(async ({ files: _files, ...p }) => ({ ...p, key: this.key(p), references: await this.manager.references.references(p) })))
        const registry = this.registryLibraries.map((library) => this.describeLibrary(library, installed))
        return { ...this.activity(), projects, selectedProject: this.selected, projectDependencies, projectError, global, globalIssues: this.manager.store.issues, registry, registryError: this.registryError, registryBusy: this.registryBusy, registryLoaded: this.registryLoaded, registryStatus: this.manager.registry.status, query: this.query }
    }
    /** The same installability and cached-version metadata powers GUI rows and Agent results. */
    private describeLibrary(l: RegistryLibrary, installed: InstalledLibrary[]) {
        let reason = ''
        let mount
        try {
            mount = installLayout(l)
        } catch (e) {
            reason = (e as Error).message
        }
        return {
            ...l,
            layout: mount,
            layoutError: reason,
            versions: l.versions.map((v) => {
                let layoutError = ''
                let resolvedLayout
                try {
                    resolvedLayout = installLayout(l, v)
                } catch (e) {
                    layoutError = (e as Error).message
                }
                return { ...v, label: versionLabel(v), layout: resolvedLayout, layoutError, cached: installed.some((p) => p.libraryId === l.id && repository(p.repositoryUrl).url.toLowerCase() === repository(l.repositoryUrl).url.toLowerCase() && p.commit === v.commit) }
            }),
        }
    }
    async search(query = '', id?: string) {
        const matches = id ? [await this.manager.registry.getLibrary(id)] : await this.manager.registry.search(query)
        const installed = await this.manager.store.list()
        return matches.map((library) => this.describeLibrary(library, installed))
    }
    private async restoreRegistryList() {
        const cached = await this.manager.registry.restoreCachedRegistry()
        if (cached) {
            this.registryLibraries = cached.libraries
            this.registryLoaded = true
        }
    }
    /** Refresh the catalog independently of project mutations, keeping cached rows interactive. */
    loadRegistry(): Promise<void> {
        if (this.registryPending) return this.registryPending
        this.registryBusy = true
        this.registryError = ''
        this.changed.fire()
        this.registryPending = (async () => {
            await this.restoreRegistryList()
            this.changed.fire()
            const registry = await this.manager.registry.getRegistry(true)
            this.registryLibraries = registry.libraries
            this.registryLoaded = true
            this.registryError = this.manager.registry.error
        })()
            .catch((error: unknown) => {
                this.registryError = error instanceof Error ? error.message : String(error)
            })
            .finally(() => {
                this.registryBusy = false
                this.registryPending = undefined
                this.changed.fire()
            })
        return this.registryPending
    }
    async clearRegistryCache() {
        await this.registryPending
        await this.manager.registry.clearMemoryCache()
        this.registryLibraries = []
        this.registryLoaded = false
        this.registryError = ''
    }
    private key(p: { libraryId: string; repositoryUrl: string; commit: string }) {
        return createHash('sha256')
            .update(JSON.stringify([p.libraryId, p.repositoryUrl, p.commit]))
            .digest('hex')
    }
    async execute(raw: unknown, context: CapabilityContext = { actor: 'gui' }) {
        if (!raw || typeof raw !== 'object') return
        const value = raw as Record<string, unknown>
        const action = value.action
        if (typeof action !== 'string' || !action.startsWith('libraries.')) return
        if (action === 'libraries.cancel') {
            return this.cancel()
        }
        if (action === 'libraries.refresh') return this.loadRegistry()
        if (this.busy) throw new CapabilityError('BUSY', 'A library operation is already running.', true)
        this.busy = true
        this.error = ''
        this.bulkResult = ''
        this.message = 'Loading libraries…'
        this.changed.fire()
        let removeCancellation: (() => void) | undefined
        try {
            if (action === 'libraries.selectProject') {
                if (typeof value.project !== 'string' || !(await this.projects()).includes(value.project)) throw new Error('Unknown workspace project.')
                this.selected = value.project
            } else if (action === 'libraries.search') {
                if (typeof value.query !== 'string' || value.query.length > 500) throw new Error('Invalid search query.')
                this.query = value.query
                await this.restoreRegistryList()
            } else {
                if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace to modify libraries.')
                await this.getState()
                if (['libraries.install', 'libraries.remove', 'libraries.restore', 'libraries.repair'].includes(action)) {
                    const project = context.actor === 'agent' ? value.project as string : this.selected
                    if (!project || !(await this.projects()).includes(project)) throw new Error('Open and select a workspace project first.')
                    if (context.actor === 'agent') await assertWorkspacePath(vscode.Uri.file(project))
                    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'SCAD Library Manager', cancellable: true }, async (progress, token) => {
                        const abort = new AbortController()
                        this.abort = abort
                        this.changed.fire()
                        const cancel = () => abort.abort()
                        context.signal?.addEventListener('abort', cancel, { once: true })
                        if (context.signal?.aborted || token.isCancellationRequested) abort.abort()
                        const subscription = token.onCancellationRequested(cancel)
                        const report = (message: string) => {
                            this.message = message
                            context.report?.(message)
                            progress.report({ message })
                            this.changed.fire()
                        }
                        try {
                            if (action === 'libraries.install') {
                                if (typeof value.id !== 'string' || typeof value.version !== 'string') throw new Error('Select a library and exact version.')
                                await this.manager.install(project, value.id, value.version, abort.signal, report)
                            } else if (action === 'libraries.remove') {
                                if (typeof value.id !== 'string') throw new Error('Invalid library ID.')
                                await this.manager.remove(project, value.id, abort.signal, report)
                            } else await this.manager.restore(project, abort.signal, report)
                        } finally {
                            subscription.dispose()
                            context.signal?.removeEventListener('abort', cancel)
                            this.abort = undefined
                        }
                    })
                } else if (action === 'libraries.cleanupAll' || action === 'libraries.verifyAll') {
                    if (action === 'libraries.cleanupAll') {
                        if (value.mode !== 'all' && value.mode !== 'unused') throw new Error('Invalid cache cleanup mode.')
                        const mode = value.mode
                        if (mode === 'unused') await this.manager.store.exclusive(async () => {
                            for (const project of await this.projects()) await this.manager.references.register(project)
                        })
                        const plan = await this.planCleanup({ mode })
                        const result = await this.executeCleanup(plan.id)
                        this.bulkResult = mode === 'all'
                            ? `Deleted ${result.removed} global dependency versions. Projects that used these versions can recover with Restore Dependencies.`
                            : `Deleted ${result.removed} unreferenced global dependency versions. Skipped ${result.protectedCount} referenced or unverifiable versions.`
                        if (result.removed) libraryEnvironment.notifyChanged(this.selected ?? '')
                    } else {
                        const installed = await this.manager.store.list()
                        let damaged = 0
                        for (const entity of installed) if (!(await this.manager.store.verify(entity.libraryId, entity.repositoryUrl, entity.commit))) damaged++
                        this.bulkResult = `Verified ${installed.length} cached versions. ${damaged} damaged or missing versions.`
                    }
                } else if (['libraries.verify', 'libraries.previewCleanup', 'libraries.repairGlobal'].includes(action)) {
                    const entity = (await this.manager.store.list()).find((p) => this.key(p) === value.key)
                    if (!entity) throw new Error('Cached version no longer exists.')
                    if (action === 'libraries.verify') {
                        if (!(await this.manager.store.verify(entity.libraryId, entity.repositoryUrl, entity.commit))) throw new Error('Library content is corrupted or missing. Use Repair.')
                        this.message = 'File inventory verified. This checks local corruption, not independent supply-chain authenticity.'
                        return
                    }
                    if (action === 'libraries.repairGlobal') {
                        const abort = new AbortController()
                        this.abort = abort
                        const cancel = () => abort.abort()
                        context.signal?.addEventListener('abort', cancel, { once: true })
                        removeCancellation = () => context.signal?.removeEventListener('abort', cancel)
                        if (context.signal?.aborted) abort.abort()
                        this.changed.fire()
                        const library = await this.manager.registry.getLibrary(entity.libraryId)
                        if (repository(library.repositoryUrl).url.toLowerCase() !== repository(entity.repositoryUrl).url.toLowerCase()) throw new Error('Registry repository identity changed. Repair from the original project lockfile.')
                        const version = library.versions.find((v) => v.commit === entity.commit)
                        const mount = installLayout(library, version)
                        await this.manager.installer.ensureInstalled(entity.libraryId, { source: { provider: repository(entity.repositoryUrl).provider, repositoryUrl: entity.repositoryUrl }, resolved: { kind: version?.kind ?? 'snapshot', tag: version?.tag ?? null, commit: entity.commit }, mount: { name: mount.includeName, includeRoot: mount.includeRoot } }, abort.signal, (message) => {
                            this.message = message
                            context.report?.(message)
                            this.changed.fire()
                        })
                        libraryEnvironment.notifyChanged(this.selected ?? '')
                    } else {
                        await this.manager.store.exclusive(async () => {
                            for (const project of await this.projects()) await this.manager.references.register(project)
                        })
                        const plan = await this.planCleanup({ key: this.key(entity) })
                        await this.executeCleanup(plan.id)
                    }
                } else throw new Error('Unknown Library Manager action.')
            }
            this.message = 'Library state refreshed.'
        } catch (e) {
            this.error = e instanceof Error ? e.message : String(e)
            throw e
        } finally {
            removeCancellation?.()
            this.abort = undefined
            this.busy = false
            this.changed.fire()
        }
    }
    private readonly plans = new Map<string, { expires: number; input: { mode?: 'all' | 'unused'; key?: string }; digest: string }>()
    private async cleanupSnapshot(input: { mode?: 'all' | 'unused'; key?: string }) {
        if (!vscode.workspace.isTrusted) throw new CapabilityError('UNTRUSTED_WORKSPACE', 'Trust this workspace to clean libraries.')
        const collector = new LibraryGarbageCollector(this.manager.store, this.manager.references)
        if (input.key) {
            const entity = (await this.manager.store.list()).find((p) => this.key(p) === input.key)
            if (!entity) throw new CapabilityError('STALE_STATE', 'Cached version no longer exists.', true)
            const preview = await collector.preview(entity)
            return { candidates: [entity], protectedCount: preview.projects.length + preview.unavailable.length, bytes: entity.sizeBytes, references: preview }
        }
        return { ...await collector.previewAll(input.mode ?? 'unused'), references: undefined }
    }
    async planCleanup(input: { mode?: 'all' | 'unused'; key?: string }) {
        if (input.key && input.mode) throw new CapabilityError('INVALID_INPUT', 'Choose key or mode, not both.')
        const plan = await this.cleanupSnapshot(input)
        const id = randomUUID()
        for (const [key, value] of this.plans) if (value.expires < Date.now()) this.plans.delete(key)
        if (this.plans.size >= 100) throw new CapabilityError('BUSY', 'Too many pending cleanup plans.')
        this.plans.set(id, { input, digest: JSON.stringify(plan), expires: Date.now() + 120_000 })
        return { id, expiresInSeconds: 120, candidateCount: plan.candidates.length, truncated: plan.candidates.length > 50, candidates: await Promise.all(plan.candidates.slice(0, 50).map(async ({ files: _files, ...entity }) => { const references = await this.manager.references.references(entity); return { ...entity, key: this.key(entity), references: { projects: references.projects.slice(0, 10), unavailable: references.unavailable.slice(0, 10), total: references.projects.length + references.unavailable.length } } })), bytes: plan.bytes, protectedCount: plan.protectedCount, warning: 'All mode can remove sources referenced by projects; manifests and locks survive. Unknown projects cannot be checked.' }
    }
    async executeCleanup(id: string) {
        const stored = this.plans.get(id)
        this.plans.delete(id)
        if (!stored || stored.expires < Date.now()) throw new CapabilityError('STALE_STATE', 'Cleanup plan expired. Plan again.', true)
        await this.manager.store.exclusive(async () => {
            for (const project of await this.projects()) await this.manager.references.register(project)
        })
        const plan = await this.cleanupSnapshot(stored.input)
        if (JSON.stringify(plan) !== stored.digest) throw new CapabilityError('STALE_STATE', 'Library state changed. Plan again.', true)
        const collector = new LibraryGarbageCollector(this.manager.store, this.manager.references)
        const authorize = async () => {
            const approved = stored.input.key
                ? await confirmLibraryCleanup(`${plan.candidates[0].libraryId}@${plan.candidates[0].commit}`, plan.bytes, plan.references?.unavailable ?? [])
                : await this.confirmBulkCleanup(plan.candidates.length, plan.bytes, stored.input.mode ?? 'unused', plan.protectedCount)
            if (!approved) throw new CapabilityError('CANCELLED', 'Cleanup cancelled.')
            if (stored.expires < Date.now() || !vscode.workspace.isTrusted || JSON.stringify(await this.cleanupSnapshot(stored.input)) !== stored.digest) throw new CapabilityError('STALE_STATE', 'Cleanup target or permissions changed. Plan again.', true)
            return true
        }
        const result = stored.input.key
            ? { removed: await collector.remove(plan.candidates[0], authorize) ? 1 : 0, protectedCount: plan.protectedCount }
            : await collector.removeAll(stored.input.mode ?? 'unused', authorize)
        libraryEnvironment.notifyChanged(this.selected ?? '')
        this.changed.fire()
        return result
    }
    async projectState(project: string) {
        if (!(await this.projects()).includes(project)) throw new CapabilityError('INVALID_PROJECT', 'Choose an exact workspace project returned by state.')
        await assertWorkspacePath(vscode.Uri.file(project))
        return { project, dependencies: await this.manager.list(project) }
    }
    private abort?: AbortController
    dispose() {
        this.abort?.abort()
        this.changed.dispose()
        this.subscriptions.forEach((s) => s.dispose())
    }
}
