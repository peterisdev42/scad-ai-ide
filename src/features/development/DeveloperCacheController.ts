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
    readonly enabled: boolean

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly invalidate: (key: string) => Promise<void>,
    ) {
        this.enabled = context.extensionMode === vscode.ExtensionMode.Development
    }

    private assertEnabled() {
        if (!this.enabled) throw new Error('Cache tools are only available in extension development mode.')
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
        return { entries: (await this.entries()).map(({ clear: _clear, ...entry }) => entry) }
    }

    async handle(raw: unknown) {
        this.assertEnabled()
        if (!raw || typeof raw !== 'object') throw new Error('Invalid cache action.')
        const value = raw as Record<string, unknown>
        if (value.action === 'development.refreshCaches') return this.getState()
        if (!['development.clearCache', 'development.clearAllCaches'].includes(String(value.action))) throw new Error('Unknown cache action.')
        if (this.busy) throw new Error('A cache operation is already running.')
        this.busy = true
        try {
            const entries = await this.entries()
            const selected = value.action === 'development.clearAllCaches' ? entries : entries.filter((entry) => entry.id === value.id)
            if (!selected.length && value.action !== 'development.clearAllCaches') throw new Error('Cache field no longer exists. Refresh the list.')
            // Finish every requested field even if one owner fails, then report failures.
            const failures: string[] = []
            for (const entry of selected) {
                try { await entry.clear() } catch (error) { failures.push(`${entry.name}: ${String(error)}`) }
            }
            if (failures.length) throw new Error(failures.join('\n'))
            return await this.getState()
        } finally {
            this.busy = false
        }
    }
}
