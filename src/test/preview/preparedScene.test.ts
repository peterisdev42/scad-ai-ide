import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { Matrix4, Vector3 } from 'three'
import { readPreviewScene, validatePreparedScene, PREVIEW_LIMITS } from '../../core/preview/read'
import { tracePreview, evaluateProducts, queryAcceleration } from '../../core/preview/query'
import { validatePreviewScene } from '../../core/preview/validate'
const bytes = (name: string) => readFile(new URL(`./fixtures/prepared/${name}.csgp`, import.meta.url))
for (const name of ['cube', 'sphere', 'cylinder', 'union', 'difference', 'intersection', 'nested', 'transform', 'modifiers', 'polygon', 'grid', 'empty'])
    test(`real exporter v1 fixture: ${name}`, async () => {
        const scene = readPreviewScene(await bytes(name))
        validatePreviewScene(scene)
        assert.equal('program' in scene, false)
        assert.equal('root' in scene, false)
        assert.equal('topologyRoot' in scene, false)
        assert.ok(scene.timings.conversionMs >= 0)
        if (name === 'empty') assert.equal(scene.instances.length, 0)
        else assert.ok(scene.triangleCount > 0)
    })
test('schema, provenance, finite tuples, indices, transforms, terms and budgets are enforced', async () => {
    const original = JSON.parse((await bytes('cube')).toString())
    for (const mutate of [(s: any) => (s.schemaVersion = 2), (s: any) => (s.upstreamCommit = 'bad'), (s: any) => (s.matrixOrder = 'column-major'), (s: any) => (s.meshes[0].indices[0][0] = 99999), (s: any) => (s.meshes[0].positions[0][0] = Infinity), (s: any) => s.instances[0].matrix.fill(0), (s: any) => (s.instances[0].color = [2, 0, 0, 1]), (s: any) => (s.products[0].intersections[0].id = 99), (s: any) => (s.products[0].intersections[0].flags = 99), (s: any) => s.products[0].intersections.push(s.products[0].intersections[0])]) {
        const input = structuredClone(original)
        mutate(input)
        assert.throws(() => validatePreparedScene(input), /Invalid Preview Exporter/)
    }
    assert.throws(() => readPreviewScene(new Uint8Array(PREVIEW_LIMITS.bytes + 1)), /byte budget/)
    assert.throws(() => readPreviewScene(Buffer.from('{')))
})
test('difference picking sees the through-hole and wall; clipping produces correct caps', async () => {
    const s = readPreviewScene(await bytes('difference'))
    assert.equal(tracePreview(s, [0, 0, 100], [0, 0, -1]).length, 0)
    const hits = tracePreview(s, [8, 0, 100], [0, 0, -1])
    assert.deepEqual(
        hits.map((h) => h.distance),
        [90, 110],
    )
    const clipped = tracePreview(s, [8, 0, 100], [0, 0, -1], 'products', [{ normal: [0, 0, -1], constant: 0 }])
    assert.deepEqual(
        clipped.map((h) => h.distance),
        [100, 110],
    )
    assert.deepEqual(
        clipped[0].normal.map((x) => x || 0),
        [0, 0, 1],
    )
    assert.equal(queryAcceleration(s), queryAcceleration(s), 'picking resources cache by scene identity')
})
test('products truth table uses intersections AND NOT subtractions; union is OR', () => {
    const products = [
        {
            intersections: [
                { id: 0, flags: 0 },
                { id: 1, flags: 0 },
            ],
            subtractions: [{ id: 2, flags: 0 }],
        },
    ]
    for (let mask = 0; mask < 8; mask++) {
        const state = [mask & 1, (mask >> 1) & 1, (mask >> 2) & 1]
        assert.equal(evaluateProducts(products, state), !!state[0] && !!state[1] && !state[2])
    }
})
test('row-major translation, rotation, mirror and large-coordinate rebasing agree with Three', async () => {
    const raw = JSON.parse((await bytes('transform')).toString()),
        s = readPreviewScene(await bytes('transform')),
        i = s.instances[0],
        rawMatrix = new Matrix4().fromArray(raw.instances[0].matrix).transpose()
    const expected = new Vector3(...raw.meshes[0].positions[0]).applyMatrix4(rawMatrix)
    const rebased = new Vector3(...raw.meshes[0].positions[0])
        .applyMatrix4(rawMatrix)
        .sub(new Vector3(...s.origin))
        .applyMatrix4(new Matrix4().fromArray(i.inverse))
    assert.ok(expected.x > 999999980)
    assert.ok(rebased.length() < 20)
    assert.ok(s.origin[0] > 999999990)
    assert.equal(s.meshes.length, 1)
})
test('highlight and background keep distinct products and original flags', async () => {
    const s = readPreviewScene(await bytes('modifiers'))
    assert.ok(s.highlights.length)
    assert.ok(s.backgrounds.length)
    assert.equal(s.overlays.length, 2)
    assert.ok(s.instances.some((i) => !i.defaultColor && i.color[3] < 1))
})
