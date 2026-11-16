import { digest } from '../cad/snapshot'
import { matrix } from '../assembly/AssemblyKernel'
import type { Anchor, FeedbackRecord, RemapCandidate, VerificationEvidence } from './types'
import type { Vec3 } from '../mesh/types'
export function anchorDigest(bytesSha: string, format: 'stl' | '3mf', units: 'mm' | 'modelUnits') {
    return digest(JSON.stringify({ bytes: bytesSha, format, units, decoder: 'raw-mesh-v1' }))
}
export function remapCandidate(f: FeedbackRecord, target: VerificationEvidence): RemapCandidate | null {
    if (f.status !== 'stale' || target.schemaVersion !== 3 || f.anchor.partId === null || target.snapshot.document.uri !== f.ownerUri) return null
    const source = target.snapshot.sources.find((s) => s.partId === f.anchor.partId),
        raw = source?.sourceReport.artifacts.find((a) => a.role === 'raw')
    if (!source || !raw || anchorDigest(raw.sha256, raw.mimeType === 'model/3mf' ? '3mf' : 'stl', 'mm') !== f.anchor.anchorHash) return null
    const m = target.facts?.parts.find((p) => p.id === f.anchor.partId)?.matrix ?? matrix(source.transform),
        p = f.anchor.localPosition,
        n = f.anchor.localNormal
    if (m.length !== 16 || m.some((n) => !Number.isFinite(n))) return null
    const position = [0, 1, 2].map((k) => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]) as Vec3,
        normal = [0, 1, 2].map((k) => m[k] * n[0] + m[4 + k] * n[1] + m[8 + k] * n[2]) as Vec3,
        length = Math.hypot(...normal)
    if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-8) return null
    return { id: digest([f.id, f.recordRevision, target.snapshot.id, m]), feedbackId: f.id, recordRevision: f.recordRevision, targetReportId: target.reportId, targetSnapshotId: target.snapshot.id, partId: f.anchor.partId, anchorHash: f.anchor.anchorHash, method: 'identical-local-mesh-rigid-transform', confidence: 'proven-mesh-identity', position, normal: normal.map((v) => v / length) as Vec3, matrix: m }
}
export function acceptedRemap(anchor: Anchor, c: RemapCandidate, source: Anchor['source']): Anchor {
    return { ...anchor, reportId: c.targetReportId, snapshotId: c.targetSnapshotId, revision: c.targetSnapshotId, position: c.position, normal: c.normal, matrix: c.matrix, source }
}
