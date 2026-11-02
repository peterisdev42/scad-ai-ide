import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CSG_RASTER_WORK_LIMIT, estimateRasterWork, estimateSceneRasterWork, prepareRasterBoundaries, prepareExteriorUnion, planRasterProducts, type RasterBoundary, type RasterPredicateGroup } from '../../core/csg/rasterWork'
import type { CsgScene } from '../../core/csg/types'

const product = (intersections: number[] = [], subtractions: number[] = []) => ({ intersections, subtractions })
const direct = (operand: number): RasterBoundary => ({ operand, convex: true, inside: [product()], outside: [] })

test('many disjoint, unconstrained operands share one direct raster submission', () => {
    assert.equal(estimateRasterWork(Array.from({ length: 1500 }, (_, i) => direct(i))), 1)
    assert.ok(CSG_RASTER_WORK_LIMIT > 0)
})

test('raster estimate scales with overlapping CSG predicates rather than mesh triangles', () => {
    const difference: RasterBoundary[] = [
        { operand: 0, convex: true, inside: [product([], [1, 2])], outside: [] },
        { operand: 1, convex: true, inside: [], outside: [product([0], [2])] },
        { operand: 2, convex: true, inside: [], outside: [product([0], [1])] },
    ]
    assert.equal(estimateRasterWork(difference), 3 * 2 * (3 + 2))
    const repeated = Array.from({ length: 80 }, (_, operand) => ({
        operand,
        convex: true,
        inside: [product(Array.from({ length: 79 }, (_, id) => (id < operand ? id : id + 1)))],
        outside: [],
    }))
    assert.ok(estimateRasterWork(repeated) > 400)
})

test('nonconvex depth-layer budgets increase the estimated raster work', () => {
    const boundary: RasterBoundary = { operand: 7, convex: false, inside: [product([3])], outside: [] }
    assert.equal(estimateRasterWork([boundary], new Map([[7, 4]])), estimateRasterWork([boundary]) * 4)
})

test('scene and operand estimates share the same exact boundary plan', () => {
    const scene = {
        program: [
            { op: 'leaf', operand: 0 },
            { op: 'leaf', operand: 1 },
            { op: 'difference', left: 0, right: 1 },
        ],
        root: 2,
        products: [{ intersections: [0], subtractions: [1] }],
        overlays: [],
        operands: [
            { bounds: { min: [0, 0, 0], max: [10, 10, 10] }, convex: true },
            { bounds: { min: [2, 2, 2], max: [8, 8, 8] }, convex: true },
        ],
    } as CsgScene
    const viewer = estimateRasterWork(prepareRasterBoundaries(scene))
    const host = estimateSceneRasterWork(scene)
    assert.equal(host, viewer)
    assert.ok(host > 0)
})

test('batched stencil schedules preserve Boolean truth with mixed signs and convex/nonconvex operands', () => {
    const evaluate = (ps: ReturnType<typeof product>[], bits: number) => ps.some((p) => p.intersections.every((id) => !!(bits & (1 << id))) && p.subtractions.every((id) => !(bits & (1 << id))))
    let seed = 47
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
    for (let sample = 0; sample < 80; sample++) {
        const allIds = Array.from({ length: 10 }, (_, i) => i)
        const forced = [[product(allIds)], allIds.map((id) => product([], [id])), [product(allIds.slice(0, 5), allIds.slice(5))], [product()], [], [product([0]), product([], [0])]][sample]
        const ps =
            forced ??
            Array.from({ length: 1 + ((random() >>> 16) % 12) }, () => {
                const p = product()
                for (let i = 0; i < 10; i++) {
                    const choice = (random() >>> 16) % 4
                    if (choice === 0) p.intersections.push(i)
                    if (choice === 1) p.subtractions.push(i)
                }
                return p
            })
        const schedule = planRasterProducts(ps)
        for (let bits = 0; bits < 1024; bits++) {
            const groupValue = (group: RasterPredicateGroup, all: boolean) => {
                let mask = 0,
                    expected = 0
                group.predicates.forEach((p, i) => {
                    mask |= ((bits >> p.operand) & 1) << i
                    if (p.inside === all) expected |= 1 << i
                })
                return all ? mask === expected : mask !== expected
            }
            const actual = schedule.some((plan) => plan.factors.every((group) => groupValue(group, true)) && plan.batches.some((batch) => (batch.operation === 'any' ? groupValue(batch.group, false) : batch.groups.every((group) => groupValue(group, true)))))
            assert.equal(actual, evaluate(ps, bits), `sample ${sample}, assignment ${bits}`)
        }
    }
})

test('independent parity predicates split at eight and reuse immutable schedules', () => {
    const ps = [product(Array.from({ length: 520 }, (_, i) => i))]
    const schedule = planRasterProducts(ps),
        batch = schedule[0].batches[0]
    if (batch.operation !== 'all') assert.fail('Expected conjunction')
    assert.equal(batch.groups.length, 65)
    assert.ok(batch.groups.every((g) => g.predicates.length === 8))
    assert.equal(planRasterProducts(ps), schedule)
})

test('192 overlapping convex operands reduce real submission work without raising the safety limit', () => {
    const n = 192
    const boundaries: RasterBoundary[] = Array.from({ length: n }, (_, operand) => ({
        operand,
        convex: true,
        inside: [product()],
        outside: Array.from({ length: n }, (_, other) => other)
            .filter((other) => other !== operand)
            .map((other) => product([other])),
    }))
    const unbatched = 10 * n * n - 2 * n
    assert.equal(unbatched, 368256)
    assert.equal(estimateRasterWork(boundaries), 20352)
    assert.equal(CSG_RASTER_WORK_LIMIT, 50000)
    assert.ok(estimateRasterWork(boundaries) < CSG_RASTER_WORK_LIMIT)
    assert.ok(
        estimateRasterWork(
            boundaries.map((b) => ({ ...b, convex: false })),
            new Map(boundaries.map((b) => [b.operand, 64])),
        ) > CSG_RASTER_WORK_LIMIT,
        'Real depth complexity must still be bounded',
    )
})

test('repeated cofactor Products share immutable references within a bounded plan', () => {
    const n = 140,
        program: CsgScene['program'] = [{ op: 'leaf', operand: 0 }]
    let root = 0
    for (let i = 1; i < n; i++) {
        const leaf = program.push({ op: 'leaf', operand: i }) - 1
        root = program.push({ op: 'union', left: root, right: leaf }) - 1
    }
    const scene = { program, root, products: Array.from({ length: n }, (_, i) => product([i])), overlays: [], operands: Array.from({ length: n }, () => ({ bounds: { min: [0, 0, 0], max: [10, 10, 10] }, convex: true })) } as CsgScene
    const bs = prepareRasterBoundaries(scene),
        terms = bs.flatMap((b) => [...b.inside, ...b.outside])
    assert.equal(new Set(terms).size, n + 1)
    assert.equal(
        bs[0].outside.find((p) => p.intersections[0] === 2),
        bs[1].outside.find((p) => p.intersections[0] === 2),
    )
    assert.ok(terms.length > 16384, 'Repeated references should not be charged as unique Products')
})

test('exterior union scheduling preserves nested Boolean components and rejects shared operands', () => {
    const scene = {
        program: [
            { op: 'leaf', operand: 0 },
            { op: 'leaf', operand: 1 },
            { op: 'difference', left: 0, right: 1 },
            { op: 'leaf', operand: 2 },
            { op: 'leaf', operand: 3 },
            { op: 'intersection', left: 3, right: 4 },
            { op: 'union', left: 2, right: 5 },
        ],
        root: 6,
        products: [product([0], [1]), product([2, 3])],
        overlays: [],
        operands: Array.from({ length: 4 }, () => ({ bounds: { min: [0, 0, 0], max: [10, 10, 10] }, convex: true })),
    } as CsgScene
    const boundaries = prepareExteriorUnion(scene)!
    assert.equal(boundaries.length, 4)
    assert.deepEqual(boundaries.find((b) => b.operand === 0)?.inside, [product([], [1])])
    assert.deepEqual(boundaries.find((b) => b.operand === 1)?.outside, [product([0])])
    assert.deepEqual(boundaries.find((b) => b.operand === 2)?.inside, [product([3])])
    assert.equal(prepareExteriorUnion(scene, 2), undefined)
    assert.equal(prepareExteriorUnion(scene, 5), undefined)
    const shared = { ...scene, program: [...scene.program, { op: 'union' as const, left: 2, right: 0 }], root: 7 }
    assert.equal(prepareExteriorUnion(shared), undefined)
})
