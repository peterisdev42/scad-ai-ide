import { createHash } from 'node:crypto'
import { safePreview } from '../../core/capabilities/SafeOutput'
import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { confirmCapabilityAction } from '../../platform/notifications'
import { highlightJson } from './JsonHighlighter'
import * as vscode from 'vscode'
import { lstat, readdir, readFile, realpath, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { registryCacheKey } from '../../platform/libraries/RegistryClient'
import { memoryCaches } from '../../core/cache/CacheRegistry'

interface CacheEntry {
    id: string
    name: string
    scope: string
    value: unknown
    clear(): Promise<void> | void
}

/** Development-only inspection of extension state and disposable cache data. */
export class DeveloperCacheController {
    private busy = false
    isBusy() { return this.busy }
    private readonly changed = new vscode.EventEmitter<void>()
    readonly onDidChange = this.changed.event
    dispose() { this.changed.dispose() }
    readonly enabled: boolean

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly invalidate: (key: string) => Promise<void>,
        private readonly revealDirectory: (uri: vscode.Uri) => PromiseLike<unknown> = (uri) => vscode.commands.executeCommand('revealFileInOS', uri),
        private readonly authorize = confirmCapabilityAction,
    ) {
        this.enabled = context.extensionMode === vscode.ExtensionMode.Development
    }

    private assertEnabled() {
        if (!this.enabled) throw new CapabilityError('DEVELOPMENT_ONLY', 'Cache tools are only available in extension development mode.')
    }

    private async entries(): Promise<CacheEntry[]> {
        const entries: CacheEntry[] = []
        for (const [scope, storage] of [['globalState', this.context.globalState], ['workspaceState', this.context.workspaceState]] as const) {
            for (const key of storage.keys()) {
                entries.push({
                    id: `${scope}:${key}`, name: key, scope, value: storage.get(key),
                    clear: async () => {
                        // Drain pending catalog writes before removing their persisted field.
                        await this.invalidate(key)
                        await storage.update(key, undefined)
                        const legacy = (await this.entries()).filter((entry) => entry.scope === 'Disk' && (
                            key.startsWith('runtime.catalog.v1.') ? entry.name.endsWith(`runtime-catalog-${key.slice('runtime.catalog.v1.'.length).replace('.', '-')}.json`) :
                            key.startsWith('libraries.registry.v1.') && entry.name === path.join('libraries', 'v1', 'cache', key === registryCacheKey() ? 'registry.json' : `registry-${key.slice('libraries.registry.v1.'.length)}.json`)
                        ))
                        for (const entry of legacy) await entry.clear()
                        await this.invalidate(key)
                    },
                })
            }
        }
        for (const cache of memoryCaches.entries()) {
            entries.push({ id: cache.id, name: cache.name, scope: 'Memory', value: cache.read(), clear: () => cache.clear() })
        }
        // Installed runtimes, exporter binaries, project references and library sources
        // are managed resources, not disposable list caches.
        const root = this.context.globalStorageUri.fsPath
        const canonicalRoot = await realpath(root).catch(() => root)
        for (const relative of ['cache', path.join('libraries', 'v1', 'cache')]) {
            const directory = path.join(root, relative)
            const safeDirectory = async () => {
                const resolved = await realpath(directory)
                const withinRoot = path.relative(canonicalRoot, resolved)
                if (withinRoot.startsWith('..') || path.isAbsolute(withinRoot) || (await lstat(directory)).isSymbolicLink()) throw new Error('Cache directory is outside extension storage.')
            }
            let files: string[]
            try {
                await safeDirectory()
                files = await readdir(directory)
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
                throw error
            }
            for (const name of files) {
                const file = path.join(directory, name)
                const info = await lstat(file)
                if (!info.isFile() || info.isSymbolicLink()) continue
                let value: unknown = { bytes: info.size, modified: info.mtime.toISOString() }
                if (info.size <= 16 * 1048576) {
                    const text = await readFile(file, 'utf8')
                    try { value = JSON.parse(text) } catch { value = text }
                }
                const key = path.join(relative, name)
                entries.push({
                    id: `disk:${key}`, name: key, scope: 'Disk', value,
                    clear: async () => {
                        await safeDirectory()
                        const current = await lstat(file).catch((error: NodeJS.ErrnoException) => {
                            if (error.code === 'ENOENT') return undefined
                            throw error
                        })
                        if (!current) return
                        if (!current.isFile() || current.isSymbolicLink()) throw new Error('Cache file changed. Refresh the list.')
                        await this.invalidate(key)
                        await unlink(file)
                        await this.invalidate(key)
                    },
                })
            }
        }
        return entries
    }

    async getState() {
        this.assertEnabled()
        const configuration = vscode.workspace.getConfiguration('workbench')
        const modernUI = configuration.get<boolean>('experimental.modernUI', false)
        const scrollSettings = {
            modernUI, size: modernUI ? 8 : 10,
            mouseWheelScrollSensitivity: configuration.get<number>('list.mouseWheelScrollSensitivity', 1),
            fastScrollSensitivity: configuration.get<number>('list.fastScrollSensitivity', 5),
            smoothScrolling: configuration.get<boolean>('list.smoothScrolling', false),
        }
        return { scrollSettings, globalDirectory: this.context.globalStorageUri.fsPath, entries: (await this.entries()).map(({ clear: _clear, ...entry }) => entry) }
    }

    async listSafe(offset = 0, limit = 20) {
        this.assertEnabled()
        const entries = await this.entries()
        return { total: entries.length, offset, entries: entries.slice(offset, offset + limit).map(({ id, name, scope }) => ({ id, name, scope })) }
    }
    async inspectSafe(id: string) {
        this.assertEnabled()
        const entry = (await this.entries()).find((entry) => entry.id === id)
        if (!entry) throw new CapabilityError('NOT_FOUND', 'Cache field no longer exists.')
        return { id, warning: 'Cache may contain personal information. Preview is redacted and bounded.', value: safePreview({ [entry.name]: entry.value }) }
    }
    async clearSafe(input: { id?: string; scope?: string; all?: boolean }) {
        this.assertEnabled()
        if (Object.keys(input).length !== 1 || (input.all !== undefined && input.all !== true)) throw new CapabilityError('INVALID_INPUT', 'Choose exactly one cache ID, scope or all=true.')
        await this.handle({ action: input.all ? 'development.clearAllCaches' : input.scope ? 'development.clearScopeCaches' : 'development.clearCache', ...input })
        return this.listSafe()
    }

    async handle(raw: unknown) {
        this.assertEnabled()
        if (!raw || typeof raw !== 'object') throw new Error('Invalid cache action.')
        const value = raw as Record<string, unknown>
        if (value.action === 'development.openGlobalFolder') {
            await vscode.workspace.fs.createDirectory(this.context.globalStorageUri)
            await this.revealDirectory(this.context.globalStorageUri)
            return this.getState()
        }
        if (value.action === 'development.inspectCache') {
            const entry = (await this.entries()).find((entry) => entry.id === value.id)
            if (!entry) throw new Error('Cache field no longer exists. Refresh the list.')
            return { cacheValue: { id: entry.id, tokens: await highlightJson(entry.value, this.context.extensionUri) } }
        }
        if (value.action === 'development.openCacheEditor') {
            const entry = (await this.entries()).find((entry) => entry.id === value.id)
            if (!entry) throw new Error('Cache field no longer exists. Refresh the list.')
            const document = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(entry.value, null, 2) ?? 'null' })
            await vscode.window.showTextDocument(document, { preview: false })
            return this.getState()
        }
        if (value.action === 'development.refreshCaches') return this.getState()
        if (!['development.clearCache', 'development.clearAllCaches', 'development.clearScopeCaches'].includes(String(value.action))) throw new Error('Unknown cache action.')
        if (this.busy) throw new Error('A cache operation is already running.')
        this.busy = true
        try {
            const entries = await this.entries()
            if (value.action === 'development.clearScopeCaches' && !['globalState', 'workspaceState', 'Memory', 'Disk'].includes(String(value.scope))) throw new Error('Unknown cache scope.')
            const selected = value.action === 'development.clearAllCaches' ? entries : entries.filter((entry) => value.action === 'development.clearScopeCaches' ? entry.scope === value.scope : entry.id === value.id)
            if (!selected.length && value.action !== 'development.clearAllCaches') throw new Error('Cache field no longer exists. Refresh the list.')
            const digest = (entry: CacheEntry) => createHash('sha256').update(JSON.stringify(entry.value) ?? 'null').digest('hex')
            const before = selected.map((entry) => [entry.id, digest(entry)])
            // Finish every requested field even if one owner fails, then report failures.
            if (!(await this.authorize('Clear disposable caches', selected.map((entry) => entry.id).join(', ')))) throw new CapabilityError('CANCELLED', 'Cache clearing cancelled.')
            this.assertEnabled()
            const current = await this.entries()
            for (const [id, expected] of before) {
                const entry = current.find((entry) => entry.id === id)
                if (!entry || digest(entry) !== expected) throw new CapabilityError('STALE_STATE', 'Cache changed during confirmation. Refresh and try again.', true)
            }
            const failures: string[] = []
            for (const entry of selected) {
                try { await entry.clear() } catch (error) { failures.push(`${entry.name}: ${String(error)}`) }
            }
            if (failures.length) throw new Error(failures.join('\n'))
            return await this.getState()
        } finally {
            this.busy = false
            this.changed.fire()
        }
    }
}
