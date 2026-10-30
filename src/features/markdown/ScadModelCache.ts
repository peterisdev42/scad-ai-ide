import { createHash } from 'node:crypto'

export type ModelState = { status: 'pending' } | { status: 'ready'; model: string } | { status: 'error'; message: string }

interface Entry {
    document: string
    controller: AbortController
    state: ModelState
}

/** markdown-it is synchronous; render in a serial queue and refresh once results are ready. */
export class ScadModelCache {
    private readonly entries = new Map<string, Entry>()
    private queue = Promise.resolve()
    private disposed = false

    constructor(
        private readonly render: (source: string, cwd: string, signal: AbortSignal) => Promise<string>,
        private readonly onChange: () => void,
    ) {}

    request(document: string, source: string, cwd: string): ModelState {
        if (this.disposed) return { status: 'error', message: 'OpenSCAD preview is closed.' }
        const key = createHash('sha256')
            .update(JSON.stringify([document, source, cwd]))
            .digest('hex')
        const cached = this.entries.get(key)
        if (cached) return cached.state
        // Bound queued work and retained models. Document edits/close free their entries.
        if (this.entries.size >= 128) return { status: 'error', message: 'OpenSCAD preview limit reached. Close other Markdown documents to free previews.' }
        const entry: Entry = { document, controller: new AbortController(), state: { status: 'pending' } }
        this.entries.set(key, entry)
        this.queue = this.queue.then(async () => {
            if (entry.controller.signal.aborted) return
            try {
                const model = await this.render(source, cwd, entry.controller.signal)
                entry.state = { status: 'ready', model }
            } catch (error) {
                entry.state = { status: 'error', message: error instanceof Error ? error.message : String(error) }
            }
            if (!entry.controller.signal.aborted && !this.disposed) this.onChange()
        })
        return entry.state
    }

    invalidate(document?: string) {
        for (const [key, entry] of this.entries) {
            if (document === undefined || entry.document === document) {
                entry.controller.abort()
                this.entries.delete(key)
            }
        }
    }

    dispose() {
        this.disposed = true
        this.invalidate()
    }
}
