import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeMesh } from '../../core/mesh/decode'
import { triangleIntersection } from '../../core/mesh/math'
import { analyzeMesh } from '../../core/mesh/analyze'
import { box, stl, threeMf } from './fixtures'
const facts = (bytes: Uint8Array, format: 'stl' | '3mf' = 'stl') => analyzeMesh(decodeMesh(bytes, format))
test('raw binary/ASCII box has analytic bounds, area, signed and physical volume', async () => {
    for (const ascii of [false, true]) {
        const f = await facts(stl(box([2, 3, 4]), ascii))
        assert.equal(f.complete, true, JSON.stringify(f.findings))
        assert.deepEqual(f.bounds?.dimensions, [2, 3, 4])
        assert.equal(f.surfaceArea.value, 52)
        assert.equal(f.signedVolume.value, 24)
        assert.equal(f.physicalVolume.value, 24, JSON.stringify(f.findings))
        assert.equal(f.objects[0].status, 'PASS')
        assert.equal(f.units, 'modelUnits')
    }
})
test('inward winding stays negative and does not become a positive physical volume', async () => {
    const f = await facts(stl(box().map((t) => [t[0], t[2], t[1]])))
    assert.equal(f.signedVolume.value, -1)
    assert.equal(f.physicalVolume.value, null)
    assert.ok(f.findings.some((f) => f.code === 'MESH_INVERTED_WINDING'))
})
test('open, non-manifold, degenerate, duplicate and self-intersecting meshes preserve raw defects', async () => {
    for (const [mesh, code] of [
        [box().slice(1), 'MESH_BOUNDARY_EDGE'],
        [[...box(), box()[0]], 'MESH_NON_MANIFOLD_EDGE'],
        [
            [
                ...box(),
                [
                    [0, 0, 0],
                    [0, 0, 0],
                    [1, 0, 0],
                ],
            ],
            'MESH_DEGENERATE_FACE',
        ],
        [[...box(), ...box([1, 1, 1], [0.5, 0.5, 0.5])], 'MESH_SELF_INTERSECTION'],
    ] as const) {
        const f = await facts(stl(mesh as ReturnType<typeof box>))
        assert.ok(
            f.findings.some((f) => f.code === code),
            `${code}: ${JSON.stringify(f.findings)}`,
        )
        assert.equal(f.physicalVolume.value, null)
        assert.ok(
            f.findings.some((f) => f.triangleSamples?.length),
            JSON.stringify(f.findings),
        )
    }
})
test('proper cavity and disjoint components have material-aware volume', async () => {
    const cavity = await facts(stl([...box([3, 3, 3]), ...box([1, 1, 1], [1, 1, 1]).map((t) => [t[0], t[2], t[1]])]))
    assert.equal(cavity.physicalVolume.value, 26, JSON.stringify(cavity.findings))
    assert.equal(cavity.objects[0].components[1].depth, 1)
    const separate = await facts(stl([...box(), ...box([1, 1, 1], [3, 0, 0])]))
    assert.equal(separate.physicalVolume.value, 2, JSON.stringify(separate.findings))
})
test('pair budget and roundoff never produce a trusted physical volume', async () => {
    const f = await analyzeMesh(decodeMesh(stl(), 'stl'), { maxPairs: 0 })
    assert.equal(f.complete, false)
    assert.equal(f.physicalVolume.value, null)
    assert.ok(f.findings.some((f) => f.code === 'MESH_PAIR_BUDGET'))
    const far = await facts(stl(box([2, 3, 4], [1e9, 1e9, 1e9]), true))
    assert.equal(far.physicalVolume.value, 24, JSON.stringify(far.findings))
})
test('3MF root relationships, unit, components and reflected transforms retain physical orientation', async () => {
    const inch = await facts(threeMf({ unit: 'inch', components: true }), '3mf')
    assert.equal(inch.units, 'mm')
    assert.equal(inch.bounds?.dimensions[0], 25.4)
    assert.ok(Math.abs(inch.physicalVolume.value! - 25.4 ** 3) < 1e-8, JSON.stringify(inch.findings))
    const reflected = await facts(threeMf({ transform: '-1 0 0 0 1 0 0 0 1 5 0 0' }), '3mf')
    assert.equal(reflected.physicalVolume.value, 1, JSON.stringify(reflected.findings))
    assert.deepEqual(reflected.bounds?.min, [4, 0, 0])
})
test('malformed raw inputs, unsupported 3MF extension, singular transforms and non-finite data are controlled', async () => {
    assert.throws(() => decodeMesh(stl().subarray(0, 100), 'stl'))
    const invalid = stl()
    new DataView(invalid.buffer).setFloat32(96, NaN, true)
    assert.throws(() => decodeMesh(invalid, 'stl'), /finite/)
    assert.throws(() => decodeMesh(threeMf({ required: true }), '3mf'), /extension/)
    const singular = await facts(threeMf({ transform: '0 0 0 0 1 0 0 0 1 0 0 0' }), '3mf')
    assert.equal(singular.complete, false)
    assert.equal(singular.physicalVolume.value, null)
})

test('3MF disjoint/contained build items are measured once and overlaps stay unresolved', async () => {
    for (const [transform, expected] of [
        ['1 0 0 0 1 0 0 0 1 3 0 0', 2],
        ['.2 0 0 0 .2 0 0 0 .2 .2 .2 .2', 1],
    ] as const) {
        const f = await facts(threeMf({ extra: `<object id="2"><components><component objectid="1" transform="${transform}"/></components></object>`, build: '<item objectid="1"/><item objectid="2"/>' }), '3mf')
        assert.equal(f.physicalVolume.value, expected, JSON.stringify(f.findings))
    }
    const f = await facts(threeMf({ build: '<item objectid="1"/><item objectid="1" transform="1 0 0 0 1 0 0 0 1 .5 .5 .5"/>' }), '3mf')
    assert.equal(f.physicalVolume.value, null)
    assert.equal(f.complete, false)
    assert.ok(f.objects.every((o) => o.physicalVolume.value === 1))
    assert.ok(f.findings.some((f) => f.code === 'MESH_COMPOSITION_UNRESOLVED'))
})

test('decimal collapse is unresolved rather than epsilon-welded into a certified solid', async () => {
    const text = new TextDecoder().decode(stl(box(), true)).replace('vertex 1 0 0', 'vertex 1.00000000000000000001 0 0')
    const f = await facts(new TextEncoder().encode(text))
    assert.equal(f.complete, false)
    assert.equal(f.physicalVolume.value, null)
    assert.ok(f.findings.some((f) => f.code === 'NUMERIC_QUANTIZATION_COLLAPSE'))
})

test('pinched vertices, inconsistent orientation and near contact cannot certify a solid', async () => {
    const pinched = await facts(stl([...box(), ...box([1, 1, 1], [1, 1, 1])]))
    assert.ok(pinched.objects[0].nonManifoldVertices > 0)
    assert.equal(pinched.physicalVolume.value, null)
    const tris = box()
    tris[0] = [tris[0][0], tris[0][2], tris[0][1]]
    const flipped = await facts(stl(tris))
    assert.ok(flipped.objects[0].inconsistentEdges > 0)
    assert.equal(flipped.physicalVolume.value, null)
    const near = await facts(stl([...box(), ...box([1, 1, 1], [1 + 1e-10, 0, 0])], true))
    assert.equal(near.complete, false)
    assert.equal(near.physicalVolume.value, null)
})
test('predicates lock signs and classify shared simplices beyond simply skipping adjacent faces', async () => {
    const p = await import('robust-predicates')
    assert.equal(Math.sign(p.orient2d(0, 0, 1, 0, 0, 1)), -1)
    assert.equal(Math.sign(p.orient3d(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1)), -1)
    const a: import('../../core/mesh/types').Vec3[] = [
        [0, 0, 0],
        [2, 0, 0],
        [0, 2, 0],
    ]
    assert.equal(
        triangleIntersection(
            p,
            a,
            [
                [0, 0, 0],
                [2, 0, 0],
                [1, 1, 0],
            ],
            [
                [0, 0, 0],
                [2, 0, 0],
            ],
            1e-9,
        ),
        'cross',
    )
    assert.equal(
        triangleIntersection(
            p,
            a,
            [
                [2, 0, 0],
                [2, 2, 0],
                [0, 2, 0],
            ],
            [
                [2, 0, 0],
                [0, 2, 0],
            ],
            1e-9,
        ),
        'none',
    )
    assert.equal(
        triangleIntersection(
            p,
            a,
            [
                [0, 0, 0],
                [1, 0.2, -1],
                [1, 0.2, 1],
            ],
            [[0, 0, 0]],
            1e-9,
        ),
        'cross',
    )
    assert.equal(
        triangleIntersection(
            p,
            a,
            [
                [0.1, 0.1, 0],
                [1, 0.1, 0],
                [0.1, 1, 0],
            ],
            [],
            1e-9,
        ),
        'cross',
    )
})

test('3MF measurements bound referenced geometry while retaining unused source vertices', async () => {
    const { unzipSync, zipSync, strToU8, strFromU8 } = await import('fflate')
    const files = unzipSync(threeMf())
    files['Models/main.model'] = strToU8(strFromU8(files['Models/main.model']).replace('</vertices>', '<vertex x="100" y="100" z="100"/></vertices>'))
    const f = await facts(zipSync(files), '3mf')
    assert.deepEqual(f.bounds?.dimensions, [1, 1, 1])
    assert.equal(f.physicalVolume.value, 1)
    assert.equal(f.rawVertices, 37)
    assert.equal(f.objects[0].vertices, 9)
})
