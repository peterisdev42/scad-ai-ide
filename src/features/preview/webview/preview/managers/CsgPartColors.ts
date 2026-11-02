import { Color, Float32BufferAttribute, Mesh, SRGBColorSpace, Vector3 } from 'three'
import type { CsgPartHint } from '../../../../../core/preview/csgParts'
import { partColor } from './PartColors'

export function hintColor(hint: CsgPartHint): Color {
    if (hint.color?.length === 3 && hint.color.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return new Color().setRGB(hint.color[0], hint.color[1], hint.color[2], SRGBColorSpace)
    let hash = 0
    for (const character of hint.id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0
    return partColor(hash)
}

/** AABB hints are deliberately approximate. Prefer small enclosing parts over
 * large enclosing assembly bodies; never infer ownership from touching meshes. */
export function createHintMatcher(hints: readonly CsgPartHint[]) {
    const boxes = hints
        .map((hint) => {
            const size = hint.max.map((n, d) => n - hint.min[d])
            const epsilon = Math.max(1e-4, ...size.map((n) => n * 1e-6))
            return { hint, epsilon, volume: size.reduce((v, n) => v * Math.max(n, epsilon), 1) }
        })
        .sort((a, b) => a.volume - b.volume)
    return (point: readonly number[]): CsgPartHint | undefined => {
        for (const { hint, epsilon } of boxes) if (point[0] >= hint.min[0] - epsilon && point[0] <= hint.max[0] + epsilon && point[1] >= hint.min[1] - epsilon && point[1] <= hint.max[1] + epsilon && point[2] >= hint.min[2] - epsilon && point[2] <= hint.max[2] + epsilon) return hint
        return undefined
    }
}
export function hintAt(hints: readonly CsgPartHint[], point: readonly number[]): CsgPartHint | undefined {
    return createHintMatcher(hints)(point)
}

/** Runs only on demand, once per geometry/hint set. Budget limits keep this
 * experimental aid from blocking the viewer on very large or complex meshes. */
export function csgVertexColors(mesh: Mesh, hints: readonly CsgPartHint[], fallback: Float32BufferAttribute, deadline = performance.now() + 80): Float32BufferAttribute | undefined {
    const position = mesh.geometry.getAttribute('position')
    if (!position || !hints.length || hints.length > 256 || position.count > 1000000) return undefined
    const colors = new Float32Array(fallback.array),
        index = mesh.geometry.getIndex()
    const match = createHintMatcher(hints)
    const palette = new Map(hints.map((hint) => [hint, hintColor(hint)]))
    // Loader transforms (e.g. 3MF object placement and units) are relative to
    // the model root. Viewport camera and scene transforms must not affect IDs.
    mesh.updateWorldMatrix(true, false)
    const point = new Vector3(),
        vertex = new Vector3()
    const count = index?.count ?? position.count
    let matches = 0
    for (let i = 0; i + 2 < count; i += 3) {
        if (i % 768 === 0 && performance.now() > deadline) return undefined
        point.set(0, 0, 0)
        for (let k = 0; k < 3; k++) point.add(vertex.fromBufferAttribute(position, index ? index.getX(i + k) : i + k))
        point.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld)
        const hint = match([point.x, point.y, point.z])
        if (!hint) continue
        const color = palette.get(hint)!
        for (let k = 0; k < 3; k++) color.toArray(colors, (index ? index.getX(i + k) : i + k) * 3)
        matches++
    }
    return matches ? new Float32BufferAttribute(colors, 3) : undefined
}
