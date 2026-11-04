import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { parseRegistry } from '../../core/libraries/validation'
import type { Registry } from '../../core/libraries/types'
import { atomicJson, readJson } from './files'
export const REGISTRY_URL = 'https://peterisdev42.github.io/scad-registry/registry.json'
export interface RegistryCacheStorage {
    get(key: string): unknown
    update(key: string, value: unknown): PromiseLike<void>
}
interface RegistryCache {
    version: 1
    sourceUrl: string
    registry: Registry
    etag?: string
}
export function registryCacheKey(url = REGISTRY_URL) {
    return `libraries.registry.v1.${createHash('sha256').update(url).digest('hex')}`
}
/** A cached list remains installable metadata, so validate it before exposing it. */
export function readRegistryCache(value: unknown, url = REGISTRY_URL): RegistryCache | undefined {
    try {
        if (!value || typeof value !== 'object') return undefined
        const raw = value as Partial<RegistryCache>
        if (raw.version !== 1 || raw.sourceUrl !== url || (raw.etag !== undefined && typeof raw.etag !== 'string')) return undefined
        return { version: 1, sourceUrl: url, registry: parseRegistry(structuredClone(raw.registry)), etag: raw.etag }
    } catch {
        return undefined
    }
}
export class RegistryClient {
    private current?: Registry
    private etag?: string
    private cacheRestorePending?: Promise<Registry | undefined>
    private pending?: Promise<Registry>
    status = ''
    error = ''
    offline = false
    constructor(
        private readonly root: string,
        private readonly request: typeof fetch = fetch,
        private readonly url = REGISTRY_URL,
        private readonly storage?: RegistryCacheStorage,
    ) {}
    cacheInfo() {
        return { registry: this.current, etag: this.etag, status: this.status, error: this.error }
    }
    async clearMemoryCache() {
        await this.pending?.catch(() => {})
        this.current = undefined
        this.etag = undefined
        this.cacheRestorePending = undefined
        this.status = this.error = ''
        this.offline = false
    }
    private get cacheFile() {
        return path.join(this.root, 'cache', this.url === REGISTRY_URL ? 'registry.json' : `registry-${createHash('sha256').update(this.url).digest('hex')}.json`)
    }
    /** Restore without making a request, so a panel can publish the local list immediately. */
    restoreCachedRegistry(): Promise<Registry | undefined> {
        if (this.current) return Promise.resolve(this.current)
        return (this.cacheRestorePending ??= this.restoreCache())
    }
    private async restoreCache(): Promise<Registry | undefined> {
        let cached: RegistryCache | undefined
        try {
            cached = readRegistryCache(this.storage?.get(registryCacheKey(this.url)), this.url)
        } catch {
            /* Unreadable mementos must not block a network refresh. */
        }
        if (!cached) {
            try {
                const raw = await readJson(this.cacheFile)
                cached = readRegistryCache(raw, this.url)
                // Import the former { registry, etag } file only for the built-in source.
                if (!cached && this.url === REGISTRY_URL && raw.version === undefined && raw.sourceUrl === undefined) {
                    cached = readRegistryCache({ version: 1, sourceUrl: this.url, registry: raw.registry, etag: raw.etag }, this.url)
                }
                if (cached && this.storage) await this.persist(cached)
            } catch {
                /* Only validated caches may be used. */
            }
        }
        if (cached) {
            this.current = cached.registry
            this.etag = cached.etag
            this.status ||= 'Showing locally cached registry.'
        }
        return this.current
    }
    private async persist(cache: RegistryCache) {
        try {
            if (this.storage) await this.storage.update(registryCacheKey(this.url), cache)
            else await atomicJson(this.cacheFile, cache)
        } catch (error) {
            // A successful download remains usable when local cache persistence fails.
            this.error = this.status = `Could not save Registry list cache: ${String(error)}`
        }
    }
    getRegistry(forceRefresh = false): Promise<Registry> {
        if (this.current && !forceRefresh) return Promise.resolve(this.current)
        if (this.pending) return this.pending
        this.pending = this.refresh().finally(() => {
            this.pending = undefined
        })
        return this.pending
    }
    private async refresh(): Promise<Registry> {
        const cached = await this.restoreCachedRegistry()
        this.error = ''
        try {
            const response = await this.request(this.url, { headers: this.etag ? { 'If-None-Match': this.etag } : {}, signal: AbortSignal.timeout(15000) })
            let registry: Registry
            let etag = this.etag
            if (response.status === 304 && cached) {
                registry = cached
                etag = response.headers.get('etag') ?? etag
            } else {
                if (!response.ok) throw new Error(`Registry: HTTP ${response.status}`)
                if (Number(response.headers.get('content-length')) > 16 * 1048576) throw new Error('Registry response is too large.')
                if (!response.body) throw new Error('Empty registry response.')
                const chunks: Uint8Array[] = []
                let bytes = 0
                for await (const chunk of response.body) {
                    bytes += chunk.length
                    if (bytes > 16 * 1048576) throw new Error('Registry response is too large.')
                    chunks.push(chunk)
                }
                registry = parseRegistry(JSON.parse(Buffer.concat(chunks).toString('utf8')))
                etag = response.headers.get('etag') ?? undefined
            }
            this.current = registry
            this.etag = etag
            this.offline = false
            this.status = ''
            await this.persist({ version: 1, sourceUrl: this.url, registry, etag })
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error)
            this.offline = true
            if (!cached) throw error
            this.current = cached
            this.offline = true
            this.status = `Using cached registry: ${String(error)}`
        }
        return this.current!
    }
    async search(query: string) {
        const q = query.toLowerCase()
        return (await this.getRegistry()).libraries.filter((l) => `${l.id} ${l.name} ${l.description}`.toLowerCase().includes(q))
    }
    async getLibrary(id: string) {
        const l = (await this.getRegistry()).libraries.find((l) => l.id === id)
        if (!l) throw new Error('Library not found.')
        return l
    }
}
