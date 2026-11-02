import type { PreviewTimings } from './performance'
/** Preview Exporter v1; all geometry and products originate in OpenSCAD C++. */
export const EXPORTER_TAG = 'openscad-2026.11-RC0'
export const EXPORTER_COMMIT = '9ba0cee7c94785fac0ca8dfe040b965a12a25ed1'
export interface PreviewTerm {
    id: number
    flags: number
}
export interface PreviewProduct {
    intersections: PreviewTerm[]
    subtractions: PreviewTerm[]
}
export interface PreparedScene {
    schemaVersion: 1
    source: string
    upstreamTag: string
    upstreamCommit: string
    matrixOrder: 'row-major'
    meshes: { positions: number[][]; indices: number[][] }[]
    instances: { mesh: number; matrix: number[]; color: number[]; convexity: number }[]
    products: PreviewProduct[]
    highlights: PreviewProduct[]
    backgrounds: PreviewProduct[]
}
export interface GeometryMesh {
    offset?: [number, number, number]
    properties: string
    indices: string
    stride: number
}
export interface ClipPlane {
    normal: [number, number, number]
    constant: number
}
export interface GeometryData {
    version: 1
    origin?: [number, number, number]
    meshes: GeometryMesh[]
}
export interface Bounds {
    min: number[]
    max: number[]
}
export interface BvhNode extends Bounds {
    first: number
    count: number
    escape: number
}
export interface Blas {
    triangles: Float32Array
    bvh: BvhNode[]
    origin: [number, number, number]
    bounds: Bounds
    triangleCount: number
}
export type PreviewGroup = 'products' | 'highlights' | 'backgrounds'
/** No expression tree, CPU boolean evaluator or normalized-program compatibility. */
export interface PreviewScene {
    version: 'preview-scene-1'
    provenance: { tag: string; commit: string; source: string }
    meshes: GeometryMesh[]
    instances: { mesh: number; matrix: number[]; inverse: number[]; normalMatrix: number[]; color: [number, number, number, number]; defaultColor: boolean; convexity: number; bounds: Bounds }[]
    products: PreviewProduct[]
    highlights: PreviewProduct[]
    backgrounds: PreviewProduct[]
    overlays: { group: 'highlights' | 'backgrounds'; kind: 'highlight' | 'background' }[]
    origin: [number, number, number]
    bounds: Bounds
    geometryKeys: string[]
    triangleCount: number
    dependencies: { path: string; stamp: string }[]
    timings: PreviewTimings & { readParseMs: number; conversionMs: number }
}
