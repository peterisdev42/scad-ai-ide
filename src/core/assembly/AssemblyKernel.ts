import { createHash } from 'node:crypto'
import { decodeMesh } from '../mesh/decode'
import { analyzeMesh } from '../mesh/analyze'
import { displayMesh } from '../mesh/displayMesh'
import { buildBvh, type Bvh } from '../mesh/bvh'
import type { DecodedMesh, RawMesh, Vec3 } from '../mesh/types'
import { assemblyLimits, type KernelPartInput, type KernelResult, type PartFacts, type PairFacts, type Interval } from './types'
import * as E from './exact'
import { pairId } from './identity'
export function matrix(transform: KernelPartInput['transform']): number[] {
    const [x, y, z] = (transform?.rotate ?? [0, 0, 0]).map((x) => (x * Math.PI) / 180),
        [sx, cx, sy, cy, sz, cz] = [Math.sin(x), Math.cos(x), Math.sin(y), Math.cos(y), Math.sin(z), Math.cos(z)],
        t = transform?.translate ?? [0, 0, 0]
    return [cz * cy, sz * cy, -sy, 0, cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx, 0, cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx, 0, ...t, 1]
}
function transformed(decoded: DecodedMesh, m: number[]): DecodedMesh {
    return {
        ...decoded,
        meshes: decoded.meshes.map((mesh) => {
            const positions = new Float64Array(mesh.positions.length)
            for (let i = 0; i < positions.length; i += 3)
                for (let k = 0; k < 3; k++) {
                    const value = m[k] * mesh.positions[i] + m[4 + k] * mesh.positions[i + 1] + m[8 + k] * mesh.positions[i + 2] + m[12 + k]
                    if (!Number.isFinite(value)) throw new Error('ASSEMBLY_NONFINITE')
                    positions[i + k] = value
                }
            return { ...mesh, positions }
        }),
    }
}
function exact(decoded: DecodedMesh, e: number): E.I3[][][] {
    return decoded.meshes.map((m) => Array.from({ length: m.indices.length / 3 }, (_, i) => [0, 1, 2].map((v) => [0, 1, 2].map((k) => E.integer(m.positions[m.indices[i * 3 + v] * 3 + k], e)) as E.I3)))
}
function floatTriangles(decoded: DecodedMesh): Vec3[][] {
    return decoded.meshes.flatMap((m) => Array.from({ length: m.indices.length / 3 }, (_, i) => [0, 1, 2].map((v) => [0, 1, 2].map((k) => m.positions[m.indices[i * 3 + v] * 3 + k]) as Vec3)))
}
function exponent(decoded: DecodedMesh) {
    let e = 0
    for (const m of decoded.meshes) for (const v of m.positions) if (v) e = Math.min(e, E.dyadic(v).e)
    return e
}
function dimensions(decoded: DecodedMesh): Interval[] | null {
    const e = exponent(decoded),
        vertices = decoded.meshes.flatMap((m) => Array.from({ length: m.positions.length / 3 }, (_, i) => [0, 1, 2].map((k) => E.integer(m.positions[i * 3 + k], e)) as E.I3))
    if (!vertices.length) return null
    return [0, 1, 2].map((k) => {
        let min = vertices[0][k],
            max = min
        for (const v of vertices) {
            min = min < v[k] ? min : v[k]
            max = max > v[k] ? max : v[k]
        }
        return E.bound(E.rat(max - min), e)!
    })
}
function volume(decoded: DecodedMesh): Interval | null {
    // Multiple 3MF instances may be nested or overlap; exact union volume is not implemented.
    if (decoded.format === '3mf' && decoded.meshes.length !== 1) return null
    const e = exponent(decoded)
    let n = 0n
    for (const instance of exact(decoded, e)) for (const t of instance) n += E.dot(t[0], E.cross(t[1], t[2]))
    // 3MF positive-fill may contain redundant shells. Alternating shell semantics are
    // established by the caller before this value is used for STL only.
    return E.bound(E.rat(n, 6n), 3 * e)
}
/** Versioned Float64 geometry, preserving original indices and instance provenance. */
export function worldArtifact(parts: Array<{ id: string; decoded: DecodedMesh }>): Uint8Array {
    const metadata = Buffer.from(JSON.stringify({ schemaVersion: 1, numericType: 'float64', parts: parts.map((p) => ({ id: p.id, meshes: p.decoded.meshes.map((m) => ({ instanceId: m.instanceId, objectId: m.objectId, positions: m.positions.length, indices: m.indices.length })) })) })),
        chunks: Buffer[] = []
    const header = Buffer.alloc(8)
    header.write('ASW1')
    header.writeUInt32LE(metadata.length, 4)
    chunks.push(header, metadata)
    for (const p of parts)
        for (const m of p.decoded.meshes) {
            const positions = Buffer.alloc(m.positions.byteLength),
                indices = Buffer.alloc(m.indices.byteLength)
            m.positions.forEach((v, i) => positions.writeDoubleLE(v, i * 8))
            m.indices.forEach((v, i) => indices.writeUInt32LE(v, i * 4))
            chunks.push(positions, indices)
        }
    return Buffer.concat(chunks)
}
function lowerBoxes(a: Bvh, b: Bvh): number {
    let sum = 0
    for (let k = 0; k < 3; k++) {
        const gap = Math.max(0, E.next(a.box.min[k] - b.box.max[k], false), E.next(b.box.min[k] - a.box.max[k], false))
        sum = Math.max(0, E.next(sum + Math.max(0, E.next(gap * gap, false)), false))
    }
    return Math.max(0, E.next(Math.sqrt(sum), false))
}
export async function analyzeAssembly(inputs: KernelPartInput[], requested: Array<[string, string]>): Promise<KernelResult> {
    const started = performance.now(),
        result: KernelResult = { parts: [], pairs: [], complete: true, incomplete: [], candidateTests: 0 },
        worlds = new Map<string, DecodedMesh>(),
        valid = new Map<string, boolean>()
    let arrayBytes = 0,
        totalVertices = 0,
        totalTriangles = 0,
        totalInput = 0,
        totalExpanded = 0
    const hashes = new Set<string>()
    const tick = () => {
        if (++result.candidateTests > assemblyLimits.candidates) throw new Error('ASSEMBLY_CANDIDATE_BUDGET')
        if (performance.now() - started > assemblyLimits.workerMs) throw new Error('ASSEMBLY_WORKER_TIMEOUT')
    }
    try {
        if (inputs.length > assemblyLimits.parts || requested.length > assemblyLimits.pairs) throw new Error('ASSEMBLY_SIZE_BUDGET')
        const unique = new Set<string>()
        for (const input of inputs) {
            if (unique.has(input.id)) throw new Error('DUPLICATE_PART_ID')
            unique.add(input.id)
            const hash = createHash('sha256').update(input.bytes).digest('hex')
            if (!hashes.has(hash)) {
                totalInput += input.bytes.length
                hashes.add(hash)
            }
            if (totalInput > assemblyLimits.inputBytes) throw new Error('ASSEMBLY_INPUT_BUDGET')
            const local = decodeMesh(input.bytes, input.format)
            totalExpanded += local.expandedBytes ?? 0
            if (totalExpanded > assemblyLimits.expandedBytes) throw new Error('ASSEMBLY_EXPANDED_BUDGET')
            local.units = 'mm'
            if (input.format === 'stl') local.sourceUnit = 'manifest:mm'
            totalVertices += local.rawVertices
            totalTriangles += local.rawTriangles
            arrayBytes += local.meshes.reduce((n, m) => n + 2 * m.positions.byteLength + m.indices.byteLength, 0)
            // BigInt coordinates and exact candidate temporaries are explicitly budgeted conservatively.
            arrayBytes += local.rawVertices * 3 * 160 + local.rawTriangles * 128
            if (totalVertices > assemblyLimits.vertices || totalTriangles > assemblyLimits.triangles || arrayBytes > assemblyLimits.arrayBytes) throw new Error('ASSEMBLY_ARRAY_BUDGET')
            tick()
            const localFacts = await analyzeMesh(local),
                m = matrix(input.transform),
                world = transformed(local, m),
                worldFacts = await analyzeMesh(world)
            result.candidateTests += localFacts.pairTests + worldFacts.pairTests
            tick()
            const sound = localFacts.complete && worldFacts.complete && localFacts.physicalVolume.status === 'PASS' && worldFacts.physicalVolume.status === 'PASS' && local.rawTriangles > 0
            valid.set(input.id, sound)
            worlds.set(input.id, world)
            const facts: PartFacts = { id: input.id, local: localFacts, world: worldFacts, matrix: m, volumeBound: sound && (local.format === 'stl' || (local.meshes.length === 1 && localFacts.objects.every((o) => o.components.every((c) => c.depth !== null && Math.sign(c.signedVolume.value ?? 0) === (c.depth % 2 ? -1 : 1))))) ? volume(local) : null, localDimensions: dimensions(local), worldDimensions: dimensions(world) }
            result.parts.push(facts)
        }
        for (const [a, b] of requested) {
            const before = performance.now(),
                base: PairFacts = { pairId: pairId(a, b), parts: [a, b], relation: 'undetermined', minDistance: null, distanceBound: null, closestPoints: null, witnessCoordinateBounds: null, triangles: null, contained: null, overlapVolume: null, overlapVolumeStatus: 'notChecked', method: 'exact-dyadic-bvh-v1', complete: false, errorBound: null, durationMs: 0 }
            result.pairs.push(base)
            if (!valid.get(a) || !valid.get(b)) {
                base.reason = 'RAW_SOLID_PREREQUISITES_NOT_PROVEN'
                continue
            }
            const aw = worlds.get(a)!,
                bw = worlds.get(b)!,
                e = Math.min(exponent(aw), exponent(bw)),
                ai = exact(aw, e),
                bi = exact(bw, e),
                at = ai.flat(),
                bt = bi.flat(),
                af = floatTriangles(aw),
                bf = floatTriangles(bw)
            if ([...aw.meshes, ...bw.meshes].some((m) => Array.from(m.positions).some((v) => v && E.dyadic(v).e - e + 53 > 512))) throw new Error('EXACT_COORDINATE_BUDGET')
            const ta = buildBvh(
                    af.map((_, i) => i),
                    (i) => af[i],
                ),
                tb = buildBvh(
                    bf.map((_, i) => i),
                    (i) => bf[i],
                )
            let best: E.Closest | undefined,
                ids: [number, number] | null = null,
                upper = Infinity
            const visit = (x: Bvh | undefined, y: Bvh | undefined) => {
                if (!x || !y || lowerBoxes(x, y) > upper) return
                if (x.ids && y.ids) {
                    for (const i of x.ids)
                        for (const j of y.ids) {
                            tick()
                            const v = E.triangles(at[i], bt[j])
                            if (!best || E.cmp(v.squared, best.squared) < 0n) {
                                best = v
                                ids = [i, j]
                                upper = E.bound(v.squared, e * 2, true)?.upper ?? Infinity
                            }
                        }
                } else if (!x.ids) {
                    visit(x.left, y)
                    visit(x.right, y)
                } else {
                    visit(x, y.left)
                    visit(x, y.right)
                }
            }
            visit(ta, tb)
            if (!best) {
                base.reason = 'DISTANCE_NOT_PROVEN'
                continue
            }
            const closest = best as E.Closest,
                distance = E.bound(closest.squared, e * 2, true),
                pa = E.coordinates(closest.a, e),
                pb = E.coordinates(closest.b, e)
            if (!distance || !pa || !pb) {
                base.reason = 'NUMERIC_ENCLOSURE_NOT_PROVEN'
                continue
            }
            Object.assign(base, { distanceBound: distance, minDistance: distance.lower + (distance.upper - distance.lower) / 2, closestPoints: [pa.point, pb.point], witnessCoordinateBounds: [pa.bounds, pb.bounds], triangles: ids, errorBound: distance.upper - distance.lower })
            if (closest.squared.n === 0n && E.separatingPlane(at, bt, tick)) {
                base.relation = 'contact'
                base.contained = false
                base.complete = true
            } else {
                // For disjoint boundaries each connected surface has constant material classification.
                // Inspect all vertices rather than relying on one arbitrary vertex or an AABB.
                let overlap = false,
                    uncertain = false,
                    contained = false
                for (const [own, other] of [
                    [ai, bi],
                    [bi, ai],
                ]) {
                    const seen = new Set<string>()
                    let allInside = true
                    for (const instance of own)
                        for (const tri of instance)
                            for (const vertex of tri) {
                                const key = vertex.join(',')
                                if (seen.has(key)) continue
                                seen.add(key)
                                const answer = E.inside({ p: vertex, d: 1n }, other, tick)
                                if (answer === true) overlap = true
                                else {
                                    allInside = false
                                    if (answer === undefined) uncertain = true
                                }
                            }
                    if (allInside && seen.size) contained = true
                }
                if (!overlap && closest.squared.n === 0n) {
                    // Coplanar triangles alone are not solid overlap. Produce an independently
                    // verified interior witness (also covers coincident entities and crossing faces).
                    for (const [own, other] of [
                        [ai, bi],
                        [bi, ai],
                    ]) {
                        if (overlap) break
                        for (const instance of own) {
                            if (overlap) break
                            for (const t of instance) {
                                if (overlap) break
                                const n = E.cross(E.sub(t[1], t[0]), E.sub(t[2], t[0])),
                                    sum = E.add(E.add(t[0], t[1]), t[2]),
                                    span = t.flat().reduce((m, v) => {
                                        const x = v < 0n ? -v : v
                                        return x > m ? x : m
                                    }, 1n),
                                    normal = n.reduce((m, v) => {
                                        const x = v < 0n ? -v : v
                                        return x > m ? x : m
                                    }, 1n)
                                let power = Math.max(4, normal.toString(2).length - span.toString(2).length + 8)
                                for (let k = 0; k < 40; k++, power++) {
                                    tick()
                                    const q = 1n << BigInt(power),
                                        point = { p: E.sub(E.mul(sum, q), n), d: 3n * q }
                                    if (E.inside(point, own, tick) !== true) continue
                                    if (E.inside(point, other, tick) === true) {
                                        overlap = true
                                        break
                                    }
                                    // At decreasing offsets a cavity/near-contact may become distinguishable.
                                }
                            }
                        }
                    }
                }
                if (overlap) {
                    base.relation = 'overlap'
                    base.contained = closest.squared.n > 0n && contained
                    base.complete = true
                } else if (closest.squared.n > 0n && !uncertain) {
                    base.relation = 'clear'
                    base.contained = false
                    base.complete = true
                } else base.reason = 'CONTACT_OR_OCCUPANCY_NOT_PROVEN'
            }
            base.durationMs = performance.now() - before
        }
        const worldList = [...worlds].map(([id, decoded]) => ({ id, decoded })),
            meshes: RawMesh[] = worldList.flatMap((p) => p.decoded.meshes.map((m) => ({ ...m, instanceId: p.id + ':' + m.instanceId })))
        if (worldList.length) {
            result.worldMesh = worldArtifact(worldList)
            result.display = displayMesh({ ...worldList[0].decoded, meshes })
        }
    } catch (error) {
        result.complete = false
        result.incomplete.push(error instanceof Error ? error.message : 'ASSEMBLY_KERNEL_FAILED')
    }
    if (result.pairs.some((p) => !p.complete)) result.incomplete.push('PAIR_RELATIONS_UNRESOLVED')
    result.complete &&= result.parts.length === inputs.length && result.pairs.length === requested.length && result.pairs.every((p) => p.complete)
    return result
}
export function readWorldArtifact(bytes: Uint8Array, selected: string[]): DecodedMesh {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (buffer.length < 8 || buffer.toString('ascii', 0, 4) !== 'ASW1') throw new Error('WORLD_ARTIFACT_INVALID')
    const length = buffer.readUInt32LE(4)
    if (length > 1048576 || length + 8 > buffer.length) throw new Error('WORLD_ARTIFACT_INVALID')
    const metadata = JSON.parse(buffer.toString('utf8', 8, 8 + length)) as { schemaVersion: number; parts: Array<{ id: string; meshes: Array<{ instanceId: string; objectId: string; positions: number; indices: number }> }> }
    if (metadata.schemaVersion !== 1) throw new Error('WORLD_ARTIFACT_VERSION')
    let offset = 8 + length
    const meshes: RawMesh[] = []
    for (const p of metadata.parts)
        for (const m of p.meshes) {
            if (!Number.isInteger(m.positions) || m.positions < 0 || m.positions % 3 || !Number.isInteger(m.indices) || m.indices < 0 || m.indices % 3 || offset + m.positions * 8 + m.indices * 4 > buffer.length) throw new Error('WORLD_ARTIFACT_INVALID')
            if (selected.includes(p.id)) {
                const positions = new Float64Array(m.positions),
                    indices = new Uint32Array(m.indices)
                positions.forEach((_, i) => (positions[i] = buffer.readDoubleLE(offset + i * 8)))
                indices.forEach((_, i) => (indices[i] = buffer.readUInt32LE(offset + m.positions * 8 + i * 4)))
                meshes.push({ ...m, positions, indices, instanceId: p.id + ':' + m.instanceId, reflected: false, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] })
            }
            offset += m.positions * 8 + m.indices * 4
        }
    if (offset !== buffer.length) throw new Error('WORLD_ARTIFACT_INVALID')
    return { format: 'stl', units: 'mm', sourceUnit: 'frozen-world-mm', scale: 1, meshes, limitations: [], rawTriangles: meshes.reduce((n, m) => n + m.indices.length / 3, 0), rawVertices: meshes.reduce((n, m) => n + m.positions.length / 3, 0) }
}
