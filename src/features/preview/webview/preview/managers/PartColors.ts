import { BufferGeometry, Color } from 'three'

// Repeatable, well-separated hues; colors do not change when the camera moves.
export function partColor(index: number): Color {
    return new Color().setHSL((0.06 + index * 0.61803398875) % 1, 0.65, 0.58)
}

/** STL has no object IDs: weld exact positions and find connected triangle shells. */
export function geometryParts(geometry: BufferGeometry): { ids: Uint32Array; count: number } {
    const position = geometry.getAttribute('position')
    if (!position) return { ids: new Uint32Array(), count: 0 }
    const parent = Uint32Array.from({ length: position.count }, (_, i) => i)
    const find = (i: number): number => {
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]]
            i = parent[i]
        }
        return i
    }
    const join = (a: number, b: number) => {
        parent[find(b)] = find(a)
    }
    const vertices = new Map<string, number>()
    for (let i = 0; i < position.count; i++) {
        const key = `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`
        const previous = vertices.get(key)
        if (previous !== undefined) join(previous, i)
        else vertices.set(key, i)
    }
    const index = geometry.getIndex()
    for (let i = 0; i + 2 < (index?.count ?? position.count); i += 3) {
        const a = index ? index.getX(i) : i
        join(a, index ? index.getX(i + 1) : i + 1)
        join(a, index ? index.getX(i + 2) : i + 2)
    }
    const components = new Map<number, number>()
    const ids = parent.map((_, i) => {
        const root = find(i)
        if (!components.has(root)) components.set(root, components.size)
        return components.get(root)!
    })
    return { ids, count: components.size }
}
