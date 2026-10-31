import { Box3, Matrix3, Matrix4, Vector3 } from 'three'
import { buildBvh, buildBoundsBvh } from './acceleration.js'
import type { CsgBlas, CsgCachedGeometry, CsgMesh, CsgOperand } from './types.js'

/** Build a local-space BLAS once; instance transforms never duplicate its triangles. */
export function prepareBlas(mesh: CsgMesh): CsgBlas {
    const p = Buffer.from(mesh.properties, 'base64'),
        indices = Buffer.from(mesh.indices, 'base64')
    const box = new Box3(),
        points: Vector3[] = []
    for (let i = 0; i < p.length; i += mesh.stride * 4) {
        const point = new Vector3(p.readFloatLE(i), p.readFloatLE(i + 4), p.readFloatLE(i + 8))
        if (!point.toArray().every(Number.isFinite)) throw new Error('Nonfinite CSG coordinates.')
        points.push(point)
        box.expandByPoint(point)
    }
    const origin = box.getCenter(new Vector3()),
        triangles: number[] = [],
        colors: number[] = []
    for (let i = 0; i < indices.length; i += 12) {
        const ids = [indices.readUInt32LE(i), indices.readUInt32LE(i + 4), indices.readUInt32LE(i + 8)],
            material = i / 12,
            offset = ids[0] * mesh.stride * 4
        const explicit = mesh.stride >= 8 && p.readFloatLE(offset + 28) < 0.5
        colors.push(...(explicit ? [0, 1, 2, 3].map((d) => p.readFloatLE(offset + 12 + d * 4)) : [1, 1, 1, 1]), explicit ? 0 : 1, 0, 0, 0)
        ids.forEach((id, v) => {
            if (!points[id]) throw new Error('Invalid CSG mesh index.')
            triangles.push(...points[id].clone().sub(origin).toArray(), v === 1 ? material : 0)
        })
    }
    const bvh = buildBvh(new Float32Array(triangles))
    return { triangles: Buffer.from(bvh.triangles.buffer).toString('base64'), triangleColors: Buffer.from(new Float32Array(colors).buffer).toString('base64'), bvh: bvh.nodes, origin: origin.toArray(), bounds: { min: box.min.clone().sub(origin).toArray(), max: box.max.clone().sub(origin).toArray() }, triangleCount: indices.length / 12 }
}

export function prepareAcceleration(meshes: CsgMesh[], operands: CsgOperand[], keys: string[], cached: Record<string, CsgCachedGeometry>) {
    let cacheHits = 0
    const blas = meshes.map((mesh, i) => {
        const previous = cached[keys[i]]?.blas
        if (previous) {
            cacheHits++
            return previous
        }
        return prepareBlas(mesh)
    })
    const worldBox = new Box3()
    const boxes = operands.map((operand) => {
        const local = blas[operand.mesh],
            matrix = new Matrix4().fromArray(operand.matrix)
        if (Math.abs(matrix.determinant()) < 1e-30) throw new Error('A singular CSG instance transform cannot define solid intervals.')
        const bounds = new Box3(new Vector3(...local.bounds.min).add(new Vector3(...local.origin)), new Vector3(...local.bounds.max).add(new Vector3(...local.origin))).applyMatrix4(matrix)
        worldBox.union(bounds)
        operand.normalMatrix = new Matrix3().getNormalMatrix(matrix).toArray()
        return bounds
    })
    const origin = worldBox.getCenter(new Vector3()).toArray(),
        originVector = new Vector3(...origin)
    operands.forEach((operand, i) => {
        const local = blas[operand.mesh],
            matrix = new Matrix4().fromArray(operand.matrix).multiply(new Matrix4().makeTranslation(...local.origin))
        matrix.setPosition(new Vector3().setFromMatrixPosition(matrix).sub(originVector))
        operand.inverse = matrix.invert().toArray()
        operand.bounds = { min: boxes[i].min.sub(originVector).toArray(), max: boxes[i].max.sub(originVector).toArray() }
    })
    const triangleCount = operands.reduce((sum, o) => sum + blas[o.mesh].triangleCount, 0)
    if (triangleCount > 8000000) throw new Error('CSG instance triangle resource budget exceeded (8 million).')
    return { blas, tlas: buildBoundsBvh(operands.map((o) => o.bounds)), origin, bounds: { min: worldBox.min.toArray(), max: worldBox.max.toArray() }, triangleCount, cacheHits }
}
