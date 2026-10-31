import type { CsgScene, CsgProduct } from './types'
import { decodeFloats, decodeIndices } from './acceleration'

/** Validate the versioned geometry/product transport before GPU submission. */
export function validateCsgScene(value: unknown): asserts value is CsgScene {
    const scene = value as CsgScene
    const fail = () => {
        throw new Error('Invalid CSG v3 preview payload.')
    }
    const vector = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(Number.isFinite)
    const bounds = (b: { min: number[]; max: number[] }) => b && vector(b.min, 3) && vector(b.max, 3) && b.min.every((x, d) => x <= b.max[d])
    if (!scene || scene.version !== 3 || !Array.isArray(scene.program) || !Array.isArray(scene.operands) || !Array.isArray(scene.meshes) || !Array.isArray(scene.meshOrigins) || scene.meshOrigins.length !== scene.meshes.length || !vector(scene.origin, 3) || !bounds(scene.bounds) || !Array.isArray(scene.overlays) || !Array.isArray(scene.geometryKeys) || scene.geometryKeys.length !== scene.meshes.length || !Array.isArray(scene.diagnostics)) fail()
    if (!Number.isInteger(scene.root) || !scene.program[scene.root] || !Number.isInteger(scene.topologyRoot) || !scene.program[scene.topologyRoot] || scene.program.length > 8192 || !scene.operands.length || scene.operands.length > 2048 || scene.meshes.length > 2048) fail()
    scene.program.forEach((instruction, i) => {
        if (!instruction || typeof instruction !== 'object') fail()
        if (instruction.op === 'leaf') {
            if (!Number.isInteger(instruction.operand) || !scene.operands[instruction.operand]) fail()
        } else if (instruction.op !== 'empty' && (!['union', 'difference', 'intersection'].includes(instruction.op) || !Number.isInteger(instruction.left) || !Number.isInteger(instruction.right) || instruction.left < 0 || instruction.right < 0 || instruction.left >= i || instruction.right >= i)) fail()
    })
    let uniqueTriangles = 0,
        totalTriangles = 0,
        bytes = 0
    const counts = scene.meshes.map((mesh, i) => {
        if (!mesh || typeof mesh !== 'object') fail()
        if (!Number.isInteger(mesh.stride) || mesh.stride < 3 || mesh.stride > 32 || !vector(scene.meshOrigins[i], 3) || typeof mesh.properties !== 'string' || typeof mesh.indices !== 'string') fail()
        bytes += (mesh.properties.length + mesh.indices.length) * 0.75
        if (bytes > 256 * 1048576) fail()
        const positions = decodeFloats(mesh.properties),
            indices = decodeIndices(mesh.indices)
        if (!positions.length || positions.length % mesh.stride || !positions.every(Number.isFinite) || !indices.length || indices.length % 3 || indices.some((index) => index >= positions.length / mesh.stride)) fail()
        uniqueTriangles += indices.length / 3
        return indices.length / 3
    })
    for (const operand of scene.operands) {
        if (!operand || typeof operand !== 'object') fail()
        if (!Number.isInteger(operand.mesh) || !scene.meshes[operand.mesh] || !vector(operand.matrix, 16) || !vector(operand.inverse, 16) || !vector(operand.normalMatrix, 9) || !vector(operand.color, 4) || !bounds(operand.bounds) || typeof operand.closed !== 'boolean' || typeof operand.convex !== 'boolean' || !Number.isInteger(operand.convexity) || operand.convexity < 1) fail()
        totalTriangles += counts[operand.mesh]
    }
    if (uniqueTriangles > 2000000 || totalTriangles > 8000000 || totalTriangles !== scene.triangleCount) fail()
    let literals = 0
    const products = (ps: CsgProduct[]) => {
        if (!Array.isArray(ps) || ps.length > 4096) fail()
        for (const product of ps) {
            if (!Array.isArray(product.intersections) || !Array.isArray(product.subtractions) || !product.intersections.length) fail()
            const ids = [...product.intersections, ...product.subtractions]
            literals += ids.length
            if (literals > 65536 || ids.some((id) => !Number.isInteger(id) || !scene.operands[id]) || new Set(ids).size !== ids.length) fail()
        }
    }
    products(scene.products)
    for (const overlay of scene.overlays) {
        if (!scene.program[overlay.root] || !['highlight', 'background'].includes(overlay.kind)) fail()
        products(overlay.products)
    }
}
