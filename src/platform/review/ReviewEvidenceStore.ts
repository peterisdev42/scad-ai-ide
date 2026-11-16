import {Ajv} from 'ajv'
import meshSchema from '../../../resources/schemas/cad-report-v2.schema.json'
import assemblySchema from '../../../resources/schemas/cad-report-v3.schema.json'
import feedbackSchema from '../../../resources/schemas/cad-feedback-v1.schema.json'
const validators={mesh:new Ajv({strict:true}).compile(meshSchema),assembly:new Ajv({strict:true}).compile(assemblySchema),feedback:new Ajv({strict:true}).compile(feedbackSchema)}
import {writeFileSync,unlinkSync} from 'node:fs'
import { mkdir, readFile, writeFile, rename, lstat, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { lock } from 'proper-lockfile'
import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { reviewLimits, type FeedbackRecord, type PersistedBundle } from '../../core/review/types'
interface Index {
    schemaVersion: 1
    revision: number
    bundles: Record<string, { bundle: PersistedBundle; baseline: boolean; checksum:string }>
    feedback: FeedbackRecord[]
}
const empty = (): Index => ({ schemaVersion: 1, revision: 0, bundles: {}, feedback: [] })
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const idPattern = /^cad-[a-f0-9-]{36}$/
/** Durable user review data. It is deliberately outside session-cache reaping. */
export class ReviewEvidenceStore {
    private pins = new Map<string, number>()
    constructor(
        readonly directory: string,
        private readonly limits: { bytes: number; metadata: number; snapshots: number; feedback: number } = { bytes: reviewLimits.persistentBytes, metadata: reviewLimits.metadataBytes, snapshots: reviewLimits.snapshots, feedback: reviewLimits.feedback },
    ) {}
    private async init() {
        await mkdir(this.directory, { recursive: true, mode: 0o700 })
        if ((await lstat(this.directory)).isSymbolicLink()) throw new CapabilityError('INVALID_PATH', 'Review directory must not be a symbolic link.')
    }
    private async readIndex(): Promise<Index> {
        try {
            const path = join(this.directory, 'index.json'),
                stat = await lstat(path)
            if (stat.isSymbolicLink() || stat.size > this.limits.metadata) throw new Error('index budget')
            const value = JSON.parse(await readFile(path, 'utf8')) as Index
            if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || !value.bundles || typeof value.bundles !== 'object' || !Array.isArray(value.feedback) || Object.keys(value.bundles).length > this.limits.snapshots || value.feedback.length > this.limits.feedback) throw new Error('index version or shape')
            for (const [id, entry] of Object.entries(value.bundles)) {
                if (!idPattern.test(id) || entry.bundle.schemaVersion !== 1 || entry.bundle.report.reportId !== id || ![2, 3].includes(entry.bundle.report.schemaVersion)) throw new Error('bundle version')
                if(entry.checksum!==sha(Buffer.from(JSON.stringify(entry.bundle)))||!(entry.bundle.report.schemaVersion===2?validators.mesh:validators.assembly)(entry.bundle.report))throw new Error('bundle integrity')
                for (const ref of entry.bundle.retainedArtifacts) if (!/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) throw new Error('artifact reference')
            }
            for (const f of value.feedback) if (!validators.feedback(f)||f.schemaVersion !== 1 || !idPattern.test(f.id) || !Number.isSafeInteger(f.recordRevision) || !value.bundles[f.anchor.reportId] || Buffer.byteLength(f.text) > reviewLimits.textBytes) throw new Error('feedback reference')
            return value
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') return empty()
            throw new CapabilityError('REVIEW_STORE_INVALID', 'Review index is invalid or unsupported; preserved data was not reinterpreted.')
        }
    }
    async markStale(reportIds: Set<string>) {
        return this.transaction(async (index) => {
            let changed = 0
            for (const f of index.feedback)
                if (f.status !== 'stale' && reportIds.has(f.anchor.reportId)) {
                    f.status = 'stale'
                    f.recordRevision++
                    f.updatedAt = Date.now()
                    f.history.push({ at: Date.now(), action: 'source-invalidated' })
                    changed++
                }
            return changed
        })
    }
    private async transaction<T>(fn: (index: Index) => Promise<T> | T): Promise<T> {
        await this.init()
        const release = await lock(this.directory, { realpath: false, retries: { retries: 20, minTimeout: 10, maxTimeout: 100 }, stale: 30000, update: 10000 })
        try {
            const index = await this.readIndex(),
                result = await fn(index)
            index.revision++
            const bytes = Buffer.from(JSON.stringify(index))
            if (bytes.length > this.limits.metadata) throw new CapabilityError('REVIEW_CAPACITY_EXCEEDED', 'Review metadata capacity is full; explicitly remove saved items.')
            const temp = join(this.directory, `${randomUUID()}.tmp`)
            try {
                await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 })
                await rename(temp, join(this.directory, 'index.json'))
            } finally {
                await rm(temp, { force: true })
            }
            return result
        } catch (error) {
            const committed = await this.readIndex()
            const used = new Set(Object.values(committed.bundles).flatMap((e) => e.bundle.retainedArtifacts.map((a) => a.sha256)))
            for (const name of await readdir(this.directory)) if (/^[a-f0-9]{64}$/.test(name) && !used.has(name)) await rm(join(this.directory, name), { force: true })
            throw error
        } finally {
            await release()
        }
    }
    async saveBundle(bundle: PersistedBundle, read: (id: string) => Promise<Uint8Array>, baseline: boolean) {
        if (!(bundle.report.schemaVersion===2?validators.mesh:validators.assembly)(bundle.report))throw new CapabilityError('INVALID_REVIEW_EVIDENCE','Frozen report does not match its versioned schema.')
        if (!idPattern.test(bundle.report.reportId)) throw new CapabilityError('INVALID_INPUT', 'Invalid report identity.')
        return this.transaction(async (index) => {
            if (!index.bundles[bundle.report.reportId] && Object.keys(index.bundles).length >= this.limits.snapshots) throw new CapabilityError('REVIEW_CAPACITY_EXCEEDED', 'At most 32 retained snapshots. Remove a baseline or dependent feedback explicitly.')
            const used = new Map<string, number>()
            for (const e of Object.values(index.bundles)) for (const a of e.bundle.retainedArtifacts) used.set(a.sha256, a.bytes)
            for (const a of bundle.retainedArtifacts) used.set(a.sha256, a.bytes)
            if ([...used.values()].reduce((a, b) => a + b, 0) > this.limits.bytes) throw new CapabilityError('REVIEW_CAPACITY_EXCEEDED', 'Retained geometry capacity is full.')
            for (const ref of bundle.retainedArtifacts) {
                const bytes = await read(ref.id)
                if (bytes.length !== ref.bytes || sha(bytes) !== ref.sha256) throw new CapabilityError('ARTIFACT_CHANGED', 'Cannot retain changed evidence.')
                const target = join(this.directory, ref.sha256)
                try {
                    const info = await lstat(target)
                    if (info.isSymbolicLink() || info.size !== ref.bytes || sha(await readFile(target)) !== ref.sha256) throw new CapabilityError('ARTIFACT_CHANGED', 'Retained evidence was modified.')
                } catch (e) {
                    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
                    const temp = join(this.directory, `${randomUUID()}.tmp`)
                    try {
                        await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 })
                        await rename(temp, target)
                    } finally {
                        await rm(temp, { force: true })
                    }
                }
            }
            const prior = index.bundles[bundle.report.reportId]
            if (prior && JSON.stringify(prior.bundle.report) !== JSON.stringify(bundle.report)) throw new CapabilityError('REPORT_ID_COLLISION', 'An immutable report identity cannot be replaced.')
            bundle={...bundle,label:bundle.label??prior?.bundle.label}
            index.bundles[bundle.report.reportId] = { bundle: structuredClone(bundle), baseline: baseline || prior?.baseline === true,checksum:sha(Buffer.from(JSON.stringify(bundle))) }
            return { reportId: bundle.report.reportId, retained: true }
        })
    }
    async get(id: string) {
        await this.init()
        return (await this.readIndex()).bundles[id]?.bundle
    }
    async list() {
        await this.init()
        const i = await this.readIndex()
        return {
            revision: i.revision,
            baselines: Object.values(i.bundles)
                .filter((b) => b.baseline)
                .map((e) => ({ reportId: e.bundle.report.reportId, snapshotId: e.bundle.report.snapshot.id, label: e.bundle.label, ownerUri: e.bundle.report.snapshot.document.uri, savedAt: e.bundle.savedAt })),
            feedback: structuredClone(i.feedback),
        }
    }
    async readArtifact(bundle: PersistedBundle, id: string) {
        const ref = bundle.retainedArtifacts.find((a) => a.id === id)
        if (!ref) throw new CapabilityError('EVIDENCE_NOT_RETAINED', 'This artifact was not retained; no compilation was started.')
        const path = join(this.directory, ref.sha256)
        try {
            const info = await lstat(path)
            if (info.isSymbolicLink() || info.size !== ref.bytes) throw new Error('shape')
            const bytes = await readFile(path)
            if (sha(bytes) !== ref.sha256) throw new Error('hash')
            return bytes
        } catch {
            throw new CapabilityError('ARTIFACT_NOT_FOUND', 'Retained artifact is missing or changed.')
        }
    }
    lease(id:string){
        const path=join(this.directory,`.lease-${id}-${randomUUID()}`)
        const heartbeat=()=>writeFileSync(path,JSON.stringify({schemaVersion:1,reportId:id,pid:process.pid,updatedAt:Date.now()}),{mode:0o600})
        heartbeat();const timer=setInterval(()=>{try{heartbeat()}catch{/* Leased data may have been removed externally; reads will fail explicitly. */}},10000);timer.unref();this.pins.set(id,(this.pins.get(id)??0)+1);let done=false
        return()=>{if(done)return;done=true;clearInterval(timer);try{unlinkSync(path)}catch{/* Another process may have cleaned an expired crashed-host lease. */}const count=(this.pins.get(id)??1)-1;if(count)this.pins.set(id,count);else this.pins.delete(id)}
    }
    private async isPinned(id:string){
        if(this.pins.has(id))return true
        for(const name of await readdir(this.directory)){if(!name.startsWith(`.lease-${id}-`))continue
            const path=join(this.directory,name);try{const info=await lstat(path);if(info.isSymbolicLink()||info.size>1024)return true;const lease=JSON.parse(await readFile(path,'utf8'));if(lease.schemaVersion!==1||lease.reportId!==id||!Number.isSafeInteger(lease.updatedAt))return true;if(Date.now()-lease.updatedAt<45000)return true;await rm(path,{force:true})}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')return true}
        }return false
    }
    private async gcIndex(index: Index) {
        for (const [id, e] of Object.entries(index.bundles)) if (!e.baseline && !index.feedback.some((f) => f.anchor.reportId === id) && !await this.isPinned(id)) delete index.bundles[id]
    }
    async discardUnreferenced(id: string) {
        await this.transaction(async (index) => {
            const e = index.bundles[id]
            if (e && !e.baseline && !index.feedback.some((f) => f.anchor.reportId === id)) delete index.bundles[id]
        })
        await this.cleanBlobs()
    }
    async releaseBaseline(id: string) {
        return this.transaction(async (index) => {
            if (await this.isPinned(id)) throw new CapabilityError('BUSY', 'Evidence is in use.')
            if (!index.bundles[id]) throw new CapabilityError('REPORT_NOT_FOUND', 'Saved baseline not found.')
            index.bundles[id].baseline = false
            await this.gcIndex(index)
            return { reportId: id, baselineReleased: true }
        }).then(async (result) => {
            await this.cleanBlobs()
            return result
        })
    }
    async putFeedback(record: FeedbackRecord, expectedRevision?: number) {
        return this.transaction(async (index) => {
            const at = index.feedback.findIndex((f) => f.id === record.id),
                old = index.feedback[at]
            if (old?.status === 'stale' && record.status !== 'stale' && old.anchor.snapshotId === record.anchor.snapshotId) throw new CapabilityError('STALE_SNAPSHOT', 'Stale feedback needs human confirmation on a new proven snapshot.')
            if ((old && old.recordRevision !== expectedRevision) || (!old && expectedRevision !== undefined)) throw new CapabilityError('STALE_REVIEW_REVISION', 'Feedback changed; read its current revision.')
            if (!index.bundles[record.anchor.reportId]) throw new CapabilityError('REPORT_NOT_FOUND', 'Anchor evidence must be retained before submitting feedback.')
            if (!old && index.feedback.length >= this.limits.feedback) throw new CapabilityError('REVIEW_CAPACITY_EXCEEDED', 'Feedback capacity is full.')
            if (Buffer.byteLength(record.text) > reviewLimits.textBytes) throw new CapabilityError('INVALID_INPUT', 'Feedback text exceeds 2 KiB.')
            const saved = structuredClone({ ...record, recordRevision: (old?.recordRevision ?? 0) + 1, updatedAt: Date.now() })
            if (at < 0) index.feedback.push(saved)
            else index.feedback[at] = saved
            await this.gcIndex(index)
            return saved
        })
    }
    async deleteFeedback(id: string, revision: number) {
        return this.transaction(async (index) => {
            const f = index.feedback.find((f) => f.id === id)
            if (!f) throw new CapabilityError('FEEDBACK_NOT_FOUND', 'Unknown feedback.')
            if (f.recordRevision !== revision) throw new CapabilityError('STALE_REVIEW_REVISION', 'Feedback changed.')
            if (await this.isPinned(f.anchor.reportId)) throw new CapabilityError('BUSY', 'Anchor evidence is in use.')
            index.feedback = index.feedback.filter((f) => f.id !== id)
            await this.gcIndex(index)
            return { deleted: true, id }
        }).then(async (r) => {
            await this.cleanBlobs()
            return r
        })
    }
    private async cleanBlobs() {
        await this.transaction(async (index) => {
            const wanted = new Set(Object.values(index.bundles).flatMap((b) => b.bundle.retainedArtifacts.map((a) => a.sha256)))
            for (const name of await readdir(this.directory)) if (/^[a-f0-9]{64}$/.test(name) && !wanted.has(name)) await rm(join(this.directory, name), { force: true })
        })
    }
}
