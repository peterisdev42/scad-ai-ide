// Adapted from OpenSCAD fe482c3 primitives.cc and geometry/rotate_extrude.cc.
// SPDX-License-Identifier: GPL-2.0-or-later
import { Vector3 } from 'three'
import type { CrossSection, ManifoldToplevel } from 'manifold-3d'
import type { CsgValue } from './parser.js'
import { circularSegments } from './discretize.js'

const trig = (angle: number) => {
    const v = ((angle % 360) + 360) % 360
    if (v === 0) return [1, 0]
    if (v === 90) return [0, 1]
    if (v === 180) return [-1, 0]
    if (v === 270) return [0, -1]
    return [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)]
}

export function octaSphere(radius: number, segments: number, module: ManifoldToplevel) {
    const n = Math.max(1, Math.floor((segments + 3) / 4)),
        fragments = 4 * n
    if (4 * n * n + 2 > 2000000) throw new Error('CSG sphere vertex resource budget exceeded.')
    const cs = Array.from({ length: n + 1 }, (_, i) => trig((360 * i) / fragments))
    const octant: Vector3[][] = []
    const intersect = (a: Vector3, b: Vector3, c: Vector3, d: Vector3) => new Vector3().crossVectors(a, b).cross(new Vector3().crossVectors(c, d)).normalize()
    for (let t = 2; t < n; t++) {
        octant[t] = []
        const k = n - t
        for (let s = 1; s < t; s++) {
            const i = t - s,
                j = s,
                xzK = new Vector3(cs[k][0], 0, cs[k][1]),
                yzK = new Vector3(0, cs[k][0], cs[k][1]),
                xyJ = new Vector3(cs[j][0], cs[j][1], 0),
                yzJ = new Vector3(0, cs[n - j][0], cs[n - j][1]),
                xyI = new Vector3(cs[n - i][0], cs[n - i][1], 0),
                xzI = new Vector3(cs[n - i][0], 0, cs[n - i][1])
            octant[t][s] = intersect(xzK, yzK, xyJ, yzJ)
                .add(intersect(xzK, yzK, xyI, xzI))
                .add(intersect(xyJ, yzJ, xyI, xzI))
                .normalize()
        }
    }
    const points: number[] = [],
        faces: number[] = [],
        starts: number[] = []
    for (let ring = 0; ring <= 2 * n; ring++) {
        starts.push(points.length / 3)
        const top = ring <= n,
            t = top ? ring : 2 * n - ring,
            k = n - t
        if (!t) {
            points.push(0, 0, top ? radius : -radius)
            continue
        }
        for (let q = 0; q < 4; q++)
            for (let s = 0; s < t; s++) {
                if (t === n) {
                    const [c, z] = trig((360 * (q * n + s)) / fragments)
                    points.push(radius * c, radius * z, 0)
                } else if (s === 0) {
                    const index = top ? (q < 2 ? k : 2 * n - k) : q < 2 ? 4 * n - k : 2 * n + k,
                        [c, z] = trig((360 * index) / fragments)
                    points.push(q % 2 ? 0 : radius * c, q % 2 ? radius * c : 0, radius * z)
                } else {
                    const p = octant[t][s],
                        z = top ? p.z : -p.z
                    const xy = q === 0 ? [p.x, p.y] : q === 1 ? [-p.y, p.x] : q === 2 ? [-p.x, -p.y] : [p.y, -p.x]
                    points.push(radius * xy[0], radius * xy[1], radius * z)
                }
            }
    }
    const stitch = (inner: number, outer: number, t: number, mirror: boolean) => {
        const ii = (i: number) => (t ? starts[inner] + (i % (4 * t)) : starts[inner]),
            oi = (i: number) => starts[outer] + (i % (4 * (t + 1)))
        const add = (a: number, b: number, c: number) => {
            faces.push(a, mirror ? c : b, mirror ? b : c)
        }
        for (let q = 0; q < 4; q++)
            for (let s = 0; s <= t; s++) {
                const i = q * t + s,
                    o = q * (t + 1) + s
                add(ii(i), oi(o), oi(o + 1))
                if (s < t) add(ii(i), oi(o + 1), ii(i + 1))
            }
    }
    for (let t = 0; t < n; t++) {
        stitch(t, t + 1, t, false)
        stitch(2 * n - t, 2 * n - t - 1, t, true)
    }
    return new module.Manifold(new module.Mesh({ numProp: 3, vertProperties: new Float32Array(points), triVerts: new Uint32Array(faces) }))
}

export function rotateExtrude(section: CrossSection, p: Record<string, CsgValue>, module: ManifoldToplevel) {
    let angle = typeof p.angle === 'number' ? p.angle : 360
    if (angle <= -360 || angle > 360) angle = 360
    if (!angle) return module.Manifold.union([])
    const start = typeof p.start === 'number' ? p.start : p.angle === undefined ? 180 : 0
    const rings = section.toPolygons(),
        min = Math.min(0, ...rings.flat().map((v) => v[0])),
        max = Math.max(0, ...rings.flat().map((v) => v[0]))
    if (min < 0 && max > 0) throw new Error('Rotational extrusion crosses the Y axis.')
    const count = circularSegments(p, max - min, angle),
        closed = angle === 360,
        numRings = count + (closed ? 0 : 1),
        stride = rings.reduce((s, r) => s + r.length, 0),
        points: number[] = [],
        faces: number[] = []
    if (stride * numRings > 2000000) throw new Error('CSG revolve vertex resource budget exceeded.')
    for (let j = 0; j < numRings; j++) {
        const [c, s] = trig(start + (j * angle) / count)
        for (const ring of rings) for (const v of ring) points.push(v[0] * c, v[0] * s, v[1])
    }
    const flip = (min >= 0 && angle > 0) || (min < 0 && angle < 0),
        total = stride * numRings
    for (let slice = 1; slice <= count; slice++) {
        let offset = 0
        for (const ring of rings) {
            for (let i = 1; i <= ring.length; i++) {
                const current = offset + (i % ring.length),
                    prev = offset + i - 1,
                    pb = ((slice - 1) * stride + prev) % total,
                    cb = ((slice - 1) * stride + current) % total,
                    pt = (slice * stride + prev) % total,
                    ct = (slice * stride + current) % total
                if (flip) faces.push(pb, ct, cb, ct, pb, pt)
                else faces.push(cb, ct, pb, pt, pb, ct)
            }
            offset += ring.length
        }
    }
    if (!closed)
        for (const tri of module.triangulate(rings)) {
            const a = tri,
                b = tri.map((i) => i + count * stride)
            faces.push(...(flip ? a : [...a].reverse()), ...(flip ? [...b].reverse() : b))
        }
    const mesh = new module.Mesh({ numProp: 3, vertProperties: new Float32Array(points), triVerts: new Uint32Array(faces) })
    mesh.merge()
    return new module.Manifold(mesh)
}
