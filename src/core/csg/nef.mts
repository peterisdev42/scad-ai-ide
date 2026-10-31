import type { CsgNode } from './parser.js'

interface RecordRow {
    fields: number[][]
    coordinates: number[]
    mark: boolean
}
/** Read the standard bounded SNC interchange graph without repairing its topology. */
export function nefGeometry(source: string, triangulate: (contours: number[][][]) => number[][]): CsgNode {
    if (!/^\s*Selective Nef Complex\s+standard\b/.test(source)) throw new Error('NEF3 requires a standard finite SNC complex.')
    const labels = ['vertices', 'halfedges', 'facets', 'volumes', 'shalfedges', 'shalfloops', 'sfaces']
    const counts = labels.map((label) => Number(new RegExp(`\\b${label}\\s+(\\d+)`).exec(source)?.[1] ?? NaN))
    if (counts.some((n) => !Number.isSafeInteger(n) || n < 0) || counts.reduce((a, b) => a + b, 0) > 2000000) throw new Error('Invalid NEF3 counts or SNC resource budget exceeded.')
    if (counts[5]) throw new Error('NEF3 has unbounded spherical facet cycles.')
    const number = (value: string) => {
        const parts = value.split('/'),
            numerator = Number(parts[0]),
            denominator = parts.length === 2 ? Number(parts[1]) : 1,
            result = numerator / denominator
        if (parts.length > 2 || !Number.isFinite(result)) throw new Error('Invalid or unrepresentable NEF3 coordinate.')
        return result
    }
    const rows = [...source.matchAll(/(\d+)\s*\{([^}]*)\}\s*([01])/g)]
    if (rows.length !== counts.reduce((a, b) => a + b, 0)) throw new Error('Truncated NEF3 complex.')
    let cursor = 0
    const sections = counts.map((count) =>
        Array.from({ length: count }, (_, index): RecordRow => {
            const row = rows[cursor++]
            if (Number(row[1]) !== index) throw new Error('Invalid NEF3 record order.')
            const [indices, coordinates] = row[2].split('|')
            const fields = indices.split(',').map((field) => (field.trim() ? field.trim().split(/\s+/).map(Number) : []))
            if (fields.flat().some((n) => !Number.isSafeInteger(n))) throw new Error('Invalid NEF3 graph address.')
            return { fields, coordinates: coordinates?.trim().split(/\s+/).map(number) ?? [], mark: row[3] === '1' }
        }),
    )
    const [vertices, edges, facets, volumes, spherical] = sections
    if (!volumes.length || volumes[0].mark) throw new Error('An unbounded NEF3 volume cannot be displayed as a finite solid.')
    const points = vertices.map((v) => {
        if (v.coordinates.length !== 4 || !v.coordinates[3]) throw new Error('NEF3 has a nonfinite vertex.')
        return v.coordinates.slice(0, 3).map((x) => x / v.coordinates[3])
    })
    const address = (section: RecordRow[], id: number) => {
        if (!Number.isInteger(id) || id < 0 || !section[id]) throw new Error('Invalid NEF3 graph address.')
        return section[id]
    }
    const faces: number[][] = []
    for (let id = 0; id < facets.length; id++) {
        const facet = facets[id],
            twinId = facet.fields[0]?.[0],
            twin = address(facets, twinId),
            volume = address(volumes, facet.fields[3]?.[0]),
            opposite = address(volumes, twin.fields[3]?.[0])
        if (volume.mark) continue
        if (!opposite.mark) {
            if (!facet.mark || id > twinId) continue
        }
        if (!facet.mark) throw new Error('NEF3 contains an open volumetric boundary.')
        if (facet.fields[2]?.length) throw new Error('NEF3 contains an unbounded facet.')
        const loops = facet.fields[1].map((start) => {
            const ids: number[] = [],
                visited = new Set<number>()
            let edge = start
            do {
                if (visited.has(edge)) throw new Error('NEF3 facet cycle does not close.')
                visited.add(edge)
                const current = address(spherical, edge)
                if (current.fields[7]?.[0] !== id) throw new Error('NEF3 facet incidence is inconsistent.')
                const halfedge = address(edges, current.fields[3]?.[0]),
                    vertex = halfedge.fields[1]?.[0]
                address(vertices, vertex)
                ids.push(vertex)
                edge = current.fields[6]?.[0]
            } while (edge !== start)
            if (ids.length < 3) throw new Error('NEF3 has a degenerate facet cycle.')
            return ids
        })
        if (!loops.length) throw new Error('NEF3 has an empty facet cycle.')
        const normal = facet.coordinates.slice(0, 3),
            axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)))
        if (normal.length !== 3 || !Math.abs(normal[axis])) throw new Error('Invalid NEF3 facet plane.')
        const dims = [(axis + 1) % 3, (axis + 2) % 3]
        if (normal[axis] < 0) dims.reverse()
        const ids = loops.flat(),
            contours = loops.map((loop) => loop.map((i) => [points[i][dims[0]], points[i][dims[1]]]))
        for (const triangle of triangulate(contours)) {
            const mapped = triangle.map((i) => ids[i])
            if (mapped.some((i) => i === undefined)) throw new Error('NEF3 facet triangulation produced an invalid index.')
            faces.push(mapped.reverse()) // CSG polyhedron faces use clockwise winding.
        }
    }
    if (!faces.length && edges.length) throw new Error('NEF3 isolated edges or vertices have no triangulatable surface.')
    return { name: 'polyhedron', params: { points, faces }, children: [], modifiers: '' }
}
