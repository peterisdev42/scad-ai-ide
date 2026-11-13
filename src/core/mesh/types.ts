import type { CadDependency, CadIssue, CheckStatus, ExecutionStatus } from '../cad/types'
export type Vec3 = [number, number, number]
export type Bounds = { min: Vec3; max: Vec3; dimensions: Vec3 }
export const meshLimits = Object.freeze({ inputBytes: 128 * 1048576, expandedBytes: 256 * 1048576, vertices: 1000000, triangles: 500000, pairs: 5000000, timeoutMs: 60000, arrayBytes: 256 * 1048576, objects: 256 })
export interface RawMesh {
    positions: Float64Array
    indices: Uint32Array
    instanceId: string
    objectId: string
    transform: number[]
    reflected: boolean
}
export interface DecodedMesh {
    expandedBytes?: number
    meshes: RawMesh[]
    format: 'stl' | '3mf'
    units: 'modelUnits' | 'mm'
    sourceUnit: string
    scale: number
    limitations: string[]
    rawVertices: number
    rawTriangles: number
}
export interface MeshTriangleSample {
    triangle: number
    vertices: [Vec3, Vec3, Vec3]
}
export interface MeshFinding {
    code: string
    status: 'FAIL' | 'UNRESOLVED'
    message: string
    instanceId?: string
    triangles: number[]
    point?: Vec3
    triangleSamples?: MeshTriangleSample[]
}
export interface Quantity {
    status: CheckStatus
    value: number | null
    reason?: string
    errorEstimate?: number
}
export interface ComponentFacts {
    id: string
    triangles: number
    signedVolume: Quantity
    parent: string | null
    depth: number | null
}
export interface ObjectFacts {
    instanceId: string
    objectId: string
    vertices: number
    triangles: number
    duplicateVertices: number
    degenerateFaces: number
    duplicateFaces: number
    boundaryEdges: number
    nonManifoldEdges: number
    nonManifoldVertices: number
    inconsistentEdges: number
    componentCount: number
    components: ComponentFacts[]
    bounds: Bounds | null
    surfaceArea: Quantity
    signedVolume: Quantity
    physicalVolume: Quantity
    status: CheckStatus
}
export interface GeometryFacts {
    algorithm: 'raw-mesh-v1'
    precision: 'computed-on-decoded-mesh'
    numericType: 'float64'
    topologyWeld: 'exact'
    objects: ObjectFacts[]
    bounds: Bounds | null
    surfaceArea: Quantity
    signedVolume: Quantity
    physicalVolume: Quantity
    findings: MeshFinding[]
    findingCount: number
    complete: boolean
    pairTests: number
    elapsedMs: number
    units: 'modelUnits' | 'mm'
    sourceUnit: string
    scale: number
    rawVertices: number
    rawTriangles: number
    limitations: string[]
}
export interface MeshCheck {
    id: string
    category: 'compile' | 'format' | 'mesh' | 'measurement'
    required: boolean
    status: CheckStatus
    issueIds: string[]
    reason?: string
}
export interface MeshIssue extends Omit<CadIssue, 'source'> {
    source: 'cli' | 'mesh'
    spatial?: { instanceId?: string; triangles: number[]; point?: Vec3; triangleSamples?: MeshTriangleSample[] }
}
export interface MeshSnapshot {
    schemaVersion: 2
    id: string
    inputEvidenceHash: string
    document: { uri: string; sourceSha256: string; dirty: boolean; version?: number }
    project: { rootUri: string }
    dependencies: CadDependency[]
    inputKind: 'scad' | 'stl' | '3mf'
    runtime: { used: boolean; identityHash?: string; version?: string; executable?: string; backend?: string; commandHash?: string }
    quality: { profile: 'verification'; requestedGlobalTessellation: Record<string, number>; localSettings: 'source-controlled'; exportSelection?: { name: string; value: string | number | boolean }; effectiveOverrides?: import('../cad/types').CadParameters }
    units: 'modelUnits' | 'mm'
    sourceUnit: string
    complete: boolean
    unresolvedInputs: string[]
    policyHash: string
    kernelVersion: string
    sourceSnapshotId?: string
    sourceStateId: string
    meshSha256?: string
}
export interface ArtifactRef {
    id: string
    kind: 'mesh' | 'image' | 'analysis' | 'log'
    mimeType: string
    sha256: string
    bytes: number
    snapshotId: string
    role?: 'raw' | 'render'
    derivation?: { inputSha256: string; numericType: 'float32'; maxCoordinateError: number }
}
export interface MeshReport {
    schemaVersion: 2
    reportId: string
    snapshot: MeshSnapshot
    executionStatus: ExecutionStatus
    overallStatus: CheckStatus
    units: 'modelUnits' | 'mm'
    checks: MeshCheck[]
    issues: MeshIssue[]
    issueCount: number
    facts: GeometryFacts | null
    artifacts: ArtifactRef[]
    examined: string[]
    notExamined: string[]
    incomplete: string[]
    metrics: { elapsedMs: number; truncated: boolean }
    createdAt: number
}
export interface VerifyMeshInput {
    /** Internal trusted selector; never accepted by the public mesh tool schema. */
    exportSelection?: { name: string; value: string | number | boolean }
    uri: string
    projectRoot?: string
    expectedSnapshotId?: string
    mode?: 'verify'
    quality?: 'verification'
    tessellation?: { fn?: number; fa?: number; fs?: number }
    units?: 'mm'
    requireNonEmpty?: boolean
}
export interface MeshReference {
    projectRoot?: string
    quality?: 'verification'
    uri?: string
    reportId?: string
    units?: 'mm'
    tessellation?: VerifyMeshInput['tessellation']
    requireNonEmpty?: boolean
    expectedSnapshotId?: string
}
export type Camera = 'iso' | 'front' | 'top' | 'right' | { eye: Vec3; target: Vec3; projection?: 'orthographic' | 'perspective' }
export interface RenderViewsInput extends MeshReference {
    cameras?: Camera[]
    imageSize?: [number, number]
    delivery?: 'metadata' | 'inline'
}
export const unmeasured = (reason: string): Quantity => ({ status: 'UNRESOLVED', value: null, reason })
export class MeshInputError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly unresolved = false,
    ) {
        super(message)
    }
}
