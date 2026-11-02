import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CSG_INTERACTIVE_WORK_LIMIT, CSG_RASTER_WORK_LIMIT, estimateRasterWork, estimateSceneRasterWork, prepareRasterBoundaries, type RasterBoundary } from '../../core/csg/rasterWork'
import type { CsgScene } from '../../core/csg/types'

const product = (intersections: number[] = [], subtractions: number[] = []) => ({ intersections, subtractions })
const direct = (operand: number): RasterBoundary => ({ operand, convex: true, inside: [product()], outside: [] })

test('many disjoint, unconstrained operands share one direct raster submission', () => {
    assert.equal(estimateRasterWork(Array.from({ length: 1500 }, (_, i) => direct(i))), 1)
    assert.ok(CSG_INTERACTIVE_WORK_LIMIT < CSG_RASTER_WORK_LIMIT)
})

test('raster estimate scales with overlapping CSG predicates rather than mesh triangles', () => {
    const difference: RasterBoundary[] = [
        { operand: 0, convex: true, inside: [product([], [1, 2])], outside: [] },
        { operand: 1, convex: true, inside: [], outside: [product([0], [2])] },
        { operand: 2, convex: true, inside: [], outside: [product([0], [1])] },
    ]
    assert.equal(estimateRasterWork(difference), 2 * (1 + 3 + 2 * 2) + 2 * 2 * (1 + 3 + 2 * 2))
    const repeated = Array.from({ length: 80 }, (_, operand) => ({
        operand,
        convex: true,
        inside: [product(Array.from({ length: 79 }, (_, id) => id < operand ? id : id + 1))],
        outside: [],
    }))
    assert.ok(estimateRasterWork(repeated) > CSG_INTERACTIVE_WORK_LIMIT)
})

test('nonconvex depth-layer budgets increase the estimated raster work', () => {
    const boundary: RasterBoundary = { operand: 7, convex: false, inside: [product([3])], outside: [] }
    assert.equal(estimateRasterWork([boundary], new Map([[7, 4]])), estimateRasterWork([boundary]) * 4)
})

test('Markdown host uses the same exact boundary work estimate as the GPU viewer', () => {
    const scene = {
        program: [{ op: 'leaf', operand: 0 }, { op: 'leaf', operand: 1 }, { op: 'difference', left: 0, right: 1 }],
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
