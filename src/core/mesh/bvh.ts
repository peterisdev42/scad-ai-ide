import { bounds, overlaps } from './math'
import type { Bounds, Vec3 } from './types'
export interface Bvh {
    box: Bounds
    left?: Bvh
    right?: Bvh
    ids?: number[]
}
export function buildBvh(ids: number[], triangle: (id: number) => Vec3[]): Bvh | undefined {
    if (!ids.length) return undefined
    const box = bounds(
        (function* () {
            for (const id of ids) yield* triangle(id)
        })(),
    )!
    if (ids.length <= 8) return { box, ids }
    const axis = box.dimensions.indexOf(Math.max(...box.dimensions))
    ids.sort((a, b) => triangle(a).reduce((n, v) => n + v[axis] / 3, 0) - triangle(b).reduce((n, v) => n + v[axis] / 3, 0) || a - b)
    const half = ids.length >> 1
    return { box, left: buildBvh(ids.slice(0, half), triangle), right: buildBvh(ids.slice(half), triangle) }
}
export function pairs(a: Bvh | undefined, b: Bvh | undefined, epsilon: number, visit: (a: number, b: number) => void): void {
    if (!a || !b || !overlaps(a.box, b.box, epsilon)) return
    if (a.ids && b.ids) {
        for (const x of a.ids) for (const y of b.ids) if (a !== b || x < y) visit(x, y)
    } else if (a === b) {
        pairs(a.left, a.left, epsilon, visit)
        pairs(a.left, a.right, epsilon, visit)
        pairs(a.right, a.right, epsilon, visit)
    } else if (!a.ids) {
        pairs(a.left, b, epsilon, visit)
        pairs(a.right, b, epsilon, visit)
    } else {
        pairs(a, b.left, epsilon, visit)
        pairs(a, b.right, epsilon, visit)
    }
}
export function rayCandidates(tree: Bvh | undefined, origin: Vec3, direction: Vec3, visit: (id: number) => void): void {
    if (!tree) return
    let lo = 0,
        hi = Infinity
    for (let axis = 0; axis < 3; axis++) {
        const t0 = (tree.box.min[axis] - origin[axis]) / direction[axis],
            t1 = (tree.box.max[axis] - origin[axis]) / direction[axis]
        lo = Math.max(lo, Math.min(t0, t1))
        hi = Math.min(hi, Math.max(t0, t1))
    }
    if (hi < lo) return
    if (tree.ids) tree.ids.forEach(visit)
    else {
        rayCandidates(tree.left, origin, direction, visit)
        rayCandidates(tree.right, origin, direction, visit)
    }
}
