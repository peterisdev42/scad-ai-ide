import { mkdir, readFile, writeFile, rename, rm, readdir, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { digest } from '../../core/cad/snapshot'
import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import type { ArtifactRef } from '../../core/mesh/types'
interface Entry { ref: ArtifactRef; expires: number; accessed: number; pins: number }
/** Private, workspace-separated content store. IDs never accept filesystem paths. */
export class ArtifactStore {
    private entries = new Map<string, Entry>()
    private initialized?: Promise<void>
    private queue: Promise<unknown> = Promise.resolve()
    constructor(readonly directory: string, private readonly maxBytes = 512 * 1048576, private readonly maxSnapshots = 128, private readonly ttlMs = 1800000) {}
    private async init() {
        if (!this.initialized) this.initialized = (async () => {
            await mkdir(this.directory, { recursive: true, mode: 0o700 })
            if ((await lstat(this.directory)).isSymbolicLink()) throw new CapabilityError('INVALID_PATH', 'Artifact directory must not be a symbolic link.')
            // Each extension activation owns a fresh directory. Remove abandoned temporary writes.
            for (const name of await readdir(this.directory)) if (/^[a-f0-9-]+\.tmp$/.test(name)) await rm(join(this.directory, name), { force: true })
        })()
        await this.initialized
    }
    private serial<T>(task: () => Promise<T>): Promise<T> { const next = this.queue.then(task); this.queue = next.catch(() => {}); return next }
    async put(snapshotId: string, kind: ArtifactRef['kind'], mimeType: string, bytes: Uint8Array): Promise<ArtifactRef> {
        return this.serial(async () => {
            await this.init()
            if (bytes.byteLength > this.maxBytes) throw new CapabilityError('BUDGET_EXCEEDED', 'Artifact exceeds store capacity.')
            const sha256 = createHash('sha256').update(bytes).digest('hex'), id = digest({ snapshotId, kind, mimeType, sha256 })
            const existing = this.entries.get(id)
            if (existing) { existing.accessed = Date.now(); return existing.ref }
            await this.prune(bytes.byteLength, snapshotId)
            const ref: ArtifactRef = { id, snapshotId, kind, mimeType, sha256, bytes: bytes.byteLength }, temp = join(this.directory, `${randomUUID()}.tmp`)
            try { await writeFile(temp, bytes, { mode: 0o600, flag: 'wx' }); await rename(temp, join(this.directory, id)) } finally { await rm(temp, { force: true }) }
            this.entries.set(id, { ref, expires: Date.now() + this.ttlMs, accessed: Date.now(), pins: 0 })
            return ref
        })
    }
    private async prune(incoming = 0, snapshotId?: string) {
        let total = [...this.entries.values()].reduce((n, e) => n + e.ref.bytes, 0)
        const snapshots = () => new Set([...this.entries.values()].map(e => e.ref.snapshotId).concat(snapshotId ? [snapshotId] : [])).size
        for (const [id, e] of [...this.entries].sort((a, b) => a[1].accessed - b[1].accessed)) {
            if (e.pins || (e.expires > Date.now() && total + incoming <= this.maxBytes && snapshots() <= this.maxSnapshots)) continue
            await rm(join(this.directory, id), { force: true }); this.entries.delete(id); total -= e.ref.bytes
        }
        if (total + incoming > this.maxBytes || snapshots() > this.maxSnapshots) throw new CapabilityError('BUDGET_EXCEEDED', 'Artifact capacity is leased by active operations.')
    }
    async read(id: string): Promise<Buffer> {
        await this.queue; await this.init(); await this.prune()
        const entry = this.entries.get(id)
        if (!entry || !/^[a-f0-9]{64}$/.test(id)) throw new CapabilityError('ARTIFACT_NOT_FOUND', 'Artifact expired or was evicted. Explicitly verify again.', true)
        const file = join(this.directory, id)
        try {
            if ((await lstat(file)).isSymbolicLink()) throw new Error('Artifact replaced by a link')
            const bytes = await readFile(file)
            if (bytes.length !== entry.ref.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.ref.sha256) throw new Error('Artifact content changed')
            entry.accessed = Date.now(); return bytes
        } catch { this.entries.delete(id); await rm(file, { force: true }); throw new CapabilityError('ARTIFACT_NOT_FOUND', 'Artifact content is unavailable or changed.', true) }
    }
    lease(ids: string[]): () => void {
        const entries = ids.map(id => { const e = this.entries.get(id); if (!e) throw new CapabilityError('ARTIFACT_NOT_FOUND', 'Cannot lease an unavailable artifact.'); return e })
        entries.forEach(e => e.pins++)
        let released = false
        return () => { if (!released) { released = true; entries.forEach(e => e.pins--) } }
    }
    async dispose() { await this.queue; this.entries.clear(); await rm(this.directory, { recursive: true, force: true }) }
}
