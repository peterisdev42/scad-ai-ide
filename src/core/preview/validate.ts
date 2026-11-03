import type { PreviewScene } from './types'
import { EXPORTER_COMMIT, EXPORTER_TAG } from './types'
import { decodeFloats, decodeIndices } from './query'
export function validatePreviewScene(scene: PreviewScene) {
    if (scene?.version !== 'preview-scene-1' || scene.provenance?.commit !== EXPORTER_COMMIT || scene.provenance?.tag !== EXPORTER_TAG || scene.provenance?.source !== 'OpenSCAD CSGTreeEvaluator/CSGTreeNormalizer/CSGProducts') throw new Error('Unsupported preview scene/provenance.')
    if (!Array.isArray(scene.instances) || !Array.isArray(scene.meshes) || scene.instances.length > 16384 || scene.meshes.length > 4096) throw new Error('Invalid preview scene budget.')
    if (scene.geometryKeys.length !== scene.meshes.length) throw new Error('Invalid preview mesh metadata.')
    const tuple = (a: number[], n: number) => {
        if (!Array.isArray(a) || a.length !== n || !a.every(Number.isFinite)) throw new Error('Invalid preview numeric tuple.')
    }
    tuple(scene.origin, 3)
    tuple(scene.bounds.min, 3)
    tuple(scene.bounds.max, 3)
    let triangles = 0,
        bytes = 0
    for (const mesh of scene.meshes) {
        bytes += mesh.properties.length + mesh.indices.length
        if (bytes > 128 * 1048576 || mesh.stride !== 3) throw new Error('Invalid preview mesh buffer budget.')
        const p = decodeFloats(mesh.properties),
            indices = decodeIndices(mesh.indices)
        triangles += indices.length / 3
        if (!p.length || p.length % 3 || indices.length % 3 || triangles > 2000000 || !p.every(Number.isFinite) || !indices.every((i) => i < p.length / 3)) throw new Error('Invalid preview geometry.')
    }
    for (const i of scene.instances) {
        if (!Number.isSafeInteger(i.convexity) || i.convexity < 1 || i.convexity > 1000000 || typeof i.defaultColor !== 'boolean' || !i.color.every((c) => c >= 0 && c <= 1)) throw new Error('Invalid preview instance metadata.')
        if (!Number.isSafeInteger(i.mesh) || i.mesh < 0 || i.mesh >= scene.meshes.length) throw new Error('Invalid mesh reference.')
        tuple(i.matrix, 16)
        tuple(i.inverse, 16)
        tuple(i.normalMatrix, 9)
        tuple(i.color, 4)
        tuple(i.bounds.min, 3)
        tuple(i.bounds.max, 3)
    }
    let literals = 0
    for (const products of [scene.products, scene.highlights, scene.backgrounds]) {
        if (!Array.isArray(products) || products.length > 100000) throw new Error('Invalid preview products.')
        for (const p of products) {
            if (!Array.isArray(p.intersections) || !Array.isArray(p.subtractions) || !p.intersections.length) throw new Error('Invalid product.')
            for (const t of [...p.intersections, ...p.subtractions]) {
                if (++literals > 1000000 || !Number.isSafeInteger(t.id) || t.id < 0 || t.id >= scene.instances.length || !Number.isSafeInteger(t.flags) || t.flags < 0 || t.flags > 3) throw new Error('Invalid product literal.')
            }
        }
    }
}
