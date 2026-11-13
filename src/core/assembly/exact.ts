/** Exact arithmetic on the dyadic values actually stored in Float64 meshes.
 * No measurement error estimate is promoted to a certified bound here. */
import type { Interval, Vec3 } from './types'
export type I3 = [bigint, bigint, bigint]
export interface Rational {
    n: bigint
    d: bigint
}
export interface Point {
    p: I3
    d: bigint
}
export const sub = (a: I3, b: I3): I3 => a.map((x, i) => x - b[i]) as I3
export const add = (a: I3, b: I3): I3 => a.map((x, i) => x + b[i]) as I3
export const mul = (a: I3, s: bigint): I3 => a.map((x) => x * s) as I3
export const dot = (a: I3, b: I3) => a.reduce((s, x, i) => s + x * b[i], 0n)
export const cross = (a: I3, b: I3): I3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const cmp = (a: Rational, b: Rational) => a.n * b.d - b.n * a.d
export const rat = (n: bigint, d = 1n): Rational => (d < 0n ? { n: -n, d: -d } : { n, d })
const bits = (n: bigint) => (n < 0n ? -n : n).toString(2).length
const buffer = new ArrayBuffer(8),
    view = new DataView(buffer)
export function dyadic(value: number): { n: bigint; e: number } {
    if (!Number.isFinite(value)) throw new Error('ASSEMBLY_NONFINITE')
    if (value === 0) return { n: 0n, e: 0 }
    view.setFloat64(0, value)
    const word = view.getBigUint64(0),
        exp = Number((word >> 52n) & 2047n),
        sign = word >> 63n ? -1n : 1n
    return { n: sign * ((word & ((1n << 52n) - 1n)) + (exp ? 1n << 52n : 0n)), e: exp ? exp - 1075 : -1074 }
}
export function integer(value: number, exponent: number): bigint {
    const v = dyadic(value)
    return v.n === 0n ? 0n : v.n << BigInt(v.e - exponent)
}
export function next(value: number, up: boolean): number {
    if (Number.isNaN(value) || value === (up ? Infinity : -Infinity)) return value
    if (value === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE
    view.setFloat64(0, value)
    view.setBigUint64(0, view.getBigUint64(0) + (value > 0 === up ? 1n : -1n))
    return view.getFloat64(0)
}
function approximate(r: Rational, exponent: number): number {
    if (!r.n) return 0
    const sign = r.n < 0n ? -1 : 1,
        n = r.n < 0n ? -r.n : r.n,
        a = Math.max(0, bits(n) - 53),
        b = Math.max(0, bits(r.d) - 53)
    const power = a - b + exponent,
        mantissa = Number(n >> BigInt(a)) / Number(r.d >> BigInt(b))
    // Splitting powers avoids premature overflow/underflow before multiplication.
    const k = Math.max(-1022, Math.min(1023, power))
    return sign * (mantissa * 2 ** (power - k)) * 2 ** k
}
function compareFloat(value: number, r: Rational, exponent: number, squared: boolean): bigint {
    const v = dyadic(value),
        n = squared ? v.n * v.n : v.n,
        e = (squared ? v.e * 2 : v.e) - exponent
    return e >= 0 ? (n << BigInt(e)) * r.d - r.n : n * r.d - (r.n << BigInt(-e))
}
/** Outward rounding is checked by exact integer comparisons, including sqrt. */
export function bound(r: Rational, exponent: number, squared = false): Interval | null {
    let x = squared ? Math.sqrt(approximate(r, exponent)) : approximate(r, exponent)
    if (!Number.isFinite(x) || r.d <= 0n || (squared && r.n < 0n)) return null
    let lo = x,
        hi = x
    for (let i = 0; i < 128; i++) {
        const l = compareFloat(lo, r, exponent, squared),
            h = compareFloat(hi, r, exponent, squared)
        if (l <= 0n && h >= 0n) return { lower: lo, upper: hi }
        if (l > 0n) lo = next(lo, false)
        if (h < 0n) hi = next(hi, true)
    }
    return null
}
export function coordinates(p: Point, e: number): { point: Vec3; bounds: Interval[] } | null {
    const bounds = p.p.map((n) => bound(rat(n, p.d), e))
    if (bounds.some((x) => !x)) return null
    return { point: bounds.map((x) => x!.lower + (x!.upper - x!.lower) / 2) as Vec3, bounds: bounds as Interval[] }
}
export interface Closest {
    squared: Rational
    a: Point
    b: Point
}
const p = (a: I3): Point => ({ p: a, d: 1n })
function choose(a: Closest, b: Closest): Closest {
    return cmp(a.squared, b.squared) <= 0n ? a : b
}
export function pointSegment(x: I3, a: I3, b: I3): Closest {
    const u = sub(b, a),
        w = sub(x, a),
        q = dot(u, u),
        s = dot(w, u)
    if (s <= 0n || q === 0n) return { squared: rat(dot(w, w)), a: p(x), b: p(a) }
    if (s >= q) {
        const v = sub(x, b)
        return { squared: rat(dot(v, v)), a: p(x), b: p(b) }
    }
    return { squared: rat(dot(w, w) * q - s * s, q), a: p(x), b: { p: add(mul(a, q), mul(u, s)), d: q } }
}
function bary(x: Point, t: I3[]): { inside: boolean; strict: boolean } {
    const u = sub(t[1], t[0]),
        v = sub(t[2], t[0]),
        w = sub(x.p, mul(t[0], x.d)),
        uu = dot(u, u),
        uv = dot(u, v),
        vv = dot(v, v),
        D = (uu * vv - uv * uv) * x.d
    if (D <= 0n) return { inside: false, strict: false }
    const a = dot(w, u) * vv - dot(w, v) * uv,
        b = dot(w, v) * uu - dot(w, u) * uv
    return { inside: a >= 0n && b >= 0n && a + b <= D, strict: a > 0n && b > 0n && a + b < D }
}
export function pointTriangle(x: I3, t: I3[]): Closest {
    const n = cross(sub(t[1], t[0]), sub(t[2], t[0])),
        q = dot(n, n),
        s = dot(sub(x, t[0]), n)
    if (q) {
        const projection = { p: sub(mul(x, q), mul(n, s)), d: q }
        if (bary(projection, t).inside) return { squared: rat(s * s, q), a: p(x), b: projection }
    }
    return choose(choose(pointSegment(x, t[0], t[1]), pointSegment(x, t[1], t[2])), pointSegment(x, t[2], t[0]))
}
function edgeEdge(a: I3, b: I3, c: I3, d: I3): Closest {
    const u = sub(b, a),
        v = sub(d, c),
        w = sub(a, c),
        A = dot(u, u),
        B = dot(u, v),
        C = dot(v, v),
        D = dot(u, w),
        E = dot(v, w),
        q = A * C - B * B,
        s = B * E - C * D,
        t = A * E - B * D
    let best = choose(pointSegment(a, c, d), pointSegment(b, c, d))
    for (const x of [c, d]) {
        const r = pointSegment(x, a, b)
        best = choose(best, { squared: r.squared, a: r.b, b: r.a })
    }
    if (q > 0n && s >= 0n && s <= q && t >= 0n && t <= q)
        best = choose(best, { squared: rat(dot(w, w) * q + s * D - t * E, q), a: { p: add(mul(a, q), mul(u, s)), d: q }, b: { p: add(mul(c, q), mul(v, t)), d: q } })
    return best
}
function segmentTriangle(a: I3, b: I3, t: I3[]): Point | null {
    const n = cross(sub(t[1], t[0]), sub(t[2], t[0])),
        s = dot(sub(a, t[0]), n),
        u = dot(sub(b, t[0]), n)
    if (s === u || (s > 0n && u > 0n) || (s < 0n && u < 0n)) return null
    const r = rat(s, s - u)
    if (r.n < 0n || r.n > r.d) return null
    const x = { p: add(mul(a, r.d), mul(sub(b, a), r.n)), d: r.d }
    return bary(x, t).inside ? x : null
}
export function triangles(a: I3[], b: I3[]): Closest {
    let best = pointTriangle(a[0], b)
    for (let i = 0; i < 3; i++) {
        best = choose(best, pointTriangle(a[i], b))
        const other = pointTriangle(b[i], a)
        best = choose(best, { squared: other.squared, a: other.b, b: other.a })
        for (let j = 0; j < 3; j++) best = choose(best, edgeEdge(a[i], a[(i + 1) % 3], b[j], b[(j + 1) % 3]))
        for (const x of [segmentTriangle(a[i], a[(i + 1) % 3], b), segmentTriangle(b[i], b[(i + 1) % 3], a)]) if (x) return { squared: rat(0n), a: x, b: x }
    }
    return best
}
/** Winding rays handle cavities; a 3MF document is a union of instance material. */
export function inside(point: Point, instances: I3[][][], tick: () => void): boolean | undefined {
    let uncertain = false
    for (const instance of instances) {
        let resolved = false
        for (const dir of [
            [1000n, 317n, 123n],
            [127n, 1000n, 619n],
            [367n, 149n, 1000n],
        ] as I3[]) {
            let winding = 0,
                ambiguous = false
            for (const t of instance) {
                tick()
                const n = cross(sub(t[1], t[0]), sub(t[2], t[0])),
                    s = dot(sub(mul(t[0], point.d), point.p), n),
                    den = dot(n, dir)
                if (s === 0n && bary(point, t).inside) {
                    ambiguous = true
                    break
                }
                if (!den) continue
                const time = rat(s, den)
                if (time.n <= 0n) continue
                const hit = { p: add(mul(point.p, time.d), mul(dir, time.n)), d: point.d * time.d },
                    test = bary(hit, t)
                if (test.inside) {
                    if (!test.strict) {
                        ambiguous = true
                        break
                    }
                    winding += den > 0n ? 1 : -1
                }
            }
            if (!ambiguous) {
                resolved = true
                if (winding > 0) return true
                break
            }
        }
        if (!resolved) uncertain = true
    }
    return uncertain ? undefined : false
}
export function separatingPlane(a: I3[][], b: I3[][], tick: () => void): boolean {
    const av = a.flat(),
        bv = b.flat()
    // Axis support planes prove face, edge and point contact without epsilon tests.
    for (let k = 0; k < 3; k++) {
        let amin = av[0][k],
            amax = amin,
            bmin = bv[0][k],
            bmax = bmin
        for (const v of av) {
            tick()
            amin = amin < v[k] ? amin : v[k]
            amax = amax > v[k] ? amax : v[k]
        }
        for (const v of bv) {
            tick()
            bmin = bmin < v[k] ? bmin : v[k]
            bmax = bmax > v[k] ? bmax : v[k]
        }
        if (amax <= bmin || bmax <= amin) return true
    }
    for (const face of [...a.slice(0, 32), ...b.slice(0, 32)]) {
        const n = cross(sub(face[1], face[0]), sub(face[2], face[0]))
        if (!dot(n, n)) continue
        let aSign = 0,
            bSign = 0
        for (const [vertices, side] of [
            [av, 0],
            [bv, 1],
        ] as const) {
            let sign = 0
            for (const v of vertices) {
                tick()
                const s = dot(sub(v, face[0]), n),
                    next = s > 0n ? 1 : s < 0n ? -1 : 0
                if (sign && next && sign !== next) {
                    sign = 2
                    break
                }
                if (next) sign = next
            }
            if (side === 0) aSign = sign
            else bSign = sign
        }
        if (aSign !== 2 && bSign !== 2 && aSign * bSign === -1) return true
    }
    return false
}
