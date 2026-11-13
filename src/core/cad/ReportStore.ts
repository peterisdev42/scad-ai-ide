import type { VerificationReport } from './types'

/** Workspace-local, in-memory evidence. No source/log persistence or implicit recomputation. */
export class ReportStore {
    private entries = new Map<string, { report: VerificationReport; log: string; expires: number }>()
    constructor(
        private readonly maxEntries = 128,
        private readonly ttlMs = 30 * 60 * 1000,
        private readonly maxBytes = 16 * 1048576,
    ) {}
    put(input: VerificationReport, log: string) {
        const report = structuredClone(input)
        // Freeze nested facts so callers cannot change cached verdicts or authorization identities.
        const freeze = (value: unknown): void => {
            if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
            Object.freeze(value)
            for (const child of Object.values(value)) freeze(child)
        }
        freeze(report)
        this.entries.set(report.reportId, Object.freeze({ report, log: log.slice(0, 262144), expires: Date.now() + this.ttlMs }))
        this.prune()
        return report
    }
    private prune() {
        for (const [id, entry] of this.entries) if (entry.expires <= Date.now()) this.entries.delete(id)
        let bytes = [...this.entries.values()].reduce((sum, e) => sum + Buffer.byteLength(JSON.stringify(e.report)) + Buffer.byteLength(e.log), 0)
        while (this.entries.size > this.maxEntries || bytes > this.maxBytes) {
            const id = this.entries.keys().next().value!
            const entry = this.entries.get(id)!
            bytes -= Buffer.byteLength(JSON.stringify(entry.report)) + Buffer.byteLength(entry.log)
            this.entries.delete(id)
        }
    }
    get(id: string) {
        this.prune()
        return this.entries.get(id)
    }
    find(snapshotId: string) {
        this.prune()
        return [...this.entries.values()].reverse().find((e) => e.report.snapshot.id === snapshotId)?.report
    }
    all() {
        this.prune()
        return [...this.entries.values()].map((e) => e.report)
    }
    clear() {
        this.entries.clear()
    }
}
