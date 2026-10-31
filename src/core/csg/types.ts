/** Binary geometry buffers encoded for the existing webview message transport. */
export interface CsgMesh {
    properties: string
    indices: string
    stride: number
}
export interface CsgClipPlane {
    normal: [number, number, number]
    constant: number
}
export interface CsgGeometry {
    /** Mesh positions are relative to this double precision origin when present. */
    origin?: [number, number, number]
    version: 1
    meshes: CsgMesh[]
}

export type CsgInstruction = { op: 'leaf'; operand: number } | { op: 'union' | 'intersection' | 'difference'; left: number; right: number } | { op: 'empty' }

export interface CsgOperand {
    mesh: number
    matrix: number[]
    color: [number, number, number, number]
    defaultColor: boolean
    source: string
    closed: boolean
    inverse: number[]
    normalMatrix: number[]
    bounds: { min: number[]; max: number[] }
}

/** Stackless BVH: two bounds and an escape link; negative first means branch. */
export interface CsgBvhNode {
    min: number[]
    max: number[]
    first: number
    count: number
    escape: number
}

export interface CsgBlas {
    /** Local mesh coordinates, rebased by origin. B.w indexes triangleColors. */
    triangles: string
    triangleColors: string
    bvh: CsgBvhNode[]
    origin: [number, number, number]
    bounds: { min: number[]; max: number[] }
    triangleCount: number
}
export interface CsgCachedGeometry {
    mesh: CsgMesh
    blas: CsgBlas
}

export interface CsgPreviewSceneV2 {
    version: 2
    meshes: CsgMesh[]
    operands: CsgOperand[]
    geometryKeys: string[]
    diagnostics: string[]
    program: CsgInstruction[]
    root: number
    overlays: { root: number; kind: 'highlight' | 'background' }[]
    blas: CsgBlas[]
    tlas: CsgBvhNode[]
    triangleCount: number
    origin: [number, number, number]
    bounds: { min: number[]; max: number[] }
    dependencies: { path: string; stamp: string }[]
    timings: { geometryMs: number; bvhMs: number; resourcesMs?: number; bvhCacheHits?: number }
}

export type CsgScene = CsgPreviewSceneV2
