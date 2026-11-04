export interface MemoryCache {
    id: string
    name: string
    read(): unknown
    clear(): void | Promise<void>
}

/** Cache owners register live inspectors without coupling renderers to VS Code UI. */
class CacheRegistry {
    private sequence = 0
    private readonly caches = new Map<string, MemoryCache>()

    register(name: string, read: () => unknown, clear: () => void | Promise<void>) {
        const id = `memory:${++this.sequence}`
        this.caches.set(id, { id, name, read, clear })
        return { dispose: () => { this.caches.delete(id) } }
    }

    entries() {
        return [...this.caches.values()]
    }
}

export const memoryCaches = new CacheRegistry()
