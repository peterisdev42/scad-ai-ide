import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import type { ManifoldToplevel } from 'manifold-3d'
import { evaluateCsg } from '../../core/csg/evaluate.mjs'
import { evaluateProgram, traceCsg, queryAcceleration } from '../../core/csg/acceleration'
import { validateCsgScene } from '../../core/csg/validate'

let module: ManifoldToplevel
before(async () => {
    module = await (await import('manifold-3d')).default()
    module.setup()
})
const compile = (source: string) => evaluateCsg(source, module)

test('ordinary boolean compilation preserves the DAG and never calls whole-solid boolean kernels', () => {
    const originals = ['union', 'difference', 'intersection'].map((key) => [key, (module.Manifold as any)[key]] as const)
    for (const [key] of originals)
        (module.Manifold as any)[key] = () => {
            throw new Error('whole-solid boolean forbidden')
        }
    try {
        const scene = compile('difference(){cube(size=[20,20,20],center=true);sphere(r=5,$fn=16);}')
        assert.equal(scene.version, 3)
        assert.equal(scene.operands.length, 2)
        assert.equal(scene.program[scene.root].op, 'difference')
        assert.equal(evaluateProgram(scene.program, [1, 1], scene.root), false)
        assert.equal(evaluateProgram(scene.program, [1, 0], scene.root), true)
        validateCsgScene(scene)
    } finally {
        for (const [key, original] of originals) (module.Manifold as any)[key] = original
    }
})

test('boundary picking sweeps non-convex intervals, flips subtraction normals and handles internal views', () => {
    const scene = compile('difference(){cube(size=[20,20,20],center=true);cube(size=[8,30,8],center=true);}')
    assert.equal(traceCsg(scene, [0, -30, 0], [0, 1, 0]).length, 0)
    const side = traceCsg(scene, [7, -30, 0], [0, 1, 0])
    assert.deepEqual(
        side.map((h) => h.distance),
        [20, 40],
    )
    const cavity = traceCsg(scene, [0, 0, 0], [1, 0, 0])
    assert.equal(cavity[0].distance, 4)
    assert.deepEqual(
        cavity[0].normal.map((v) => v + 0),
        [-1, 0, 0],
    )
    const solid = traceCsg(scene, [7, 0, 0], [0, 1, 0])
    assert.equal(solid[0].distance, 10)
    assert.deepEqual(solid[0].normal, [0, 1, 0])
})

test('coincident operands cancel without phantom boundaries and disjoint union keeps every interval', () => {
    const empty = compile('difference(){cube(size=[2,2,2]);cube(size=[2,2,2]);}')
    assert.equal(traceCsg(empty, [1, -3, 1], [0, 1, 0]).length, 0)
    const union = compile('union(){cube(size=[2,2,2]);multmatrix([[1,0,0,0],[0,1,0,4],[0,0,1,0],[0,0,0,1]])cube(size=[2,2,2]);}')
    assert.deepEqual(
        traceCsg(union, [1, -3, 1], [0, 1, 0]).map((h) => h.distance),
        [3, 5, 7, 9],
    )
})

test('valid open faces remain surfaces and malformed transport cannot enter GPU traversal', () => {
    const scene = compile('polyhedron(points=[[0,0,0],[10,0,0],[0,10,0]],faces=[[0,2,1]]);')
    assert.equal(scene.operands[0].closed, false)
    assert.ok(scene.diagnostics.length)
    assert.equal(traceCsg(scene, [1, 1, 5], [0, 0, -1])[0].distance, 5)
    const broken = structuredClone(scene)
    broken.products[0].intersections[0] = 999
    assert.throws(() => validateCsgScene(broken), /Invalid CSG/)
    assert.throws(() => compile('future_geometry();'), /Unsupported/)
})

test('CPU picking BLAS is built lazily and shared across translated, mirrored and non-uniformly scaled instances', () => {
    const scene = compile('union(){cube(size=[2,2,2],center=true);multmatrix([[-2,0,0,5],[0,.5,0,0],[0,0,3,0],[0,0,0,1]])color([1,0,0])cube(size=[2,2,2],center=true);}')
    assert.equal(scene.meshes.length, 1)
    assert.equal(queryAcceleration(scene).blas.length, 1)
    assert.equal(scene.triangleCount, queryAcceleration(scene).blas[0].triangleCount * 2)
    const hits = traceCsg(scene, [5, -4, 0], [0, 1, 0])
    assert.deepEqual(
        hits.map((h) => h.distance),
        [3.5, 4.5],
    )
    assert.deepEqual(
        hits[0].normal.map((v) => v + 0),
        [0, -1, 0],
    )
    validateCsgScene(scene)
})

test('nested background flags are excluded before Difference operand selection', () => {
    const scene = compile('difference(){color([.2,.4,.8])multmatrix([[1,0,0,5],[0,1,0,0],[0,0,1,0],[0,0,0,1]])%cube(size=[10,10,10],center=true);cube(size=[30,30,30],center=true);}')
    assert.equal(scene.program[scene.root].op, 'leaf')
    assert.equal(scene.overlays[0].kind, 'background')
    assert.deepEqual(
        traceCsg(scene, [0, -60, 0], [0, 1, 0]).map((hit) => hit.distance),
        [45, 75],
    )
    validateCsgScene(scene)
})

test('highlighting a Difference base highlights its result, not the uncut operand', () => {
    const scene = compile('difference(){#cube(size=[30,30,30],center=true);cube(size=[10,40,10],center=true);}')
    assert.equal(scene.overlays.length, 1)
    assert.equal(scene.overlays[0].root, scene.root)
    assert.equal(scene.program[scene.overlays[0].root].op, 'difference')
    assert.deepEqual(traceCsg(scene, [0, -60, 0], [0, 1, 0]), [])
})

test('highlight Union debug drawing retains the complete physical root for topology and picking', () => {
    const scene = compile('union(){#cube(size=[10,10,10],center=true);multmatrix([[1,0,0,20],[0,1,0,0],[0,0,1,0],[0,0,0,1]])cube(size=[10,10,10],center=true);}')
    assert.equal(scene.program[scene.root].op, 'leaf')
    assert.equal(scene.program[scene.topologyRoot].op, 'union')
    assert.deepEqual(
        traceCsg(scene, [0, -30, 0], [0, 1, 0]).map((hit) => hit.distance),
        [25, 35],
    )
    validateCsgScene(scene)
})
