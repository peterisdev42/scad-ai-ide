import type { ArtifactRef, Bounds, GeometryFacts, MeshReport, Vec3, VerifyMeshInput } from '../mesh/types'
import type { CheckStatus } from '../cad/types'
export type Scalar = string | number | boolean
export type Selector = { type: 'define'; name: string; value: Scalar; entry?: string } | { type: 'file'; path: string }
export interface PartDeclaration {
    id: string
    name?: string
    selector: Selector
    transform?: { translate?: Vec3; rotate?: Vec3 }
}
interface RuleBase {
    id: string
    required?: boolean
    why?: string
}
export type Rule = RuleBase &
    (
        | { type: 'clearance'; parts: [string, string]; min: number; max?: number; allowContact?: boolean }
        | { type: 'relation'; parts: [string, string]; allowed: Array<'clear' | 'contact' | 'overlap'> }
        | { type: 'mesh-validity'; part: string; watertight?: true; manifold?: true }
        | { type: 'bounds'; part: string; minDimensions?: Vec3; maxDimensions?: Vec3; frame?: 'local' | 'assembly' }
        | { type: 'volume'; part: string; min?: number; max?: number }
    )
export interface Manifest {
    schemaVersion: 1
    units: 'mm'
    entry?: string
    parts: PartDeclaration[]
    checks: Rule[]
}
export interface ConfigIssue {
    code: string
    message: string
    pointer: string
    offset: number
    length: number
}
export interface Registry {
    manifest: Manifest | null
    digest: string
    contentHash: string
    issues: ConfigIssue[]
}
export interface Interval {
    lower: number
    upper: number
}
export type SurfaceRelation = 'clear' | 'contact' | 'overlap' | 'undetermined'
export interface PairFacts {
    pairId: string
    parts: [string, string]
    relation: SurfaceRelation
    minDistance: number | null
    distanceBound: Interval | null
    closestPoints: [Vec3, Vec3] | null
    witnessCoordinateBounds: [Interval[], Interval[]] | null
    triangles: [number, number] | null
    contained: boolean | null
    overlapVolume: null
    overlapVolumeStatus: 'notChecked'
    method: 'exact-dyadic-bvh-v1'
    complete: boolean
    reason?: string
    errorBound: number | null
    durationMs: number
}
export interface KernelPartInput {
    id: string
    bytes: Uint8Array
    format: 'stl' | '3mf'
    transform: PartDeclaration['transform']
}
export interface PartFacts {
    id: string
    local: GeometryFacts
    world: GeometryFacts
    matrix: number[]
    volumeBound: Interval | null
    localDimensions: Interval[] | null
    worldDimensions: Interval[] | null
}
export interface KernelResult {
    parts: PartFacts[]
    pairs: PairFacts[]
    complete: boolean
    incomplete: string[]
    candidateTests: number
    worldMesh?: Uint8Array
    display?: { bytes: Uint8Array; maxCoordinateError: number }
}
export interface AssemblyCheck {
    id: string
    required: boolean
    status: CheckStatus
    reason?: string
    pairId?: string
    relation?: SurfaceRelation | 'clearanceViolation'
    issueIds: string[]
}
export interface AssemblyIssue {
    id: string
    code: string
    title: string
    source: 'cli' | 'mesh' | 'manifest' | 'assembly' | 'constraints'
    severity: 'error' | 'warning' | 'information'
    status: 'FAIL' | 'UNRESOLVED'
    location: { uri: string; line: number; character: number; confidence: 'exact' | 'fallback' }
    relatedTrace: string[]
    evidenceIds: string[]
    partIds?: string[]
    pairId?: string
    pointer?: string
    spatial?: unknown
}
export interface AssemblySource {
    partId: string
    uri: string
    selector: Selector
    sourceReport: MeshReport
    transform: PartDeclaration['transform']
}
export interface AssemblyReport {
    schemaVersion: 3
    reportId: string
    snapshot: {
        schemaVersion: 3
        id: string
        document: { uri: string; sourceSha256: string; dirty: boolean }
        project: { rootUri: string }
        dependencies: Array<{ uri: string; status: 'resolved'; dirty: boolean }>
        manifestDigest: string
        manifest: Manifest | null
        sources: AssemblySource[]
        requirementsHash: string
        algorithm: 'exact-dyadic-bvh-v1'
        complete: boolean
    }
    executionStatus: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT'
    overallStatus: CheckStatus
    units: 'mm'
    checks: AssemblyCheck[]
    issues: AssemblyIssue[]
    artifacts: ArtifactRef[]
    facts: KernelResult | null
    incomplete: string[]
    examined: string[]
    notExamined: string[]
    createdAt: number
}
export interface AssemblyInput {
    uri?: string
    reportId?: string
    pairIds?: string[]
    expectedManifestDigest?: string
    expectedSnapshotId?: string
    quality?: 'verification'
    tessellation?: VerifyMeshInput['tessellation']
}
export const assemblyLimits = Object.freeze({
    parts: 32,
    checks: 128,
    pairs: 512,
    candidates: 5000000,
    vertices: 1000000,
    triangles: 500000,
    inputBytes: 128 * 1048576,
    expandedBytes: 256 * 1048576,
    arrayBytes: 256 * 1048576,
    totalMs: 600000,
    workerMs: 60000,
    summaryBytes: 32768,
})
export type { Bounds, Vec3, CheckStatus }
