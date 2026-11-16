import type { AssemblyReport, Interval, PartDeclaration } from '../assembly/types'
import type { MeshReport, GeometryFacts, Vec3, ArtifactRef } from '../mesh/types'
export type VerificationEvidence = MeshReport | AssemblyReport
export interface SubjectInput {
    id: string | null
    bytes: Uint8Array
    format: 'stl' | '3mf'
    transform?: PartDeclaration['transform']
    worldMatrix?: number[]
    units: 'mm' | 'modelUnits'
}
export interface SubjectDigest {
    id: string | null
    geometryHash: string
    anchorHash: string
    triangles: number
    vertices: number
}
export interface ReviewIssue {
    id: string
    code: string
    title: string
    source: 'diff' | 'print'
    status: 'FAIL' | 'UNRESOLVED'
    severity: 'error' | 'warning'
    location: { uri: string; line: number; character: number; confidence: 'exact' | 'fallback' }
    relatedTrace: string[]
    evidenceIds: string[]
    partIds?: string[]
    spatial?: unknown
}
export interface ComparisonRow {
    partId: string | null
    status: 'added' | 'removed' | 'changed' | 'unchanged' | 'unresolved'
    geometryChanged: boolean | null
    placementChanged: boolean | null
    baseline?: SubjectDigest
    target?: SubjectDigest
    metrics: { baseline: Record<string, unknown> | null; target: Record<string, unknown> | null }
    protected: boolean
}
export interface ComparisonReport {
    kind: 'comparison'
    schemaVersion: 1
    reportId: string
    baselineReportId: string
    targetReportId: string
    baselineModelStatus: string
    targetModelStatus: string
    baselineSnapshotId: string
    targetSnapshotId: string
    ownerUri: string
    units: 'mm' | 'modelUnits'
    comparisonStatus: 'COMPLETE' | 'PARTIAL' | 'INCOMPATIBLE'
    regressionStatus: 'REGRESSIONS_FOUND' | 'NO_REGRESSIONS_FOUND' | 'UNRESOLVED'
    rows: ComparisonRow[]
    checks: Array<{ id: string; baseline?: string; target?: string; baselineRecheck?: string; definitionChanged: boolean; transition: string }>
    issues: ReviewIssue[]
    incomplete: string[]
    expectUnchangedPartIds: string[]
    createdAt: number
}
export interface PrintProfile {
    schemaVersion: 1
    units: 'mm'
    process: 'fdm'
    buildVolumeMm: Vec3
    buildPose: { rotate: Vec3; translate: Vec3 }
    maxOverhangFromVerticalDeg: number
}
export interface PrintResult {
    envelope: { status: 'PASS' | 'FAIL' | 'UNRESOLVED'; bounds: { min: Interval[]; max: Interval[] } | null }
    overhang: { status: 'CANDIDATES_FOUND' | 'NONE_FOUND' | 'UNRESOLVED'; complete: boolean; candidateCount: number; uncertainCount: number; candidateArea: number; samples: Array<{ triangle: number; instanceId: string; point: Vec3; normal: Vec3; angleDeg: number }> }
    incomplete: string[]
}
export interface PrintAssessment {
    kind: 'print-assessment'
    schemaVersion: 1
    reportId: string
    sourceReportId: string
    snapshotId: string
    ownerUri: string
    profileUri: string
    profileDigest: string
    profileContentHash: string
    profile: PrintProfile
    partId: string | null
    units: 'mm'
    assessmentStatus: 'COMPLETE' | 'PARTIAL'
    printability: 'NOT_CHECKED'
    result: PrintResult
    issues: ReviewIssue[]
    notChecked: string[]
    createdAt: number
}
export type DerivedReport = ComparisonReport | PrintAssessment
export interface Anchor {
    reportId: string
    snapshotId: string
    revision: string
    partId: string | null
    objectId: string
    anchorHash: string
    triangle: number
    mesh: number
    position: Vec3
    localPosition: Vec3
    normal: Vec3
    localNormal: Vec3
    matrix: number[]
    units: 'mm' | 'modelUnits'
    camera: unknown
    source: { uri: string; selector?: unknown; instanceId: string; sourceTriangle: number; confidence: 'mesh-only' }
}
export interface FeedbackRecord {
    schemaVersion: 1
    id: string
    recordRevision: number
    ownerUri: string
    status: 'open' | 'resolved' | 'stale'
    text: string
    anchor: Anchor
    history: Array<{ at: number; action: string; fromSnapshotId?: string; toSnapshotId?: string; method?: string }>
    createdAt: number
    updatedAt: number
}
export interface RemapCandidate {
    id: string
    feedbackId: string
    recordRevision: number
    targetReportId: string
    targetSnapshotId: string
    partId: string
    anchorHash: string
    method: 'identical-local-mesh-rigid-transform'
    confidence: 'proven-mesh-identity'
    position: Vec3
    normal: Vec3
    matrix: number[]
}
export interface PersistedBundle {
    schemaVersion: 1
    report: VerificationEvidence
    retainedArtifacts: ArtifactRef[]
    savedAt: number
    label?: string
}
export const reviewLimits = Object.freeze({ persistentBytes: 1024 * 1048576, metadataBytes: 64 * 1048576, snapshots: 32, feedback: 1000, textBytes: 2048, summaryBytes: 32768, viewBytes: 128 * 1048576, views: 2, markers: 200, chunkBytes: 4 * 1048576, workerMs: 60000, totalMs: 600000, pointingMs: 120000, maxPointingMs: 240000 })
