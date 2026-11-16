import { createHash } from 'node:crypto'
import { decodeMesh } from '../mesh/decode'
import { matrix } from '../assembly/AssemblyKernel'
import { next } from '../assembly/exact'
import type { DecodedMesh, RawMesh, Vec3 } from '../mesh/types'
import type { SubjectInput, SubjectDigest, PrintProfile, PrintResult } from './types'
import { worldArtifact } from '../assembly/worldMesh'
import { meshLimits } from '../mesh/types'
export interface PreparedSubject {
    id: string | null
    local: DecodedMesh
    world: DecodedMesh
    matrix: number[]
    anchorHash: string
}
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')
export function subjects(inputs: SubjectInput[]): PreparedSubject[] {
    let count = 0,
        vertices = 0,
        expanded = 0,
        arrays = 0
    return inputs.map((input) => {
        const local = decodeMesh(input.bytes, input.format)
        local.units = input.units
        count += local.rawTriangles
        vertices += local.rawVertices
        expanded += local.expandedBytes ?? 0
        arrays += local.meshes.reduce((n, m) => n + m.positions.byteLength * 2 + m.indices.byteLength, 0)
        if (count > meshLimits.triangles || vertices > meshLimits.vertices || expanded > meshLimits.expandedBytes || arrays > meshLimits.arrayBytes) throw new Error('REVIEW_GEOMETRY_BUDGET')
        const m = input.worldMatrix ?? matrix(input.transform),
            world = {
                ...local,
                meshes: local.meshes.map((mesh) => {
                    const positions = new Float64Array(mesh.positions.length)
                    for (let i = 0; i < positions.length; i += 3)
                        for (let k = 0; k < 3; k++) {
                            const v = m[k] * mesh.positions[i] + m[4 + k] * mesh.positions[i + 1] + m[8 + k] * mesh.positions[i + 2] + m[12 + k]
                            if (!Number.isFinite(v)) throw new Error('REVIEW_NONFINITE')
                            positions[i + k] = v
                        }
                    return { ...mesh, positions }
                }),
            }
        return { id: input.id, local, world, matrix: m, anchorHash: sha(JSON.stringify({ bytes: sha(input.bytes), format: input.format, units: input.units, decoder: 'raw-mesh-v1' })) }
    })
}
function vertexHex(mesh: RawMesh, index: number) {
    const b = Buffer.allocUnsafe(24)
    for (let k = 0; k < 3; k++) b.writeDoubleBE(mesh.positions[index * 3 + k] || 0, k * 8)
    return b.toString('hex')
}
/** Oriented triangle multisets remove headers and order while preserving instance/fill semantics. */
export function geometryDigest(subject: PreparedSubject): SubjectDigest {
    const meshes = subject.local.meshes
        .map((m) => {
            const triangles: string[] = []
            for (let i = 0; i < m.indices.length; i += 3) {
                const a = vertexHex(m, m.indices[i]),
                    b = vertexHex(m, m.indices[i + 1]),
                    c = vertexHex(m, m.indices[i + 2])
                triangles.push([a + b + c, b + c + a, c + a + b].sort()[0])
            }
            triangles.sort()
            const hash = createHash('sha256')
            for (const t of triangles) hash.update(t)
            return hash.digest('hex')
        })
        .sort()
    return { id: subject.id, geometryHash: sha(JSON.stringify({ version: 1, fill: subject.local.format, units: subject.local.units, meshes })), anchorHash: subject.anchorHash, triangles: subject.local.rawTriangles, vertices: subject.local.rawVertices }
}
interface I {
    lower: number
    upper: number
}
const exact = (n: number): I => ({ lower: n, upper: n })
function times(a: number, b: number): I {
    const p = a * b
    if (a === 0 || b === 0) return exact(0)
    if (a === 1 || b === 1 || a === -1 || b === -1) return exact(p)
    return { lower: next(p, false), upper: next(p, true) }
}
function plus(a: I, b: I): I {
    if (a.lower === 0 && a.upper === 0) return b
    if (b.lower === 0 && b.upper === 0) return a
    return { lower: next(a.lower + b.lower, false), upper: next(a.upper + b.upper, true) }
}
export function printScreen(input: SubjectInput, profile: PrintProfile, trusted: boolean): PrintResult {
    const local = subjects([{ ...input, transform: undefined, worldMatrix: undefined }])[0].local,
        pose = matrix({ translate: profile.buildPose.translate, rotate: profile.buildPose.rotate }),
        min: I[] = [exact(Infinity), exact(Infinity), exact(Infinity)],
        max: I[] = [exact(-Infinity), exact(-Infinity), exact(-Infinity)]
    const result: PrintResult = { envelope: { status: 'PASS', bounds: null }, overhang: { status: 'NONE_FOUND', complete: true, candidateCount: 0, uncertainCount: 0, candidateArea: 0, samples: [] }, incomplete: [] }
    let triangle = 0,
        compensation = 0
    for (const mesh of local.meshes) {
        const points: Array<{ p: Vec3; bounds: I[] }> = []
        for (let i = 0; i < mesh.positions.length; i += 3) {
            const bounds = [0, 1, 2].map((k) => {
                let n = exact(pose[12 + k])
                for (let j = 0; j < 3; j++) n = plus(n, times(pose[j * 4 + k], mesh.positions[i + j]))
                if (!Number.isFinite(n.lower) || !Number.isFinite(n.upper)) throw new Error('PRINT_NUMERIC_UNRESOLVED')
                min[k] = { lower: Math.min(min[k].lower, n.lower), upper: Math.min(min[k].upper, n.upper) }
                max[k] = { lower: Math.max(max[k].lower, n.lower), upper: Math.max(max[k].upper, n.upper) }
                return n
            })
            points.push({ p: bounds.map((b) => b.lower + (b.upper - b.lower) / 2) as Vec3, bounds })
        }
        for (let t = 0; t < mesh.indices.length; t += 3, triangle++) {
            if (!trusted) continue
            const p = [0, 1, 2].map((v) => points[mesh.indices[t + v]]),
                a = p[0].p,
                b = p[1].p,
                c = p[2].p,
                u = b.map((n, k) => n - a[k]),
                v = c.map((n, k) => n - a[k]),
                n: [number, number, number] = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]],
                length = Math.hypot(...n)
            if (!Number.isFinite(length) || length === 0) {
                result.overhang.uncertainCount++
                continue
            }
            if (p.every((v) => v.bounds[2].lower === 0 && v.bounds[2].upper === 0)) continue
            const normal = n.map((x) => x / length) as Vec3,
                angle = (Math.asin(Math.max(0, Math.min(1, -normal[2]))) * 180) / Math.PI
            // Angle screening is a numerical candidate heuristic, never a certified printability test.
            if (normal[2]<0&&Math.abs(angle - profile.maxOverhangFromVerticalDeg) <= 1e-6) {
                result.overhang.uncertainCount++
                continue
            }
            if (normal[2] < 0 && angle > profile.maxOverhangFromVerticalDeg) {
                result.overhang.candidateCount++
                const y = length / 2 - compensation,
                    sum = result.overhang.candidateArea + y
                compensation = sum - result.overhang.candidateArea - y
                result.overhang.candidateArea = sum
                if (result.overhang.samples.length < 200) result.overhang.samples.push({ triangle, instanceId: mesh.instanceId, point: a.map((n, k) => (n + b[k] + c[k]) / 3) as Vec3, normal, angleDeg: angle })
            }
        }
    }
    if (!local.rawTriangles) {
        result.envelope.status = 'UNRESOLVED'
        result.incomplete.push('EMPTY_MESH')
    } else {
        result.envelope.bounds = { min, max }
        for (let k = 0; k < 3; k++) {
            if (min[k].upper < 0 || max[k].lower > profile.buildVolumeMm[k]) result.envelope.status = 'FAIL'
            else if (result.envelope.status !== 'FAIL' && (min[k].lower < 0 || max[k].upper > profile.buildVolumeMm[k])) result.envelope.status = 'UNRESOLVED'
        }
    }
    if (!trusted) {
        result.overhang.complete = false
        result.incomplete.push('RAW_SOLID_PREREQUISITES_NOT_PROVEN')
    }
    if (result.overhang.uncertainCount) {
        result.overhang.complete = false
        result.incomplete.push('OVERHANG_BOUNDARY_UNRESOLVED')
    }
    result.overhang.status = result.overhang.candidateCount ? 'CANDIDATES_FOUND' : !result.overhang.complete ? 'UNRESOLVED' : 'NONE_FOUND'
    return result
}
export interface DisplayPart {
    key: string
    partId: string | null
    role: 'baseline' | 'target'
    positions: Float32Array
    indices: Uint32Array
    mesh: number
    instanceId: string
    anchorHash: string
}
export interface DisplayEvidence {
    origin: Vec3
    parts: DisplayPart[]
    maxCoordinateError: number
}
/** EVW1 is display-only. Original Float64 ASW1 stays on the host for picking. */
export function encodeDisplay(prepared: PreparedSubject[], role: 'baseline' | 'target', origin?: Vec3): { display: Uint8Array; world: Uint8Array } {
    const all = prepared.flatMap((p) => p.world.meshes),
        min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity]
    for (const m of all)
        for (let i = 0; i < m.positions.length; i++) {
            const k = i % 3
            min[k] = Math.min(min[k], m.positions[i])
            max[k] = Math.max(max[k], m.positions[i])
        }
    const center = origin ?? (min.map((n, k) => (Number.isFinite(n) ? n / 2 + max[k] / 2 : 0)) as Vec3),
        parts: DisplayPart[] = []
    let error = 0,
        bytes = 0
    for (const p of prepared)
        p.world.meshes.forEach((m, mesh) => {
            const positions = new Float32Array(m.positions.length)
            for (let i = 0; i < positions.length; i++) {
                const v = m.positions[i] - center[i % 3]
                positions[i] = v
                error = Math.max(error, Math.abs(v - positions[i]))
                if (!Number.isFinite(positions[i])) throw new Error('DISPLAY_PRECISION_UNAVAILABLE')
            }
            bytes += positions.byteLength + m.indices.byteLength
            if (bytes > 128 * 1048576) throw new Error('VIEW_BUDGET_EXCEEDED')
            parts.push({ key: `${role}:${p.id ?? 'document'}:${mesh}`, partId: p.id, role, positions, indices: m.indices, mesh, instanceId: m.instanceId, anchorHash: p.anchorHash })
        })
    const metadata = Buffer.from(JSON.stringify({ version: 1, origin: center, maxCoordinateError: error, parts: parts.map((p) => ({ ...p, positions: p.positions.length, indices: p.indices.length })) })),
        head = Buffer.alloc(8)
    head.write('EVW1')
    head.writeUInt32LE(metadata.length, 4)
    const chunks = [head, metadata]
    for (const p of parts) {
        const v = Buffer.alloc(p.positions.byteLength),
            i = Buffer.alloc(p.indices.byteLength)
        p.positions.forEach((n, k) => v.writeFloatLE(n, k * 4))
        p.indices.forEach((n, k) => i.writeUInt32LE(n, k * 4))
        chunks.push(v, i)
    }
    return { display: Buffer.concat(chunks), world: worldArtifact(prepared.map((p) => ({ id: p.id ?? '@document', decoded: p.world }))) }
}
export interface PickRequest {
    mesh: number
    triangle: number
    ray: { origin: Vec3; direction: Vec3 }
    camera: unknown
}
export function pickSurface(input: SubjectInput, pick: PickRequest) {
    const prepared = subjects([input])[0],
        world = prepared.world.meshes[pick.mesh],
        local = prepared.local.meshes[pick.mesh]
    if (!world || !Number.isInteger(pick.triangle) || pick.triangle < 0 || pick.triangle >= world.indices.length / 3 || !Array.isArray(pick.ray.origin) || !Array.isArray(pick.ray.direction) || pick.ray.origin.length !== 3 || pick.ray.direction.length !== 3 || [...pick.ray.origin, ...pick.ray.direction].some((n) => !Number.isFinite(n)) || Math.abs(Math.hypot(...pick.ray.direction) - 1) > 1e-6) throw new Error('PICK_UNRESOLVED')
    const tri = [0, 1, 2].map((i) => [0, 1, 2].map((k) => world.positions[world.indices[pick.triangle * 3 + i] * 3 + k]) as Vec3),
        all = [...tri, pick.ray.origin, pick.ray.direction]
    let e = 0
    for (const p of all) for (const n of p) if (n) e = Math.min(e, E.dyadic(n).e)
    const asInt = (v: Vec3) => v.map((n) => E.integer(n, e)) as E.I3,
        [a, b, c, o, d] = all.map(asInt),
        u = E.sub(b, a),
        v = E.sub(c, a),
        normal = E.cross(u, v),
        den = E.dot(normal, d),
        s = E.dot(E.sub(a, o), normal)
    if (!den) throw new Error('PICK_UNRESOLVED')
    const time = E.rat(s, den)
    if (time.n < 0n) throw new Error('PICK_UNRESOLVED')
    const p = { p: E.add(E.mul(o, time.d), E.mul(d, time.n)), d: time.d },
        w = E.sub(p.p, E.mul(a, p.d)),
        uu = E.dot(u, u),
        vv = E.dot(v, v),
        uv = E.dot(u, v),
        det = (uu * vv - uv * uv) * p.d,
        ba = E.dot(w, u) * vv - E.dot(w, v) * uv,
        bb = E.dot(w, v) * uu - E.dot(w, u) * uv
    if (det <= 0n || ba < 0n || bb < 0n || ba + bb > det) throw new Error('PICK_PRECISION_UNRESOLVED')
    const position = E.coordinates(p, e)?.point,
        wa = E.bound(E.rat(ba, det), 0),
        wb = E.bound(E.rat(bb, det), 0)
    if (!position || !wa || !wb) throw new Error('PICK_PRECISION_UNRESOLVED')
    const alpha = wa.lower + (wa.upper - wa.lower) / 2,
        beta = wb.lower + (wb.upper - wb.lower) / 2,
        points = [0, 1, 2].map((i) => [0, 1, 2].map((k) => local.positions[local.indices[pick.triangle * 3 + i] * 3 + k]) as Vec3),
        localPosition = points[0].map((n, k) => n + (points[1][k] - n) * alpha + (points[2][k] - n) * beta) as Vec3
    const unit = (t: Vec3[]) => {
        const u = t[1].map((n, k) => n - t[0][k]),
            v = t[2].map((n, k) => n - t[0][k]),
            n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]],
            length = Math.hypot(...n)
        if (!Number.isFinite(length) || !length) throw new Error('PICK_NORMAL_UNRESOLVED')
        return n.map((x) => x / length) as Vec3
    }
    return { position, localPosition, normal: unit(tri), localNormal: unit(points), matrix: prepared.matrix, anchorHash: prepared.anchorHash, instanceId: local.instanceId }
}
import * as E from '../assembly/exact'
