import { Box3, Matrix3, Matrix4, Vector3 } from 'three'
import type { CsgMesh, CsgOperand } from './types.js'

/** Only bounds and rebasing: CPU picking acceleration is built on demand. */
export function prepareGeometry(meshes: CsgMesh[], operands: CsgOperand[]) {
    let uniqueTriangles = 0
    const localBounds = meshes.map((mesh) => {
        const positions = Buffer.from(mesh.properties, 'base64'),
            box = new Box3()
        uniqueTriangles += Buffer.from(mesh.indices, 'base64').length / 12
        for (let i = 0; i < positions.length; i += mesh.stride * 4) {
            const point = new Vector3(positions.readFloatLE(i), positions.readFloatLE(i + 4), positions.readFloatLE(i + 8))
            if (!point.toArray().every(Number.isFinite)) throw new Error('Nonfinite CSG coordinates.')
            box.expandByPoint(point)
        }
        return box
    })
    if (uniqueTriangles > 2000000) throw new Error('CSG unique triangle resource budget exceeded (2 million).')
    const meshOrigins = localBounds.map((box) => box.getCenter(new Vector3()).toArray())
    const worldBox = new Box3()
    const boxes = operands.map((operand) => {
        const matrix = new Matrix4().fromArray(operand.matrix)
        if (Math.abs(matrix.determinant()) < 1e-30) throw new Error('A singular CSG instance transform cannot define a solid.')
        const box = localBounds[operand.mesh].clone().applyMatrix4(matrix)
        worldBox.union(box)
        operand.normalMatrix = new Matrix3().getNormalMatrix(matrix).toArray()
        return box
    })
    const origin = worldBox.getCenter(new Vector3()).toArray(),
        originVector = new Vector3(...origin)
    operands.forEach((operand, i) => {
        const matrix = new Matrix4().fromArray(operand.matrix).multiply(new Matrix4().makeTranslation(...meshOrigins[operand.mesh]))
        matrix.setPosition(new Vector3().setFromMatrixPosition(matrix).sub(originVector))
        operand.inverse = matrix.invert().toArray()
        operand.bounds = { min: boxes[i].min.sub(originVector).toArray(), max: boxes[i].max.sub(originVector).toArray() }
    })
    const triangleCount = operands.reduce((sum, o) => sum + Buffer.from(meshes[o.mesh].indices, 'base64').length / 12, 0)
    if (triangleCount > 8000000) throw new Error('CSG instance triangle resource budget exceeded (8 million).')
    return { meshOrigins, origin, bounds: { min: worldBox.min.toArray(), max: worldBox.max.toArray() }, triangleCount }
}
