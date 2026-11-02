// Adapted from OpenSCAD fe482c3: geometry/linear_extrude.cc and core/CurveDiscretizer.cc.
// SPDX-License-Identifier: GPL-2.0-or-later
import type { CrossSection, Manifold, ManifoldToplevel, Vec2 } from 'manifold-3d'
import type { CsgValue } from './parser.js'

/** Preserve OpenSCAD's XY outlines, oblique translation, and side diagonal rules. */
export function linearExtrude(section: CrossSection, p: Record<string, CsgValue>, module: ManifoldToplevel): Manifold {
    const n = (key: string, fallback: number) => (typeof p[key] === 'number' ? (p[key] as number) : fallback)
    const h = n('height', 1),
        twist = n('twist', 0)
    const scale = typeof p.scale === 'number' ? [p.scale, p.scale] : Array.isArray(p.scale) ? (p.scale as number[]) : [1, 1]
    const direction = Array.isArray(p.v) ? (p.v as number[]) : [0, 0, 1],
        norm = Math.hypot(...direction)
    if (!norm || direction[2] <= 0 || h <= 0) return module.Manifold.union([])
    const height = direction.map((x) => (x / norm) * h)
    const transform = (v: number[], t: number): Vec2 => {
        const angle = ((-twist * Math.PI) / 180) * t,
            c = Math.cos(angle),
            s = Math.sin(angle)
        return [(v[0] * c - v[1] * s) * (1 + (scale[0] - 1) * t), (v[0] * s + v[1] * c) * (1 + (scale[1] - 1) * t)]
    }
    const rings = section.toPolygons()
    const radius = Math.max(0, ...rings.flat().map((v) => Math.hypot(...v)))
    const radians = (Math.abs(twist) * Math.PI) / 180,
        fn = n('$fn', 0),
        fs = Math.max(n('$fs', 2), 0.01),
        fa = Math.max(n('$fa', 12), 0.01),
        fe = n('$fe', 0)
    let slices = 1
    if (twist) {
        const minimum = Math.max(1, Math.ceil(Math.abs(twist) / 120))
        let length = Math.hypot(radius * radians, height[2])
        if (scale[0] === scale[1] && scale[0] !== 1) {
            const end = scale[0] > 1 ? (radians * scale[0]) / (scale[0] - 1) : radians / (1 - scale[0]),
                start = end - radians,
                a = radius / end
            const arc = (t: number) => 0.5 * a * (t * Math.sqrt(1 + t * t) + Math.asinh(t))
            length = Math.hypot(arc(end) - arc(start), height[2])
        }
        slices = fn > 0 ? Math.max(minimum, Math.ceil((Math.abs(twist) * fn) / 360)) : fe > 0 && fe < radius ? Math.max(minimum, Math.ceil(radians / (2 * (Math.PI - Math.acos(fe / radius - 1))))) : Math.max(minimum, Math.min(Math.ceil(Math.abs(twist) / fa), Math.ceil(length / fs)))
    }
    if (scale[0] !== scale[1]) {
        const delta = Math.max(0, ...rings.flat().map((v) => (v[0] * (scale[0] - 1)) ** 2 + (v[1] * (scale[1] - 1)) ** 2))
        slices = Math.max(slices, fn > 0 ? Math.floor(fn) : Math.ceil(Math.hypot(Math.sqrt(delta), height[2]) / fs))
    }
    slices = Math.max(1, Math.floor(n('slices', slices)))
    if (slices > 65536) throw new Error('CSG extrusion slice resource budget exceeded.')
    const segmented = rings.map((ring) => {
        if (p.segments === 0 || (!twist && scale[0] === scale[1] && !n('segments', 0))) return ring
        const lengths = ring.map((a, i) => {
            const b = ring[(i + 1) % ring.length]
            if (scale[0] === scale[1]) return Math.hypot(a[0] - b[0], a[1] - b[1]) * Math.max(scale[0], 1)
            let maximum = 0
            for (let j = 0; j <= slices; j++) {
                const x = transform(a, j / slices),
                    y = transform(b, j / slices)
                maximum = Math.max(maximum, Math.hypot(x[0] - y[0], x[1] - y[1]))
            }
            return maximum
        })
        const counts = ring.map(() => 1)
        let target = n('segments', fn > 0 ? Math.max(3, Math.floor(fn)) : 0)
        if (!target) {
            const fsCounts = lengths.map((length) => Math.max(1, Math.ceil(length / fs)))
            if (fsCounts.reduce((a, b) => a + b, 0) < Math.ceil(360 / fa)) {
                fsCounts.forEach((c, i) => {
                    counts[i] = c
                })
                target = ring.length
            } else target = Math.ceil(360 / fa)
        }
        let total = counts.reduce((a, b) => a + b, 0)
        while (total < target) {
            const metrics = lengths.map((length, i) => length / (counts[i] + 0.5)),
                best = Math.max(...metrics)
            const group = metrics.flatMap((metric, i) => (metric / best >= 0.999 ? [i] : []))
            if (!group.length || total + group.length > target) break
            for (const i of group) {
                counts[i]++
                total++
            }
        }
        return ring.flatMap((a, i) =>
            Array.from({ length: counts[i] }, (_, j) => {
                const t = j / counts[i],
                    b = ring[(i + 1) % ring.length]
                return [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t] as Vec2
            }),
        )
    })
    const stride = segmented.reduce((s, r) => s + r.length, 0),
        points: number[] = [],
        faces: number[] = []
    if (stride * (slices + 1) > 2000000) throw new Error('CSG extrusion vertex resource budget exceeded.')
    for (let slice = 0; slice <= slices; slice++)
        for (const ring of segmented)
            for (const v of ring) {
                const t = slice / slices,
                    q = transform(v, t),
                    offset = t - (p.center ? 0.5 : 0)
                points.push(q[0] + height[0] * offset, q[1] + height[1] * offset, height[2] * offset)
            }
    for (let slice = 1; slice <= slices; slice++) {
        let offset = 0
        for (const ring of segmented) {
            const positive =
                ring.reduce((sum, a, i) => {
                    const b = ring[(i + 1) % ring.length]
                    return sum + a[0] * b[1] - a[1] * b[0]
                }, 0) > 0
            const flip = !positive !== twist <= 0
            for (let i = 1; i <= ring.length; i++) {
                const prev = i - 1,
                    current = i % ring.length
                const a = transform(ring[prev], (slice - 1) / slices),
                    b = transform(ring[current], (slice - 1) / slices),
                    c = transform(ring[prev], slice / slices),
                    d = transform(ring[current], slice / slices)
                const l1 = Math.hypot(a[0] - d[0], a[1] - d[1]),
                    l2 = Math.hypot(b[0] - c[0], b[1] - c[1])
                const sign = 2 * Math.abs(l1 - l2) * 1e5 > l1 + l2 ? (l1 < l2 ? -1 : 1) : 0
                const splitfirst = sign === -1 || (sign === 0 && !flip)
                const anyZero = slice === slices && (scale[0] === 0 || scale[1] === 0)
                const pb = (slice - 1) * stride + offset + prev,
                    cb = (slice - 1) * stride + offset + current,
                    pt = slice * stride + offset + prev,
                    ct = slice * stride + offset + current
                if (splitfirst !== anyZero) faces.push(cb, ct, pb, pt, pb, ct)
                else faces.push(cb, pt, pb, cb, ct, pt)
            }
            offset += ring.length
        }
    }
    for (const tri of module.triangulate(segmented)) faces.push(...[...tri].reverse())
    if (scale[0] !== 0 && scale[1] !== 0) for (const tri of module.triangulate(segmented.map((ring) => ring.map((v) => transform(v, 1))))) faces.push(...tri.map((i) => i + slices * stride))
    const mesh = new module.Mesh({ numProp: 3, vertProperties: new Float32Array(points), triVerts: new Uint32Array(faces) })
    mesh.merge()
    return new module.Manifold(mesh)
}
