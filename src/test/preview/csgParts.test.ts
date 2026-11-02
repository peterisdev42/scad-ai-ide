import assert from 'node:assert/strict'
import test from 'node:test'
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial } from 'three'
import { readCsgPartHints } from '../../core/preview/csgParts'
import { csgVertexColors, hintAt } from '../../features/preview/webview/preview/managers/CsgPartColors'

const assembly = (explode: number) => `group() {
 color([1,0,0,1]) { cube(size=[1,1,1],center=false); }
 color([0,1,0,1]) { multmatrix([[1,0,0,${1 + explode * 10}],[0,1,0,0],[0,0,1,0],[0,0,0,1]]) { difference() { cube(size=[1,1,1],center=false); cylinder(h=2,r=0.1); } } }
}`

test('CSG identities and source colors survive explode transforms and difference cutters do not enlarge part bounds', () => {
    const assembled = readCsgPartHints(assembly(0)),
        exploded = readCsgPartHints(assembly(1))
    assert.equal(assembled.length, 2)
    assert.deepEqual(
        assembled.map((h) => [h.id, h.color]),
        exploded.map((h) => [h.id, h.color]),
    )
    assert.deepEqual(assembled[1].min, [1, 0, 0])
    assert.deepEqual(assembled[1].max, [2, 1, 1])
    assert.deepEqual(exploded[1].min, [11, 0, 0])
    assert.deepEqual(exploded[1].max, [12, 1, 1])
})

test('CSG assistance colors touching geometry by source scope rather than connected shells', () => {
    for (const explode of [0, 1]) {
        const x = 1 + explode * 10
        const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, x, 0, 0, x + 1, 0, 0, x, 1, 0], 3))
        const mesh = new Mesh(geometry, new MeshStandardMaterial())
        const fallback = new Float32BufferAttribute(new Float32Array(18).fill(0.5), 3)
        const colors = csgVertexColors(mesh, readCsgPartHints(assembly(explode)), fallback)!
        assert.deepEqual([...colors.array.slice(0, 3)], [1, 0, 0])
        assert.deepEqual([...colors.array.slice(9, 12)], [0, 1, 0])
    }
})

test('uncolored top-level CSG groups retain paths, and unsupported primitives fall back without inventing bounds', () => {
    assert.equal(readCsgPartHints('group(){union(){cube(size=2);sphere(r=1);}}').length, 2)
    assert.equal(readCsgPartHints('color([1,0,0,1]){import(file="model.stl");}').length, 0)
    assert.equal(readCsgPartHints('group(){difference(){cube(size=2);cube(size=1);}}').length, 1)
    assert.throws(() => readCsgPartHints('cube(size=process.exit());'))
    assert.throws(() => readCsgPartHints(' '.repeat(2 * 1024 * 1024 + 1)))
    assert.throws(() => readCsgPartHints('group(){'))
    assert.equal(readCsgPartHints('%color([1,0,0,1]){cube(size=1);}').length, 0)
    assert.equal(readCsgPartHints('color([1,0,0,1]){/* comment */cube(size=1);// ignored\n}').length, 1)
    assert.equal(readCsgPartHints('color([1,0,0,1]){import(file="a//b.stl");}').length, 0)
})

test('rotations, nested matrices and polyhedron points produce world-space conservative bounds', () => {
    const hints = readCsgPartHints('multmatrix([[0,-1,0,10],[1,0,0,20],[0,0,1,30],[0,0,0,1]]) { color([0,0,1,1]){polyhedron(points=[[0,0,0],[2,0,0],[0,3,4]],faces=[[0,1,2]]);} }')
    assert.deepEqual(hints[0].min, [7, 20, 30])
    assert.deepEqual(hints[0].max, [10, 22, 34])
    assert.equal(hintAt(hints, [8, 21, 32]), hints[0])
    assert.equal(hintAt(hints, [100, 21, 32]), undefined)
})

test('expired matching budgets return the original geometry-color fallback', () => {
    const mesh = new Mesh(new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)))
    const fallback = new Float32BufferAttribute(new Float32Array(9).fill(0.5), 3)
    assert.equal(csgVertexColors(mesh, readCsgPartHints(assembly(0)), fallback, -1), undefined)
    assert.deepEqual([...fallback.array], new Array(9).fill(0.5))
})
