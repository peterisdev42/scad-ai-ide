import type { ManifoldToplevel, Vec2 } from 'manifold-3d'
import type { CsgNode } from './parser.js'
import type { CsgMesh } from './types.js'

/** Triangulate input surfaces without repairing, welding, or requiring a solid. */
export function polyhedronMesh(node: CsgNode, module: ManifoldToplevel): { mesh: CsgMesh; closed: boolean } {
    const points = node.params.points as number[][],
        faces = (node.params.faces ?? node.params.triangles) as number[][]
    if (!Array.isArray(points) || !points.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) || !Array.isArray(faces)) throw new Error('Invalid polyhedron data.')
    const triangles: number[] = [],
        edges = new Map<string, { count: number; orientation: number }>()
    for (const face of faces) {
        if (!Array.isArray(face) || face.length < 3 || !face.every((i) => Number.isInteger(i) && i >= 0 && i < points.length)) throw new Error('Invalid polyhedron face index.')
        for (let i = 0; i < face.length; i++) {
            const a = face[i],
                b = face[(i + 1) % face.length],
                key = `${Math.min(a, b)}:${Math.max(a, b)}`
            const edge = edges.get(key) ?? { count: 0, orientation: 0 }
            edge.count++
            edge.orientation += a < b ? 1 : -1
            edges.set(key, edge)
        }
        const ids = [...face].reverse(),
            contour = ids.map((i) => points[i])
        if (ids.length === 3) {
            triangles.push(...ids)
            continue
        }
        const normal = [0, 0, 0]
        contour.forEach((a, i) => {
            const b = contour[(i + 1) % contour.length]
            normal[0] += (a[1] - b[1]) * (a[2] + b[2])
            normal[1] += (a[2] - b[2]) * (a[0] + b[0])
            normal[2] += (a[0] - b[0]) * (a[1] + b[1])
        })
        const axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)))
        if (Math.abs(normal[axis]) < 1e-20) throw new Error('Degenerate polyhedron face.')
        const projected = contour.map((v) => [v[(axis + 1) % 3], v[(axis + 2) % 3]] as Vec2)
        if (normal[axis] < 0) {
            projected.reverse()
            ids.reverse()
        }
        for (const tri of module.triangulate([projected])) {
            const indices = tri.map((i) => ids[i])
            triangles.push(...(normal[axis] < 0 ? indices.reverse() : indices))
        }
    }
    const colors = node.params.face_colors as number[][] | undefined
    const expanded = points.map((p) => [...p, 1, 1, 1, 1, 1])
    if (colors) {
        if (colors.length !== faces.length || colors.some((c) => !Array.isArray(c) || c.length !== 4 || !c.every(Number.isFinite))) throw new Error('Invalid imported face colors.')
        let cursor = 0
        for (let f = 0; f < faces.length; f++)
            for (let t = 0; t < (faces[f].length - 2) * 3; t++) {
                const id = triangles[cursor]
                triangles[cursor++] = expanded.length
                expanded.push([...points[id], ...colors[f], 0])
            }
    }
    const properties = new Float32Array(expanded.flat())
    const indices = new Uint32Array(triangles)
    return { mesh: { stride: 8, properties: Buffer.from(properties.buffer).toString('base64'), indices: Buffer.from(indices.buffer).toString('base64') }, closed: [...edges.values()].every((e) => e.count === 2 && e.orientation === 0) }
}
