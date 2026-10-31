import { createHash } from 'node:crypto'

export type ModelState = { status: 'pending' } | { status: 'ready'; model: string } | { status: 'error'; message: string }

interface Entry {
    document: string
    source:string
    cwd:string
    variant?:string
    controller: AbortController
    state: ModelState
    dependencies?: string[]
}

/** markdown-it is synchronous; render in a serial queue and refresh once results are ready. */
export class ScadModelCache {
    private readonly entries = new Map<string, Entry>()
    private queue = Promise.resolve()
    private disposed = false

    constructor(
        private readonly render: (source: string, cwd: string, signal: AbortSignal, publish: (model: string) => void,document:string,variant?:string) => Promise<string>,
        private readonly onChange: () => void,
    ) {}

    request(document: string, source: string, cwd: string,variant?:string): ModelState {
        if (this.disposed) return { status: 'error', message: 'OpenSCAD preview is closed.' }
        const key = createHash('sha256')
            .update(JSON.stringify([document, source, cwd,variant]))
            .digest('hex')
        const cached = this.entries.get(key)
        if (cached) return cached.state
        // Bound queued work and retained models. Document edits/close free their entries.
        if (this.entries.size >= 128) return { status: 'error', message: 'OpenSCAD preview limit reached. Close other Markdown documents to free previews.' }
        const entry: Entry = { document,source,cwd,variant, controller: new AbortController(), state: { status: 'pending' } }
        this.entries.set(key, entry)
        this.queue = this.queue.then(async () => {
            if (entry.controller.signal.aborted) return
            try {
                const model = await this.render(source, cwd, entry.controller.signal, (model) => {
                    if (entry.controller.signal.aborted || this.disposed) return
                    entry.state = { status: 'ready', model }
                    this.onChange()
                },document,variant)
                entry.state = { status: 'ready', model }
                try {
                    entry.dependencies = (JSON.parse(model).dependencies ?? []).map((d: { path: string }) => d.path)
                } catch {
                    /* opaque test/non-model results have no dependencies */
                }
            } catch (error) {
                entry.state = { status: 'error', message: error instanceof Error ? error.message : String(error) }
            }
            if (!entry.controller.signal.aborted && !this.disposed) this.onChange()
        })
        return entry.state
    }

    /** Keep unchanged fenced sources while cancelling work for removed/replaced blocks. */
    retainDocumentSources(document: string, sources: Iterable<string>, cwd: string) {
        const keep = new Set(sources)
        for (const [key, entry] of this.entries)if(entry.document===document&&entry.cwd===cwd&&!keep.has(entry.source)){
            entry.controller.abort();this.entries.delete(key)
        }
    }

    invalidateSource(document:string,source:string,cwd:string){
        for(const [key,entry] of this.entries)if(entry.document===document&&entry.source===source&&entry.cwd===cwd){entry.controller.abort();this.entries.delete(key)}
    }

    invalidate(document?: string) {
        for (const [key, entry] of this.entries) {
            if (document === undefined || entry.document === document) {
                entry.controller.abort()
                this.entries.delete(key)
            }
        }
    }

    invalidateResource(path: string): boolean {
        let changed = false
        for (const [key, entry] of this.entries)
            if (entry.dependencies?.includes(path)) {
                entry.controller.abort()
                this.entries.delete(key)
                changed = true
            }
        return changed
    }

    dispose() {
        this.disposed = true
        this.invalidate()
    }
}
