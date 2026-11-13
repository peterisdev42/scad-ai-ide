import { meshLimits, unmeasured, type Bounds, type ComponentFacts, type DecodedMesh, type GeometryFacts, type MeshFinding, type ObjectFacts, type Quantity, type RawMesh, type Vec3 } from './types'
import { bounds, center, combine, containsBounds, cross, dot, length, mul, add, sub, Sum, o3, triangleIntersection, type Predicates } from './math'
import { buildBvh, pairs, rayCandidates, type Bvh } from './bvh'
class BudgetEnd extends Error {}
class DisjointSet {
    private parents: Uint32Array
    constructor(size: number) {
        this.parents = Uint32Array.from({ length: size }, (_, i) => i)
    }
    find(i: number): number {
        let at = i
        while (this.parents[at] !== at) at = this.parents[at]
        while (this.parents[i] !== i) {
            const next = this.parents[i]
            this.parents[i] = at
            i = next
        }
        return at
    }
    union(a: number, b: number) {
        const x = this.find(a),
            y = this.find(b)
        if (x !== y) this.parents[Math.max(x, y)] = Math.min(x, y)
    }
}
interface Edge {
    count: number
    face: number
    slot: number
    direction: number
}
interface Work {
    raw: RawMesh
    positions: Vec3[]
    indices: Uint32Array
    triangle(id: number): Vec3[]
    groups: number[][]
    component: Int32Array
    componentBounds: Bounds[]
    tree?: Bvh
    facts: ObjectFacts
    epsilon: number
    sound: boolean
    contact: boolean
}
export async function analyzeMesh(decoded: DecodedMesh, options: { maxPairs?: number; timeoutMs?: number } = {}): Promise<GeometryFacts> {
    const p: Predicates = await import('robust-predicates'),
        started = performance.now(),
        deadline = started + (options.timeoutMs ?? meshLimits.timeoutMs)
    let pairTests = 0,
        findingCount = 0,
        complete = !decoded.limitations.length
    const statuses = new Map<string, { fail: boolean; unresolved: boolean }>()
    const findings: MeshFinding[] = [],
        works: Work[] = [],
        maxPairs = Math.min(options.maxPairs ?? meshLimits.pairs, meshLimits.pairs)
    const check = () => {
        if (performance.now() > deadline) throw new BudgetEnd('MESH_ANALYSIS_TIMEOUT')
    }
    const countPair = () => {
        if (++pairTests > maxPairs) throw new BudgetEnd('MESH_PAIR_BUDGET')
        if ((pairTests & 1023) === 0) check()
    }
    const finding = (f: MeshFinding) => {
        const source = findings.length < 100 || (f.status === 'FAIL' && !findings.some((f) => f.status === 'FAIL')) ? works.find((w) => w.raw.instanceId === f.instanceId) : undefined
        if (source && f.triangles.length) f.triangleSamples = [...new Set(f.triangles)].slice(0, 2).map((triangle) => ({ triangle, vertices: source.triangle(triangle) as [Vec3, Vec3, Vec3] }))
        findingCount++
        const status = statuses.get(f.instanceId ?? '') ?? { fail: false, unresolved: false }
        status.fail ||= f.status === 'FAIL'
        status.unresolved ||= f.status === 'UNRESOLVED'
        statuses.set(f.instanceId ?? '', status)
        if (findings.length < 100) findings.push(f)
        else if (f.status === 'FAIL' && !findings.some((f) => f.status === 'FAIL')) findings[99] = f
        if (f.status === 'UNRESOLVED') complete = false
    }
    for (const limitation of decoded.limitations) finding({ code: limitation, status: 'UNRESOLVED', message: 'Input normalization or format semantics could not be fully certified.', triangles: [] })
    const quantity = (sum: Sum): Quantity => (Number.isFinite(sum.value) && Number.isFinite(sum.error) ? { status: 'PASS', value: sum.value, errorEstimate: sum.error, reason: 'computed-on-decoded-mesh; roundoff estimate, not an analytic-surface bound' } : unmeasured('NUMERIC_RANGE'))
    const numericInput = decoded.limitations.some((s) => s.startsWith('NUMERIC_'))
    try {
        for (const raw of decoded.meshes) {
            check()
            const positions: Vec3[] = [],
                map = new Map<string, number>(),
                remap = new Uint32Array(raw.positions.length / 3)
            let unsafeNumbers = numericInput
            for (let v = 0; v < remap.length; v++) {
                const point = Array.from(raw.positions.subarray(v * 3, v * 3 + 3)) as Vec3,
                    key = point.join(',')
                let id = map.get(key)
                if (id === undefined) {
                    id = positions.length
                    map.set(key, id)
                    positions.push(point)
                }
                remap[v] = id
                if (point.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e50 || (n !== 0 && Math.abs(n) < 1e-100))) unsafeNumbers = true
            }
            if (positions.length > meshLimits.vertices) throw new BudgetEnd('MESH_VERTEX_BUDGET')
            const indices = Uint32Array.from(raw.indices, (i) => remap[i]),
                n = indices.length / 3,
                ds = new DisjointSet(n),
                edges = new Map<number, Edge>(),
                duplicateFaces = new Set<string>(),
                adjacent = new Int32Array(n * 3).fill(-1),
                incident: number[][] = Array.from({ length: positions.length }, () => [])
            const box = bounds(
                    (function* () {
                        for (const index of indices) yield positions[index]
                    })(),
                ),
                diagonal = box ? length(box.dimensions) : 0,
                maxCoordinate = box ? Math.max(...box.min.map(Math.abs), ...box.max.map(Math.abs)) : 0
            const epsilon = Math.max(1e-12, diagonal * 1e-9, maxCoordinate * Number.EPSILON * 32)
            const facts: ObjectFacts = { instanceId: raw.instanceId, objectId: raw.objectId, vertices: positions.length, triangles: n, duplicateVertices: remap.length - positions.length, degenerateFaces: 0, duplicateFaces: 0, boundaryEdges: 0, nonManifoldEdges: 0, nonManifoldVertices: 0, inconsistentEdges: 0, componentCount: 0, components: [], bounds: box, surfaceArea: unmeasured('NOT_COMPLETED'), signedVolume: unmeasured('NOT_COMPLETED'), physicalVolume: unmeasured('NOT_COMPLETED'), status: 'UNRESOLVED' }
            const triangle = (id: number) => [positions[indices[id * 3]], positions[indices[id * 3 + 1]], positions[indices[id * 3 + 2]]]
            const work: Work = { raw, positions, indices, triangle, groups: [], component: new Int32Array(n), componentBounds: [], facts, epsilon, sound: true, contact: false }
            works.push(work)
            if (!box || !n) {
                facts.status = 'SKIPPED'
                facts.surfaceArea = { status: 'SKIPPED', value: null, reason: 'EMPTY_MESH' }
                facts.signedVolume = facts.surfaceArea
                facts.physicalVolume = facts.surfaceArea
                continue
            }
            if (!Number.isFinite(diagonal) || unsafeNumbers) {
                finding({ code: 'NUMERIC_RANGE', status: 'UNRESOLVED', message: 'Coordinates exceed the certified numeric range.', instanceId: raw.instanceId, triangles: [] })
                work.sound = false
                continue
            }
            const area = new Sum(),
                good: number[] = [],
                samples = new Map<string, number[]>()
            const sample = (code: string, face: number) => {
                const ids = samples.get(code) ?? []
                if (ids.length < 32) ids.push(face)
                samples.set(code, ids)
            }
            for (let face = 0; face < n; face++) {
                if ((face & 4095) === 0) check()
                const ids = Array.from(indices.subarray(face * 3, face * 3 + 3)),
                    tri = triangle(face),
                    normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])),
                    a = length(normal) / 2
                const exactDegenerate = [0, 1, 2].every((drop) => {
                    const axes = [0, 1, 2].filter((k) => k !== drop)
                    return p.orient2d(tri[0][axes[0]], tri[0][axes[1]], tri[1][axes[0]], tri[1][axes[1]], tri[2][axes[0]], tri[2][axes[1]]) === 0
                })
                area.add(a)
                if (new Set(ids).size < 3 || exactDegenerate) {
                    facts.degenerateFaces++
                    sample('MESH_DEGENERATE_FACE', face)
                    continue
                }
                if (!Number.isFinite(a) || a <= epsilon * epsilon) {
                    finding({ code: 'MESH_NEAR_DEGENERATE', status: 'UNRESOLVED', message: 'A face is below the numeric resolution policy.', instanceId: raw.instanceId, triangles: [face] })
                    work.sound = false
                }
                good.push(face)
                const faceKey = [...ids].sort((a, b) => a - b).join(',')
                if (duplicateFaces.has(faceKey)) {
                    facts.duplicateFaces++
                    sample('MESH_DUPLICATE_FACE', face)
                }
                duplicateFaces.add(faceKey)
                for (const v of ids) incident[v].push(face)
                for (let slot = 0; slot < 3; slot++) {
                    const a = ids[slot],
                        b = ids[(slot + 1) % 3],
                        key = Math.min(a, b) * (meshLimits.vertices + 1) + Math.max(a, b),
                        direction = a < b ? 1 : -1,
                        edge = edges.get(key)
                    if (!edge) edges.set(key, { count: 1, face, slot, direction })
                    else {
                        edge.count++
                        ds.union(face, edge.face)
                        if (edge.count === 2) {
                            adjacent[face * 3 + slot] = edge.face
                            adjacent[edge.face * 3 + edge.slot] = face
                            if (direction === edge.direction) {
                                facts.inconsistentEdges++
                                sample('MESH_INCONSISTENT_WINDING', face)
                            }
                        }
                    }
                }
            }
            facts.surfaceArea = quantity(area)
            for (const edge of edges.values()) {
                if (edge.count === 1) {
                    facts.boundaryEdges++
                    sample('MESH_BOUNDARY_EDGE', edge.face)
                } else if (edge.count > 2) {
                    facts.nonManifoldEdges++
                    sample('MESH_NON_MANIFOLD_EDGE', edge.face)
                }
            }
            for (let vertex = 0; vertex < incident.length; vertex++) {
                if ((vertex & 4095) === 0) check()
                const fan = incident[vertex]
                if (!fan.length) continue
                const seen = new Set<number>([fan[0]]),
                    queue = [fan[0]]
                while (queue.length) {
                    const face = queue.pop()!
                    for (let k = 0; k < 3; k++) {
                        const other = adjacent[face * 3 + k]
                        if (other >= 0 && !seen.has(other) && [0, 1, 2].some((j) => indices[other * 3 + j] === vertex)) {
                            seen.add(other)
                            queue.push(other)
                        }
                    }
                }
                if (seen.size !== fan.length) {
                    facts.nonManifoldVertices++
                    sample('MESH_NON_MANIFOLD_VERTEX', fan[0])
                }
            }
            const groups = new Map<number, number[]>()
            for (let face = 0; face < n; face++) {
                const root = ds.find(face),
                    group = groups.get(root) ?? []
                group.push(face)
                groups.set(root, group)
            }
            work.groups = [...groups.values()]
            facts.componentCount = work.groups.length
            const totalVolume = new Sum()
            for (let c = 0; c < work.groups.length; c++) {
                const faces = work.groups[c],
                    b = bounds(
                        (function* () {
                            for (const f of faces) yield* triangle(f)
                        })(),
                    )!,
                    origin = center(b),
                    volume = new Sum()
                work.componentBounds.push(b)
                for (const face of faces) {
                    work.component[face] = c
                    const [va, vb, vc] = triangle(face).map((v) => sub(v, origin))
                    volume.add(dot(va, cross(vb, vc)) / 6)
                }
                totalVolume.add(volume.value)
                if (c < 256) facts.components.push({ id: `${raw.instanceId}:c${c}`, triangles: faces.length, signedVolume: quantity(volume), parent: null, depth: null })
            }
            facts.signedVolume = quantity(totalVolume)
            const defects: Array<[string, number]> = [
                ['MESH_DEGENERATE_FACE', facts.degenerateFaces],
                ['MESH_DUPLICATE_FACE', facts.duplicateFaces],
                ['MESH_BOUNDARY_EDGE', facts.boundaryEdges],
                ['MESH_NON_MANIFOLD_EDGE', facts.nonManifoldEdges],
                ['MESH_NON_MANIFOLD_VERTEX', facts.nonManifoldVertices],
                ['MESH_INCONSISTENT_WINDING', facts.inconsistentEdges],
            ]
            for (const [code, count] of defects)
                if (count) {
                    finding({ code, status: 'FAIL', message: `${count} raw mesh defect(s). No repair was applied.`, instanceId: raw.instanceId, triangles: samples.get(code) ?? [] })
                    work.sound = false
                }
            if (work.groups.length > 256) {
                finding({ code: 'MESH_SHELL_BUDGET', status: 'UNRESOLVED', message: `${work.groups.length} components exceed the 256-shell relationship budget.`, instanceId: raw.instanceId, triangles: [] })
                work.sound = false
            }
            work.tree = buildBvh(good, triangle)
            pairs(work.tree, work.tree, epsilon, (a, b) => {
                countPair()
                const ai = Array.from(indices.subarray(a * 3, a * 3 + 3)),
                    bi = Array.from(indices.subarray(b * 3, b * 3 + 3)),
                    shared = ai.filter((i) => bi.includes(i)).map((i) => positions[i])
                const kind = triangleIntersection(p, triangle(a), triangle(b), shared, epsilon)
                if (kind !== 'none') {
                    finding({ code: kind === 'cross' ? 'MESH_SELF_INTERSECTION' : 'MESH_CONTACT_UNRESOLVED', status: kind === 'cross' ? 'FAIL' : 'UNRESOLVED', message: kind === 'cross' ? 'Raw triangles intersect beyond their allowed shared simplex.' : 'Non-adjacent contact or numeric proximity prevents a solid proof.', instanceId: raw.instanceId, triangles: [a, b] })
                    work.sound = false
                }
            })
        }
        const inside = (point: Vec3, work: Work, component?: number): boolean | undefined => {
            const directions: Vec3[] = [
                    [1, 0.317, 0.123],
                    [0.127, 1, 0.619],
                    [0.367, 0.149, 1],
                ],
                box = work.facts.bounds!
            const distance = (length(sub(point, center(box))) + length(box.dimensions) + 1) * 4
            let answer: number | undefined
            for (const direction of directions) {
                const end = add(point, mul(direction, distance))
                let winding = 0,
                    ambiguous = false
                rayCandidates(work.tree, point, direction, (face) => {
                    if (ambiguous || (component !== undefined && work.component[face] !== component)) return
                    countPair()
                    const tri = work.triangle(face),
                        s0 = o3(p, ...(tri as [Vec3, Vec3, Vec3]), point),
                        s1 = o3(p, ...(tri as [Vec3, Vec3, Vec3]), end)
                    if (Math.sign(s0) * Math.sign(s1) > 0) return
                    const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])),
                        denom = dot(n, direction)
                    if (Math.abs(denom) <= length(n) * Number.EPSILON * 32) {
                        if (Math.abs(dot(n, sub(point, tri[0]))) <= length(n) * work.epsilon) ambiguous = true
                        return
                    }
                    const sides = [0, 1, 2].map((i) => o3(p, point, end, tri[i], tri[(i + 1) % 3]))
                    if (!(sides.every((s) => s >= 0) || sides.every((s) => s <= 0))) return
                    if (s0 === 0 || sides.some((s) => s === 0) || Math.abs(dot(n, sub(point, tri[0]))) <= length(n) * work.epsilon) {
                        ambiguous = true
                        return
                    }
                    winding += denom > 0 ? 1 : -1
                })
                if (ambiguous) continue
                const count = component === undefined ? Number(winding > 0) : Math.abs(winding) % 2
                if (answer !== undefined) return answer === count ? count === 1 : undefined
                answer = count
            }
            return undefined // Require agreement of two unambiguous deterministic rays.
        }
        for (const work of works) {
            const facts = work.facts
            if (facts.status === 'SKIPPED') continue
            if (!work.sound || decoded.limitations.length) {
                facts.physicalVolume = unmeasured('SOLID_PRECONDITIONS_NOT_PROVEN')
                continue
            }
            const parents = work.groups.map(() => -1)
            for (let child = 0; child < work.groups.length; child++) {
                const point = work.triangle(work.groups[child][0])[0]
                let smallest = Infinity
                for (let outer = 0; outer < work.groups.length; outer++) {
                    if (outer === child || !containsBounds(work.componentBounds[outer], work.componentBounds[child], work.epsilon)) continue
                    const relation = inside(point, work, outer)
                    if (relation === undefined) {
                        finding({ code: 'MESH_SHELL_RELATION_UNRESOLVED', status: 'UNRESOLVED', message: 'Shell containment could not be established.', instanceId: facts.instanceId, triangles: [work.groups[child][0]] })
                        work.sound = false
                        continue
                    }
                    const volume = Math.abs(facts.components[outer].signedVolume.value ?? Infinity)
                    if (relation && volume < smallest) {
                        smallest = volume
                        parents[child] = outer
                    }
                }
            }
            const physical = new Sum()
            let physicalError = 0
            for (let c = 0; c < work.groups.length; c++) {
                const chain = new Set<number>([c])
                let at = parents[c],
                    depth = 0,
                    winding = 0
                while (at >= 0) {
                    if (chain.has(at)) {
                        work.sound = false
                        break
                    }
                    chain.add(at)
                    depth++
                    winding += Math.sign(facts.components[at].signedVolume.value ?? 0)
                    at = parents[at]
                }
                const component: ComponentFacts = facts.components[c],
                    value = component.signedVolume.value
                physicalError += component.signedVolume.errorEstimate ?? 0
                component.depth = depth
                component.parent = parents[c] < 0 ? null : facts.components[parents[c]].id
                if (value === null || Math.abs(value) <= (component.signedVolume.errorEstimate ?? 0)) {
                    work.sound = false
                    finding({ code: 'MESH_VOLUME_UNRESOLVED', status: 'UNRESOLVED', message: 'Signed volume is numerically unresolved.', instanceId: facts.instanceId, triangles: [] })
                    continue
                }
                if (decoded.format === '3mf') {
                    const after = winding + Math.sign(value)
                    if (parents[c] < 0 && value < 0) {
                        work.sound = false
                        finding({ code: 'MESH_INVERTED_WINDING', status: 'FAIL', message: 'A closed root shell is wound inward.', instanceId: facts.instanceId, triangles: [work.groups[c][0]] })
                    }
                    if (winding <= 0 && after > 0) physical.add(Math.abs(value))
                    else if (winding > 0 && after <= 0) physical.add(-Math.abs(value))
                } else {
                    const expected = depth % 2 ? -1 : 1
                    if (Math.sign(value) !== expected) {
                        work.sound = false
                        finding({ code: depth === 0 ? 'MESH_INVERTED_WINDING' : 'MESH_CAVITY_WINDING', status: 'FAIL', message: 'Shell orientation does not match its material/cavity nesting.', instanceId: facts.instanceId, triangles: [work.groups[c][0]] })
                    }
                    physical.add(value)
                }
            }
            if (work.sound && physical.value <= physical.error + physicalError) {
                work.sound = false
                finding({ code: 'MESH_VOLUME_UNRESOLVED', status: 'UNRESOLVED', message: 'Material volume is within its floating-point roundoff estimate.', instanceId: facts.instanceId, triangles: [] })
            }
            facts.physicalVolume = work.sound ? { ...quantity(physical), errorEstimate: physical.error + physicalError } : unmeasured('SHELL_ORIENTATION_OR_RELATION_UNRESOLVED')
        }
        // 3MF build union is proven only for disjoint or strictly contained valid instances.
        const excluded = new Set<number>()
        let composition = true
        for (let a = 0; a < works.length; a++)
            for (let b = a + 1; b < works.length; b++) {
                check()
                const x = works[a],
                    y = works[b]
                if (!x.facts.bounds || !y.facts.bounds || x.facts.status === 'SKIPPED' || y.facts.status === 'SKIPPED') continue
                const xb = x.facts.bounds,
                    yb = y.facts.bounds
                if ([0, 1, 2].some((k) => xb.max[k] < yb.min[k] - Math.max(x.epsilon, y.epsilon) || yb.max[k] < xb.min[k] - Math.max(x.epsilon, y.epsilon))) continue
                let contact = false
                pairs(x.tree, y.tree, Math.max(x.epsilon, y.epsilon), (ta, tb) => {
                    countPair()
                    if (triangleIntersection(p, x.triangle(ta), y.triangle(tb), [], Math.max(x.epsilon, y.epsilon)) !== 'none') contact = true
                })
                if (contact) {
                    composition = false
                    finding({ code: 'MESH_COMPOSITION_UNRESOLVED', status: 'UNRESOLVED', message: 'Overlapping/touching 3MF instances require a union not implemented by this raw analyzer.', triangles: [] })
                    continue
                }
                if (!x.sound || !y.sound) {
                    composition = false
                    continue
                }
                if (x.groups.length !== 1 || y.groups.length !== 1) {
                    composition = false
                    finding({ code: 'MESH_COMPOSITION_UNRESOLVED', status: 'UNRESOLVED', message: 'Multi-shell instance composition needs per-region union evidence not available in this version.', triangles: [] })
                    continue
                }
                const xinY = inside(x.triangle(0)[0], y),
                    yinX = inside(y.triangle(0)[0], x)
                if (xinY === undefined || yinX === undefined || (xinY && yinX)) {
                    composition = false
                    finding({ code: 'MESH_COMPOSITION_UNRESOLVED', status: 'UNRESOLVED', message: 'Instance containment is unresolved.', triangles: [] })
                } else if (xinY) excluded.add(a)
                else if (yinX) excluded.add(b)
            }
        for (const work of works)
            if (work.facts.status !== 'SKIPPED') {
                const own = statuses.get(work.facts.instanceId)
                work.facts.status = own?.fail ? 'FAIL' : !work.sound || own?.unresolved || decoded.limitations.length ? 'UNRESOLVED' : 'PASS'
            }
        const area = new Sum(),
            signed = new Sum(),
            physical = new Sum()
        let volume = composition && complete
        for (let i = 0; i < works.length; i++) {
            const f = works[i].facts
            if (f.surfaceArea.value !== null) area.add(f.surfaceArea.value)
            if (f.signedVolume.value !== null) signed.add(f.signedVolume.value)
            if (f.status !== 'SKIPPED' && f.physicalVolume.status !== 'PASS') volume = false
            if (!excluded.has(i) && f.physicalVolume.value !== null) physical.add(f.physicalVolume.value)
        }
        const empty = works.every((w) => w.facts.triangles === 0)
        return { algorithm: 'raw-mesh-v1', precision: 'computed-on-decoded-mesh', numericType: 'float64', topologyWeld: 'exact', objects: works.map((w) => w.facts), bounds: works.reduce<Bounds | null>((b, w) => combine(b, w.facts.bounds), null), surfaceArea: empty ? { status: 'SKIPPED', value: null, reason: 'EMPTY_MESH' } : works.every((w) => w.facts.surfaceArea.status === 'PASS' || w.facts.status === 'SKIPPED') ? quantity(area) : unmeasured('PARTIAL_AREA'), signedVolume: empty ? { status: 'SKIPPED', value: null, reason: 'EMPTY_MESH' } : works.every((w) => w.facts.signedVolume.status === 'PASS' || w.facts.status === 'SKIPPED') ? quantity(signed) : unmeasured('PARTIAL_SIGNED_VOLUME'), physicalVolume: empty ? { status: 'SKIPPED', value: null, reason: 'EMPTY_MESH' } : volume ? quantity(physical) : unmeasured('SOLID_OR_DOCUMENT_UNION_NOT_PROVEN'), findings, findingCount, complete, pairTests, elapsedMs: performance.now() - started, units: decoded.units, sourceUnit: decoded.sourceUnit, scale: decoded.scale, rawVertices: decoded.rawVertices, rawTriangles: decoded.rawTriangles, limitations: decoded.limitations }
    } catch (error) {
        if (!(error instanceof BudgetEnd)) throw error
        finding({ code: error.message, status: 'UNRESOLVED', message: 'Geometry analysis stopped at its execution budget. Partial facts are not a PASS.', triangles: [] })
        for (const work of works) {
            work.facts.physicalVolume = unmeasured(error.message)
            work.facts.status = 'UNRESOLVED'
        }
        return { algorithm: 'raw-mesh-v1', precision: 'computed-on-decoded-mesh', numericType: 'float64', topologyWeld: 'exact', objects: works.map((w) => w.facts), bounds: works.reduce<Bounds | null>((b, w) => combine(b, w.facts.bounds), null), surfaceArea: unmeasured(error.message), signedVolume: unmeasured(error.message), physicalVolume: unmeasured(error.message), findings, findingCount, complete: false, pairTests, elapsedMs: performance.now() - started, units: decoded.units, sourceUnit: decoded.sourceUnit, scale: decoded.scale, rawVertices: decoded.rawVertices, rawTriangles: decoded.rawTriangles, limitations: decoded.limitations }
    }
}
