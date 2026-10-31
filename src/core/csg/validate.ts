import type { CsgBvhNode, CsgPreviewSceneV2 } from './types'
import { decodeFloats } from './acceleration'

/** Validate all program, texture and traversal addresses before GPU submission. */
export function validateCsgScene(value: unknown): asserts value is CsgPreviewSceneV2 {
    const scene = value as CsgPreviewSceneV2
    const fail = () => {
        throw new Error('Invalid CSG v2 preview payload.')
    }
    const vector = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(Number.isFinite)
    const bounds = (b: { min: number[]; max: number[] }) => b && vector(b.min, 3) && vector(b.max, 3) && b.min.every((x, d) => x <= b.max[d])
    const bvh = (nodes: CsgBvhNode[], limit: number, instances = false) => {
        if (!Array.isArray(nodes) || !nodes.length || nodes[0].escape !== nodes.length) fail()
        nodes.forEach((n, i) => {
            if (!bounds(n) || !Number.isInteger(n.escape) || n.escape <= i || n.escape > nodes.length || !Number.isInteger(n.first) || !Number.isInteger(n.count) || n.count < 0) fail()
            if (n.first >= 0) {
                if (n.escape !== i + 1 || !n.count || n.first + n.count > limit || (instances && n.count !== 1)) fail()
            } else {
                const left = nodes[i + 1],
                    right = left && nodes[left.escape]
                if (n.count !== 0 || !left || !right || right.escape !== n.escape || left.escape >= n.escape) fail()
            }
        })
    }
    if (!scene || scene.version !== 2 || !Array.isArray(scene.program) || !Array.isArray(scene.operands) || !Array.isArray(scene.meshes) || !Array.isArray(scene.blas) || scene.blas.length !== scene.meshes.length || !vector(scene.origin, 3) || !bounds(scene.bounds) || !Array.isArray(scene.overlays)) fail()
    if (!Number.isInteger(scene.root) || !scene.program[scene.root] || scene.program.length > 100000 || !scene.operands.length || scene.operands.length > 100000) fail()
    scene.program.forEach((instruction, i) => {
        if (instruction.op === 'leaf') {
            if (!Number.isInteger(instruction.operand) || !scene.operands[instruction.operand]) fail()
        } else if (instruction.op !== 'empty' && (!['union', 'difference', 'intersection'].includes(instruction.op) || !Number.isInteger(instruction.left) || !Number.isInteger(instruction.right) || instruction.left < 0 || instruction.right < 0 || instruction.left >= i || instruction.right >= i)) fail()
    })
    let uniqueTriangles = 0,
        totalTriangles = 0
    for (const local of scene.blas) {
        if (!vector(local.origin, 3) || !bounds(local.bounds) || !Number.isInteger(local.triangleCount) || local.triangleCount < 1) fail()
        const triangles = decodeFloats(local.triangles),
            colors = decodeFloats(local.triangleColors)
        if (triangles.length !== local.triangleCount * 12 || colors.length % 8 || !colors.length || !triangles.every(Number.isFinite) || !colors.every(Number.isFinite)) fail()
        for (let i = 0; i < triangles.length; i += 12) if (!Number.isInteger(triangles[i + 7]) || triangles[i + 7] < 0 || triangles[i + 7] * 8 >= colors.length) fail()
        bvh(local.bvh, local.triangleCount)
        uniqueTriangles += local.triangleCount
    }
    for (const operand of scene.operands) {
        if (!Number.isInteger(operand.mesh) || !scene.meshes[operand.mesh] || !vector(operand.matrix, 16) || !vector(operand.inverse, 16) || !vector(operand.normalMatrix, 9) || !vector(operand.color, 4) || !bounds(operand.bounds)) fail()
        totalTriangles += scene.blas[operand.mesh].triangleCount
    }
    if (uniqueTriangles > 2000000 || totalTriangles > 8000000 || totalTriangles !== scene.triangleCount) fail()
    bvh(scene.tlas, scene.operands.length, true)
    for (const overlay of scene.overlays) if (!scene.program[overlay.root] || !['highlight', 'background'].includes(overlay.kind)) fail()
}
