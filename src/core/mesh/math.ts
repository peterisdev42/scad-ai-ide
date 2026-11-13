import type { Bounds, Vec3 } from './types'
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const length = (a: Vec3) => Math.hypot(...a)
export const center = (b: Bounds): Vec3 => b.min.map((v, i) => v / 2 + b.max[i] / 2) as Vec3
export function bounds(points: Iterable<Vec3>): Bounds | null {
    const min: Vec3 = [Infinity, Infinity, Infinity],
        max: Vec3 = [-Infinity, -Infinity, -Infinity]
    let count = 0
    for (const p of points) {
        count++
        for (let a = 0; a < 3; a++) {
            min[a] = Math.min(min[a], p[a])
            max[a] = Math.max(max[a], p[a])
        }
    }
    return count ? { min, max, dimensions: sub(max, min) } : null
}
export function combine(a: Bounds | null, b: Bounds | null) {
    return !a ? b : !b ? a : bounds([a.min, a.max, b.min, b.max])
}
export const overlaps = (a: Bounds, b: Bounds, epsilon = 0) => a.min.every((v, i) => v <= b.max[i] + epsilon && a.max[i] + epsilon >= b.min[i])
export const containsBounds = (outer: Bounds, inner: Bounds, epsilon = 0) => inner.min.every((v, i) => v >= outer.min[i] - epsilon && inner.max[i] <= outer.max[i] + epsilon)
export class Sum {
    value = 0
    absolute = 0
    count = 0
    private correction = 0
    add(n: number) {
        const y = n - this.correction,
            t = this.value + y
        this.correction = t - this.value - y
        this.value = t
        this.absolute += Math.abs(n)
        this.count++
    }
    get error() {
        return (this.absolute + Math.abs(this.value)) * Number.EPSILON * (20 + this.count)
    }
}
export interface Predicates {
    orient2d(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number
    orient3d(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number): number
}
export const o3 = (p: Predicates, a: Vec3, b: Vec3, c: Vec3, d: Vec3) => p.orient3d(...a, ...b, ...c, ...d)
const sameSigns = (a: number[]) => a.every((v) => v > 0) || a.every((v) => v < 0)
function projection(normal: Vec3) {
    const drop = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)))
    return [0, 1, 2].filter((i) => i !== drop)
}
export function pointTriangle(p: Predicates, point: Vec3, tri: Vec3[], axes: number[]) {
    const signs = [0, 1, 2].map((i) => p.orient2d(tri[i][axes[0]], tri[i][axes[1]], tri[(i + 1) % 3][axes[0]], tri[(i + 1) % 3][axes[1]], point[axes[0]], point[axes[1]]))
    return sameSigns(signs) ? 'inside' : signs.every((s) => s >= 0) || signs.every((s) => s <= 0) ? 'boundary' : 'outside'
}
function segmentDistance(a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
    const u = sub(b, a),
        v = sub(d, c),
        w = sub(a, c),
        uu = dot(u, u),
        vv = dot(v, v),
        uv = dot(u, v),
        uw = dot(u, w),
        vw = dot(v, w),
        denom = uu * vv - uv * uv
    let t = denom > Number.EPSILON * uu * vv ? Math.max(0, Math.min(1, (uv * vw - vv * uw) / denom)) : 0
    let q = vv ? (uv * t + vw) / vv : 0
    if (q < 0) {
        q = 0
        t = uu ? Math.max(0, Math.min(1, -uw / uu)) : 0
    } else if (q > 1) {
        q = 1
        t = uu ? Math.max(0, Math.min(1, (uv - uw) / uu)) : 0
    }
    return length(sub(add(a, mul(u, t)), add(c, mul(v, q))))
}
function triangleDistance(p: Predicates, a: Vec3[], b: Vec3[]) {
    let distance = Infinity
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) distance = Math.min(distance, segmentDistance(a[i], a[(i + 1) % 3], b[j], b[(j + 1) % 3]))
    for (const [points, tri] of [
        [a, b],
        [b, a],
    ]) {
        const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])),
            nn = dot(n, n),
            axes = projection(n)
        if (!nn) return 0
        for (const point of points) {
            const k = dot(n, sub(point, tri[0])) / nn,
                projected = sub(point, mul(n, k))
            if (pointTriangle(p, projected, tri, axes) !== 'outside') distance = Math.min(distance, Math.abs(k) * Math.sqrt(nn))
        }
    }
    return distance
}
const equal = (a: Vec3, b: Vec3) => a.every((n, i) => n === b[i])
export type Intersection = 'none' | 'cross' | 'contact'
/** Shared simplices are allowed only after checking the rest of the triangles. */
export function triangleIntersection(p: Predicates, a: Vec3[], b: Vec3[], shared: Vec3[], epsilon: number): Intersection {
    const na = cross(sub(a[1], a[0]), sub(a[2], a[0])),
        nb = cross(sub(b[1], b[0]), sub(b[2], b[0]))
    const sideB = b.map((v) => o3(p, ...(a as [Vec3, Vec3, Vec3]), v)),
        sideA = a.map((v) => o3(p, ...(b as [Vec3, Vec3, Vec3]), v))
    if (sameSigns(sideB) || sameSigns(sideA)) {
        if (!shared.length && overlaps(bounds(a)!, bounds(b)!, epsilon)) {
            const distance = Math.min(...b.map((v) => Math.abs(dot(na, sub(v, a[0]))) / length(na)), ...a.map((v) => Math.abs(dot(nb, sub(v, b[0]))) / length(nb)))
            if (distance <= epsilon && triangleDistance(p, a, b) <= epsilon * 2) return 'contact'
        }
        return 'none'
    }
    if (sideB.every((v) => v === 0) && sideA.every((v) => v === 0)) {
        const axes = projection(na)
        if (shared.length === 3) return 'cross'
        for (const v of a) if (pointTriangle(p, v, b, axes) === 'inside') return 'cross'
        for (const v of b) if (pointTriangle(p, v, a, axes) === 'inside') return 'cross'
        let contact = false
        const orient = (u: Vec3, v: Vec3, w: Vec3) => p.orient2d(u[axes[0]], u[axes[1]], v[axes[0]], v[axes[1]], w[axes[0]], w[axes[1]])
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++) {
                const u = a[i],
                    v = a[(i + 1) % 3],
                    w = b[j],
                    z = b[(j + 1) % 3],
                    s = [orient(u, v, w), orient(u, v, z), orient(w, z, u), orient(w, z, v)]
                if (Math.sign(s[0]) * Math.sign(s[1]) < 0 && Math.sign(s[2]) * Math.sign(s[3]) < 0) return 'cross'
                if (s.every((v) => v === 0)) {
                    const axis = Math.abs(v[axes[0]] - u[axes[0]]) >= Math.abs(v[axes[1]] - u[axes[1]]) ? axes[0] : axes[1]
                    const lo = Math.max(Math.min(u[axis], v[axis]), Math.min(w[axis], z[axis])),
                        hi = Math.min(Math.max(u[axis], v[axis]), Math.max(w[axis], z[axis]))
                    if (hi > lo) {
                        const commonEdge = shared.length === 2 && [u, v, w, z].every((x) => shared.some((q) => equal(x, q)))
                        if (!commonEdge) contact = true
                    } else if (hi === lo && !shared.some((q) => q[axis] === lo && orient(u, v, q) === 0 && orient(w, z, q) === 0 && pointTriangle(p, q, a, axes) !== 'outside' && pointTriangle(p, q, b, axes) !== 'outside')) contact = true
                } else if (Math.sign(s[0]) * Math.sign(s[1]) <= 0 && Math.sign(s[2]) * Math.sign(s[3]) <= 0) {
                    const permitted = shared.some((q) => [u, v].some((v) => equal(v, q)) && [w, z].some((v) => equal(v, q)))
                    if (!permitted) contact = true
                }
            }
        return contact ? 'contact' : 'none'
    }
    if (shared.length === 2) return 'none' // Distinct planes meet only on this common edge.
    const transversal = (s: number[]) => s.some((v) => v > 0) && s.some((v) => v < 0)
    if (transversal(sideA) && transversal(sideB)) {
        const line = cross(na, nb),
            axis = line.map(Math.abs).indexOf(Math.max(...line.map(Math.abs)))
        const cut = (tri: Vec3[], signs: number[], normal: Vec3, origin: Vec3): number[] | undefined => {
            const values: number[] = []
            for (let i = 0; i < 3; i++) {
                const next = (i + 1) % 3
                if (signs[i] === 0) values.push(tri[i][axis])
                if (Math.sign(signs[i]) * Math.sign(signs[next]) < 0) {
                    const d0 = dot(normal, sub(tri[i], origin)),
                        d1 = dot(normal, sub(tri[next], origin))
                    if (Math.min(Math.abs(d0), Math.abs(d1)) <= epsilon * length(normal)) return undefined
                    const t = d0 / (d0 - d1)
                    if (!Number.isFinite(t) || t < 0 || t > 1) return undefined
                    values.push(tri[i][axis] + t * (tri[next][axis] - tri[i][axis]))
                }
            }
            return values
        }
        const ca = cut(a, sideA, nb, b[0]),
            cb = cut(b, sideB, na, a[0])
        if (!ca || !cb) return 'contact'
        const lo = Math.max(Math.min(...ca), Math.min(...cb)),
            hi = Math.min(Math.max(...ca), Math.max(...cb))
        if (hi - lo > epsilon * 2) return 'cross'
    }
    let contact = false
    for (const [from, target] of [
        [a, b],
        [b, a],
    ]) {
        const n = cross(sub(target[1], target[0]), sub(target[2], target[0])),
            axes = projection(n)
        for (let i = 0; i < 3; i++) {
            const u = from[i],
                v = from[(i + 1) % 3],
                su = o3(p, ...(target as [Vec3, Vec3, Vec3]), u),
                sv = o3(p, ...(target as [Vec3, Vec3, Vec3]), v)
            if (su === 0 && sv === 0) {
                for (const endpoint of [u, v]) if (!shared.some((q) => equal(q, endpoint)) && pointTriangle(p, endpoint, target, axes) !== 'outside') contact = true
                continue
            }
            if (su * sv > 0) continue
            const sides = [0, 1, 2].map((k) => o3(p, u, v, target[k], target[(k + 1) % 3]))
            if (sameSigns(sides) && su !== 0 && sv !== 0) return 'cross'
            if (!(sides.every((s) => s >= 0) || sides.every((s) => s <= 0))) continue
            const endpoint = su === 0 ? u : sv === 0 ? v : undefined
            if (!endpoint || !shared.some((q) => equal(q, endpoint))) contact = true
        }
    }
    return contact ? 'contact' : 'none'
}
export const triangleAxes = (tri: Vec3[]) => projection(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])))
