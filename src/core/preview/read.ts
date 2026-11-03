import { createHash } from 'node:crypto'
import { Matrix3, Matrix4, Vector3 } from 'three'
import { EXPORTER_COMMIT, EXPORTER_TAG, type PreparedScene, type PreviewScene } from './types'
export const PREVIEW_LIMITS = { bytes: 64 * 1048576, meshes: 4096, instances: 16384, triangles: 2000000, vertices: 4000000, products: 100000, literals: 1000000 }
const fail = (message: string): never => {
    throw new Error(`Invalid Preview Exporter scene: ${message}`)
}
const list = (v: unknown, limit: number): unknown[] => (Array.isArray(v) && v.length <= limit ? v : fail('array missing or exceeds budget'))
const record = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : fail('object required'))
const tuple = (v: unknown, n: number): number[] => {
    const a = list(v, n)
    if (a.length !== n || !a.every((x) => typeof x === 'number' && Number.isFinite(x))) fail('finite numeric tuple required')
    return a as number[]
}
const index = (v: unknown, n: number): number => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v < n ? v : fail('index out of bounds'))
export function validatePreparedScene(value: unknown): asserts value is PreparedScene {
    const s = record(value)
    if (s.schemaVersion !== 1 || s.matrixOrder !== 'row-major' || s.upstreamTag !== EXPORTER_TAG || s.upstreamCommit !== EXPORTER_COMMIT || s.source !== 'OpenSCAD CSGTreeEvaluator/CSGTreeNormalizer/CSGProducts') fail('schema or source version mismatch')
    const meshes = list(s.meshes, PREVIEW_LIMITS.meshes),
        instances = list(s.instances, PREVIEW_LIMITS.instances)
    let triangles = 0,
        vertices = 0,
        literals = 0,
        products = 0
    for (const mesh of meshes) {
        const m = record(mesh),
            positions = list(m.positions, PREVIEW_LIMITS.vertices),
            indices = list(m.indices, PREVIEW_LIMITS.triangles)
        vertices += positions.length
        triangles += indices.length
        if (!positions.length || !indices.length || vertices > PREVIEW_LIMITS.vertices || triangles > PREVIEW_LIMITS.triangles) fail('geometry budget or empty mesh')
        positions.forEach((p) => tuple(p, 3))
        for (const t of indices) {
            const ids = tuple(t, 3)
            ids.forEach((i) => index(i, positions.length))
            if (new Set(ids).size !== 3) fail('degenerate triangle indices')
        }
    }
    for (const instance of instances) {
        const i = record(instance)
        index(i.mesh, meshes.length)
        const m = tuple(i.matrix, 16),
            matrix = new Matrix4().fromArray(m).transpose()
        if (m[12] !== 0 || m[13] !== 0 || m[14] !== 0 || m[15] !== 1 || !Number.isFinite(matrix.determinant()) || matrix.determinant() === 0) fail('non-affine or singular transform')
        const c = tuple(i.color, 4)
        if (!c.every((x) => x === -1) && !c.every((x) => x >= 0 && x <= 1)) fail('invalid RGBA')
        if (typeof i.convexity !== 'number' || !Number.isSafeInteger(i.convexity) || i.convexity < 1 || i.convexity > 1000000) fail('invalid convexity')
    }
    for (const group of [s.products, s.highlights, s.backgrounds])
        for (const product of list(group, PREVIEW_LIMITS.products)) {
            if (++products > PREVIEW_LIMITS.products) fail('product budget')
            const p = record(product),
                positive = list(p.intersections, PREVIEW_LIMITS.literals),
                negative = list(p.subtractions, PREVIEW_LIMITS.literals)
            if (!positive.length) fail('product needs an intersection')
            const seen = new Set<number>()
            for (const term of [...positive, ...negative]) {
                if (++literals > PREVIEW_LIMITS.literals) fail('literal budget')
                const t = record(term),
                    id = index(t.id, instances.length)
                if (seen.has(id)) fail('duplicate or contradictory product literal')
                seen.add(id)
                if (typeof t.flags !== 'number' || !Number.isSafeInteger(t.flags) || t.flags < 0 || t.flags > 3) fail('unknown term flags')
            }
        }
}
const encode = (data: Float32Array | Uint32Array) => Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64')
export function convertPreparedScene(value: unknown): PreviewScene {
    const started = performance.now()
    validatePreparedScene(value)
    const validationMs = performance.now() - started,
        conversionStarted = performance.now()
    const s = value
    const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    const meshOrigins = s.meshes.map(
        (m) =>
            [0, 1, 2].map((d) => {
                let min = Infinity,
                    max = -Infinity
                for (const p of m.positions) {
                    min = Math.min(min, p[d])
                    max = Math.max(max, p[d])
                }
                return min / 2 + max / 2
            }) as [number, number, number],
    )
    const meshScales = s.meshes.map((m, k) => {
        let scale = 0
        for (const p of m.positions) for (let d = 0; d < 3; d++) scale = Math.max(scale, Math.abs(p[d] - meshOrigins[k][d]) * 2)
        if (!Number.isFinite(scale) || scale === 0) fail('degenerate or unrepresentable mesh extent')
        return scale
    })
    const instances = s.instances.map((i) => {
        const matrix = new Matrix4().fromArray(i.matrix).transpose(),
            box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
        for (const p of s.meshes[i.mesh].positions) {
            const v = new Vector3(...(p as [number, number, number])).applyMatrix4(matrix).toArray()
            if (!v.every(Number.isFinite)) fail('unrepresentable transformed coordinates')
            for (let d = 0; d < 3; d++) {
                box.min[d] = Math.min(box.min[d], v[d])
                box.max[d] = Math.max(box.max[d], v[d])
                bounds.min[d] = Math.min(bounds.min[d], v[d])
                bounds.max[d] = Math.max(bounds.max[d], v[d])
            }
        }
        return { ...i, matrix: matrix.toArray(), inverse: [] as number[], normalMatrix: new Matrix3().getNormalMatrix(matrix).toArray(), bounds: box, color: (i.color[0] === -1 ? [1, 1, 1, 1] : i.color) as [number, number, number, number], defaultColor: i.color[0] === -1 }
    })
    if (!instances.length) {
        bounds.min.fill(0)
        bounds.max.fill(0)
    }
    if (bounds.max.some((x, d) => !Number.isFinite(x - bounds.min[d]))) fail('unrepresentable scene extent')
    const origin = bounds.min.map((x, d) => x / 2 + bounds.max[d] / 2) as [number, number, number]
    for (const i of instances) {
        const m = new Matrix4()
            .fromArray(i.matrix)
            .multiply(new Matrix4().makeTranslation(...meshOrigins[i.mesh]))
            .multiply(new Matrix4().makeScale(meshScales[i.mesh], meshScales[i.mesh], meshScales[i.mesh]))
        for (let d = 0; d < 3; d++) {
            m.elements[12 + d] -= origin[d]
            i.bounds.min[d] -= origin[d]
            i.bounds.max[d] -= origin[d]
        }
        if (!Number.isFinite(m.determinant()) || m.determinant() === 0) fail('unrepresentable normalized transform')
        i.inverse = m.invert().toArray()
        if (!i.inverse.every((x) => Number.isFinite(Math.fround(x)))) fail('transform exceeds GPU precision range')
    }
    const meshes = s.meshes.map((m, k) => {
        const p = new Float32Array(m.positions.length * 3)
        m.positions.forEach((v, j) =>
            v.forEach((x, d) => {
                const local = (x - meshOrigins[k][d]) / meshScales[k],
                    f = Math.fround(local)
                if (!Number.isFinite(f) || Math.abs(f - local) > Math.max(1e-5, Math.abs(local) * 2e-7)) fail('Float32 precision loss')
                p[j * 3 + d] = f
            }),
        )
        return { properties: encode(p), indices: encode(new Uint32Array(m.indices.flat())), stride: 3 }
    })
    return { version: 'preview-scene-1', provenance: { tag: s.upstreamTag, commit: s.upstreamCommit, source: s.source }, meshes, instances, products: s.products, highlights: s.highlights, backgrounds: s.backgrounds, overlays: [...(s.highlights.length ? [{ group: 'highlights' as const, kind: 'highlight' as const }] : []), ...(s.backgrounds.length ? [{ group: 'backgrounds' as const, kind: 'background' as const }] : [])], geometryKeys: meshes.map((m) => createHash('sha256').update(m.properties).update(m.indices).digest('hex')), triangleCount: s.meshes.reduce((n, m) => n + m.indices.length, 0), origin, bounds, dependencies: [], timings: { readParseMs: 0, validationMs, conversionMs: performance.now() - conversionStarted } }
}
export function readPreviewScene(bytes: Uint8Array): PreviewScene {
    if (bytes.byteLength > PREVIEW_LIMITS.bytes) fail('file byte budget')
    const started = performance.now(),
        value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        readParseMs = performance.now() - started
    const scene = convertPreparedScene(value)
    scene.timings.readParseMs = readParseMs
    scene.timings.jsonParseMs = readParseMs
    return scene
}
