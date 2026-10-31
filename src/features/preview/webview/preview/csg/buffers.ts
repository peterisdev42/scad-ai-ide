import type { CsgBvhNode, CsgPreviewSceneV2 } from '../../../../../core/csg/types'
import { decodeFloats } from '../../../../../core/csg/acceleration'

export function packCsgBuffers(scene: CsgPreviewSceneV2): Float32Array[] {
    const uniqueTriangles = scene.blas.reduce((n, b) => n + b.triangleCount, 0),
        uniqueNodes = scene.blas.reduce((n, b) => n + b.bvh.length, 0),
        colorFloats = scene.blas.reduce((n, b) => n + decodeFloats(b.triangleColors).length, 0)
    const triangles = new Float32Array(uniqueTriangles * 12),
        nodes = new Float32Array(uniqueNodes * 12),
        colors = new Float32Array(colorFloats),
        instances = new Float32Array(scene.operands.length * 40)
    const encode = (target: Float32Array, n: CsgBvhNode, index: number, triangleOffset = 0, nodeOffset = 0) => target.set([...n.min, n.first < 0 ? -1 : n.first + triangleOffset, ...n.max, n.count, n.escape + nodeOffset, 0, 0, 0], index * 12)
    const roots: number[] = [],
        ends: number[] = []
    let triangleOffset = 0,
        nodeOffset = 0,
        colorOffset = 0
    for (const local of scene.blas) {
        roots.push(nodeOffset)
        ends.push(nodeOffset + local.bvh.length)
        const data = decodeFloats(local.triangles)
        for (let i = 0; i < data.length; i += 12) data[i + 7] += colorOffset / 8
        triangles.set(data, triangleOffset * 12)
        colors.set(decodeFloats(local.triangleColors), colorOffset)
        local.bvh.forEach((n, i) => encode(nodes, n, nodeOffset + i, triangleOffset, nodeOffset))
        triangleOffset += local.triangleCount
        nodeOffset += local.bvh.length
        colorOffset += decodeFloats(local.triangleColors).length
    }
    const tlas = new Float32Array(scene.tlas.length * 12)
    scene.tlas.forEach((n, i) => encode(tlas, n, i))
    scene.operands.forEach((o, i) => {
        instances.set(o.inverse, i * 40)
        for (let column = 0; column < 3; column++) instances.set([...o.normalMatrix.slice(column * 3, column * 3 + 3), 0], i * 40 + 16 + column * 4)
        instances.set([roots[o.mesh], ends[o.mesh], 0, 0, ...o.color, o.defaultColor ? 1 : 0, 0, 0, 0], i * 40 + 28)
    })
    return [triangles, nodes, colors, tlas, instances]
}
