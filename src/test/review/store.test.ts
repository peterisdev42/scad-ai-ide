import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ReviewEvidenceStore } from '../../platform/review/ReviewEvidenceStore'
import { evidence } from './fixtures'
import { stl } from '../mesh/fixtures'
import type { FeedbackRecord, PersistedBundle } from '../../core/review/types'
async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'cad-review-')),
        bytes = stl(),
        report = await evidence(bytes),
        store = new ReviewEvidenceStore(dir),
        bundle: PersistedBundle = { schemaVersion: 1, report, retainedArtifacts: report.artifacts, savedAt: Date.now() }
    return { dir, bytes, report, store, bundle }
}
function record(report: Awaited<ReturnType<typeof evidence>>): FeedbackRecord {
    return { schemaVersion: 1, id: `cad-${randomUUID()}`, recordRevision: 0, ownerUri: report.snapshot.document.uri, status: 'open', text: 'Check this surface', anchor: { reportId: report.reportId, snapshotId: report.snapshot.id, revision: report.snapshot.id, partId: null, objectId: 'stl:0', anchorHash: report.artifacts[0].sha256, triangle: 0, mesh: 0, position: [0, 0, 0], localPosition: [0, 0, 0], normal: [0, 0, -1], localNormal: [0, 0, -1], matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], units: 'mm', camera: null, source: { uri: report.snapshot.document.uri, instanceId: 'stl:0', sourceTriangle: 0, confidence: 'mesh-only' } }, history: [], createdAt: Date.now(), updatedAt: Date.now() }
}
test('retained original evidence survives restart and verifies hashes; releases are explicit and leases protect active evidence', async () => {
    const s = await fixture()
    try {
        await s.store.saveBundle(s.bundle, async () => s.bytes, true)
        const reopened = new ReviewEvidenceStore(s.dir),
            b = (await reopened.get(s.report.reportId))!
        assert.deepEqual(await reopened.readArtifact(b, s.report.artifacts[0].id), Buffer.from(s.bytes))
        assert.equal((await reopened.list()).baselines.length, 1)
        const release = reopened.lease(s.report.reportId)
        await assert.rejects(s.store.releaseBaseline(s.report.reportId), /in use/)
        release()
        await reopened.releaseBaseline(s.report.reportId)
        assert.equal(await reopened.get(s.report.reportId), undefined)
        assert.deepEqual(
            (await readdir(s.dir)).filter((n) => /^[a-f0-9]{64}$/.test(n)),
            [],
        )
    } finally {
        await rm(s.dir, { recursive: true, force: true })
    }
})
test('concurrent hosts serialize mutations, feedback CAS detects conflicts, stale state is monotone and dependent evidence stays retained', async () => {
    const s = await fixture()
    try {
        await s.store.saveBundle(s.bundle, async () => s.bytes, true)
        const first = await s.store.putFeedback(record(s.report)),
            other = new ReviewEvidenceStore(s.dir)
        const results = await Promise.allSettled([s.store.putFeedback({ ...first, text: 'A' }, first.recordRevision), other.putFeedback({ ...first, text: 'B' }, first.recordRevision)])
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
        assert.equal(results.filter((r) => r.status === 'rejected').length, 1)
        await s.store.markStale(new Set([s.report.reportId]))
        const stale = (await other.list()).feedback[0]
        assert.equal(stale.status, 'stale')
        const rev = stale.recordRevision
        await s.store.markStale(new Set([s.report.reportId]))
        assert.equal((await other.list()).feedback[0].recordRevision, rev)
        await s.store.releaseBaseline(s.report.reportId)
        assert.ok(await other.get(s.report.reportId))
        await other.deleteFeedback(stale.id, rev)
        assert.equal(await s.store.get(s.report.reportId), undefined)
    } finally {
        await rm(s.dir, { recursive: true, force: true })
    }
})
test('capacity/corruption never evict explicit baselines or reinterpret unsupported data', async () => {
    const s = await fixture()
    try {
        const small = new ReviewEvidenceStore(s.dir, { bytes: 1, metadata: 65536, snapshots: 1, feedback: 1 })
        await assert.rejects(
            small.saveBundle(s.bundle, async () => s.bytes, true),
            /capacity/,
        )
        assert.equal((await s.store.list()).baselines.length, 0)
        await s.store.saveBundle(s.bundle, async () => s.bytes, true)
        await writeFile(join(s.dir, s.report.artifacts[0].sha256), 'corrupt')
        await assert.rejects(s.store.readArtifact(s.bundle, s.report.artifacts[0].id), /missing or changed/)
        await writeFile(join(s.dir, 'index.json'), '{"schemaVersion":999}')
        await assert.rejects(s.store.list(), /invalid or unsupported/)
    } finally {
        await rm(s.dir, { recursive: true, force: true })
    }
})
import {boundedReviewSummary,feedbackProjection} from '../../core/review/summary'
test('deep provenance preserves original anchors after restart; bounded projections do not erase committed record identities',async()=>{const s=await fixture();try{await s.store.saveBundle(s.bundle,async()=>s.bytes,true);const f=record(s.report);f.history=[{at:Date.now(),action:'user-confirmed-remap',anchor:structuredClone(f.anchor)}];const saved=await s.store.putFeedback(f),reopened=(await new ReviewEvidenceStore(s.dir).list()).feedback[0];assert.deepEqual(reopened.history[0].anchor,f.anchor);const projected=feedbackProjection({...saved,anchor:{...saved.anchor,camera:{large:'x'.repeat(40000)}}});assert.equal(projected.id,saved.id);assert.equal(projected.recordRevision,saved.recordRevision);assert.ok(Buffer.byteLength(JSON.stringify(projected))<32768);assert.equal(boundedReviewSummary(projected).id,saved.id);assert.throws(()=>boundedReviewSummary({text:'x'.repeat(32768)}),/32 KiB/)}finally{await rm(s.dir,{recursive:true,force:true})}})
