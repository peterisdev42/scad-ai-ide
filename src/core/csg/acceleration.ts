import type { CsgBvhNode, CsgInstruction, CsgScene, CsgBlas } from './types'

export function buildBvh(input: Float32Array): { triangles: Float32Array; nodes: CsgBvhNode[] } {
    const ids = Array.from({ length: input.length / 12 }, (_, i) => i)
    const nodes: CsgBvhNode[] = []
    const ordered: number[] = []
    const build = (items: number[]) => {
        const index = nodes.length
        const min = [Infinity, Infinity, Infinity],
            max = [-Infinity, -Infinity, -Infinity]
        for (const id of items)
            for (let v = 0; v < 3; v++)
                for (let d = 0; d < 3; d++) {
                    const x = input[id * 12 + v * 4 + d]
                    min[d] = Math.min(min[d], x)
                    max[d] = Math.max(max[d], x)
                }
        const node: CsgBvhNode = { min, max, first: -1, count: 0, escape: 0 }
        nodes.push(node)
        if (items.length <= 8) {
            node.first = ordered.length
            node.count = items.length
            ordered.push(...items)
        } else {
            const sizes = max.map((x, d) => x - min[d])
            const axis = sizes.indexOf(Math.max(...sizes))
            const center = (i: number) => input[i * 12 + axis] + input[i * 12 + 4 + axis] + input[i * 12 + 8 + axis]
            items.sort((a, b) => center(a) - center(b))
            const split = Math.floor(items.length / 2)
            build(items.slice(0, split))
            build(items.slice(split))
        }
        node.escape = nodes.length
        return index
    }
    if (ids.length) build(ids)
    const triangles = new Float32Array(input.length)
    ordered.forEach((id, i) => triangles.set(input.subarray(id * 12, id * 12 + 12), i * 12))
    return { triangles, nodes }
}

/** TLAS leaves contain a single operand ID, independent of mesh storage order. */
export function buildBoundsBvh(bounds: { min: number[]; max: number[] }[]): CsgBvhNode[] {
    const nodes: CsgBvhNode[] = []
    const visit = (ids: number[]) => {
        const min = [Infinity, Infinity, Infinity],
            max = [-Infinity, -Infinity, -Infinity]
        for (const id of ids)
            for (let d = 0; d < 3; d++) {
                min[d] = Math.min(min[d], bounds[id].min[d])
                max[d] = Math.max(max[d], bounds[id].max[d])
            }
        const node: CsgBvhNode = { min, max, first: -1, count: 0, escape: 0 }
        nodes.push(node)
        if (ids.length === 1) {
            node.first = ids[0]
            node.count = 1
        } else {
            const size = max.map((v, d) => v - min[d]),
                axis = size.indexOf(Math.max(...size))
            ids.sort((a, b) => bounds[a].min[axis] + bounds[a].max[axis] - bounds[b].min[axis] - bounds[b].max[axis])
            const half = Math.floor(ids.length / 2)
            visit(ids.slice(0, half))
            visit(ids.slice(half))
        }
        node.escape = nodes.length
    }
    if (bounds.length) visit(bounds.map((_, i) => i))
    return nodes
}

export function evaluateProgram(program: CsgInstruction[], inside: ArrayLike<number>, root: number): boolean {
    const values: boolean[] = []
    for (const instruction of program) {
        values.push(instruction.op === 'leaf' ? inside[instruction.operand] > 0 : instruction.op === 'empty' ? false : instruction.op === 'union' ? values[instruction.left] || values[instruction.right] : instruction.op === 'intersection' ? values[instruction.left] && values[instruction.right] : values[instruction.left] && !values[instruction.right])
    }
    return values[root] ?? false
}

/** Wire decoding uses browser/Node standard APIs; no Buffer or DOM dependency. */
export function decodeFloats(base64: string): Float32Array {
    return new Float32Array(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer)
}

export interface CsgRayHit {
    distance: number
    operand: number
    normal: [number, number, number]
    entering: boolean
}
export interface CsgClipPlane {
    normal: number[]
    constant: number
}
// Kept solely for CPU picking. None of these arrays enter a GPU material.
const queryCache = new WeakMap<CsgScene, { blas: CsgBlas[]; tlas: CsgBvhNode[] }>()
export function queryAcceleration(scene: CsgScene) {
    let cached = queryCache.get(scene)
    if (cached) return cached
    const blas = scene.meshes.map((mesh, index) => {
        const properties = decodeFloats(mesh.properties),
            indices = decodeIndices(mesh.indices),
            origin = scene.meshOrigins[index]
        const triangles = new Float32Array(indices.length * 4),
            min = [Infinity, Infinity, Infinity],
            max = [-Infinity, -Infinity, -Infinity]
        indices.forEach((vertex, i) => {
            for (let d = 0; d < 3; d++) {
                const x = properties[vertex * mesh.stride + d] - origin[d]
                triangles[i * 4 + d] = x
                min[d] = Math.min(min[d], x)
                max[d] = Math.max(max[d], x)
            }
        })
        const bvh = buildBvh(triangles)
        return { triangles: bvh.triangles, bvh: bvh.nodes, origin, bounds: { min, max }, triangleCount: indices.length / 3 }
    })
    cached = { blas, tlas: buildBoundsBvh(scene.operands.map((o) => o.bounds)) }
    queryCache.set(scene, cached)
    return cached
}

/** Double precision reference for picking and GPU regression oracles. */
export function traceCsg(input: CsgScene, origin: number[], direction: number[], root = input.topologyRoot, planes: CsgClipPlane[] = []): CsgRayHit[] {
    const scene = { ...input, ...queryAcceleration(input) }
    const events: { t: number; id: number; normal: [number, number, number]; enter: boolean }[] = []
    const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    const dot = (a: number[], b: number[]) => a.reduce((s, v, d) => s + v * b[d], 0)
    const sceneOrigin = origin.map((x, d) => x - scene.origin[d])
    const boxHit = (n: CsgBvhNode, ro: number[], rd: number[]) => {
        let lower = -Infinity,
            upper = Infinity
        for (let d = 0; d < 3; d++) {
            if (Math.abs(rd[d]) < 1e-30) {
                if (ro[d] < n.min[d] || ro[d] > n.max[d]) return false
            } else {
                const a = (n.min[d] - ro[d]) / rd[d],
                    b = (n.max[d] - ro[d]) / rd[d]
                lower = Math.max(lower, Math.min(a, b))
                upper = Math.min(upper, Math.max(a, b))
            }
        }
        return lower <= upper
    }
    const transform = (m: number[], v: number[], w: number) => [0, 1, 2].map((d) => m[d] * v[0] + m[d + 4] * v[1] + m[d + 8] * v[2] + m[d + 12] * w)
    for (let instanceCursor = 0; instanceCursor < scene.tlas.length;) {
        const instanceNode = scene.tlas[instanceCursor]
        if (!boxHit(instanceNode, sceneOrigin, direction)) {
            instanceCursor = instanceNode.escape
            continue
        }
        instanceCursor++
        if (instanceNode.first < 0) continue
        const id = instanceNode.first,
            operand = scene.operands[id],
            blas = scene.blas[operand.mesh]
        const data = blas.triangles
        const ro = transform(operand.inverse, sceneOrigin, 1),
            rd = transform(operand.inverse, direction, 0)
        for (let cursor = 0; cursor < blas.bvh.length;) {
            const n = blas.bvh[cursor]
            if (!boxHit(n, ro, rd)) {
                cursor = n.escape
                continue
            }
            cursor++
            for (let triangle = 0; triangle < n.count; triangle++) {
                const i = (n.first + triangle) * 12,
                    a = Array.from(data.subarray(i, i + 3)),
                    b = Array.from(data.subarray(i + 4, i + 7)),
                    c = Array.from(data.subarray(i + 8, i + 11))
                const e1 = b.map((x, d) => x - a[d]),
                    e2 = c.map((x, d) => x - a[d]),
                    p = cross(rd, e2),
                    det = dot(e1, p)
                if (Math.abs(det) < 1e-20) continue
                const offset = ro.map((x, d) => x - a[d]),
                    u = dot(offset, p) / det,
                    q = cross(offset, e1),
                    v = dot(rd, q) / det
                if (u < -1e-10 || v < -1e-10 || u + v > 1 + 1e-10) continue
                const localNormal = cross(e1, e2),
                    m = operand.normalMatrix,
                    normal = [0, 1, 2].map((d) => m[d] * localNormal[0] + m[d + 3] * localNormal[1] + m[d + 6] * localNormal[2]),
                    length = Math.hypot(...normal)
                if (!length) continue
                events.push({ t: dot(e2, q) / det, id, normal: normal.map((x) => x / length) as [number, number, number], enter: dot(localNormal, rd) < 0 })
            }
        }
    }
    events.sort((a, b) => a.t - b.t)
    const rootInstruction = scene.program[root]
    if (rootInstruction.op === 'leaf' && !scene.operands[rootInstruction.operand].closed)
        return events
            .filter(
                (e) =>
                    e.id === rootInstruction.operand &&
                    e.t >= 0 &&
                    planes.every(
                        (p) =>
                            dot(
                                origin.map((x, d) => x + direction[d] * e.t),
                                p.normal,
                            ) +
                                p.constant >=
                            0,
                    ),
            )
            .map((e) => ({ distance: e.t, operand: e.id, normal: e.normal, entering: e.enter }))
    const state = new Uint8Array(scene.operands.length),
        hits: CsgRayHit[] = []
    for (let i = 0; i < events.length;) {
        const t = events[i].t,
            before = evaluateProgram(scene.program, state, root)
        const flags = new Map<number, number>()
        const group = []
        do {
            const e = events[i++]
            flags.set(e.id, (flags.get(e.id) ?? 0) | (e.enter ? 1 : 2))
            group.push(e)
        } while (i < events.length && Math.abs(events[i].t - t) <= Math.max(1, Math.abs(t)) * 1e-9)
        let sourceId = group[0].id,
            previous = before
        for (const [id, flag] of flags)
            if (flag !== 3) {
                state[id] = flag === 1 ? 1 : 0
                const current = evaluateProgram(scene.program, state, root)
                if (current !== previous) {
                    sourceId = id
                    previous = current
                }
            }
        const after = evaluateProgram(scene.program, state, root)
        if (before !== after) {
            const e = group.find((event) => event.id === sourceId)!
            const flip = e.enter === after ? 1 : -1
            hits.push({ distance: t, operand: e.id, normal: e.normal.map((x) => x * flip) as [number, number, number], entering: after })
        }
    }
    if (!planes.length) return hits.filter((hit) => hit.distance >= 0)
    let lower = -Infinity,
        upper = Infinity
    let lowerNormal: number[] = [],
        upperNormal: number[] = []
    for (const plane of planes) {
        const denominator = dot(direction, plane.normal),
            offset = dot(origin, plane.normal) + plane.constant
        if (Math.abs(denominator) < 1e-20) {
            if (offset < 0) return []
            continue
        }
        const t = -offset / denominator
        if (denominator > 0 && t > lower) {
            lower = t
            lowerNormal = plane.normal.map((x) => -x)
        }
        if (denominator < 0 && t < upper) {
            upper = t
            upperNormal = plane.normal.map((x) => -x)
        }
    }
    const clipped: CsgRayHit[] = []
    for (let i = 0; i + 1 < hits.length; i += 2) {
        const a = hits[i],
            b = hits[i + 1],
            start = Math.max(a.distance, lower),
            end = Math.min(b.distance, upper)
        if (start >= end) continue
        if (start >= 0) clipped.push({ ...a, distance: start, normal: (lower > a.distance ? lowerNormal : a.normal) as [number, number, number] })
        if (end >= 0) clipped.push({ ...b, distance: end, normal: (upper < b.distance ? upperNormal : b.normal) as [number, number, number] })
    }
    return clipped
}

export function decodeIndices(encoded: string): Uint32Array {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
    if (bytes.byteLength % 4) throw new Error('Invalid CSG index buffer.')
    return new Uint32Array(bytes.buffer)
}
