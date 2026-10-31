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
    /** Proven convex primitive; other operands are peeled until GPU exhaustion. */
    convex: boolean
    convexity: number
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
    /** CPU query triangles, never transported to or used by the GPU. */
    triangles: Float32Array
    bvh: CsgBvhNode[]
    origin: [number, number, number]
    bounds: { min: number[]; max: number[] }
    triangleCount: number
}
export interface CsgCachedGeometry {
    mesh: CsgMesh
}

export interface CsgProduct {
    intersections: number[]
    subtractions: number[]
}

export interface CsgPreviewSceneV3 {
    version: 3
    meshes: CsgMesh[]
    operands: CsgOperand[]
    geometryKeys: string[]
    diagnostics: string[]
    program: CsgInstruction[]
    root: number
    /** Physical solid semantics, independent of debug-only Union drawing. */
    topologyRoot: number
    products: CsgProduct[]
    overlays: { root: number; kind: 'highlight' | 'background'; products: CsgProduct[] }[]
    meshOrigins: [number, number, number][]
    triangleCount: number
    origin: [number, number, number]
    bounds: { min: number[]; max: number[] }
    dependencies: { path: string; stamp: string }[]
    timings: { geometryMs: number; normalizationMs: number; resourcesMs?: number; geometryCacheHits?: number }
}

export type CsgScene = CsgPreviewSceneV3
