import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { Box3, Raycaster, Vector3 } from 'three'
import { readPreviewScene } from '../../core/preview/read'
import { validatePreviewScene } from '../../core/preview/validate'
import { GoldfeatherRenderer } from '../../features/preview/webview/preview/csg/GoldfeatherRenderer'
import { PREVIEW_PHASES, validPreviewTimings } from '../../core/preview/performance'
const scene = async (name: string) => readPreviewScene(await readFile(new URL(`./fixtures/prepared/${name}.csgp`, import.meta.url)))

test('image renderer shares exporter meshes and disposes every shared resource exactly once', async () => {
    const model = new GoldfeatherRenderer(await scene('complex'))
    assert.equal(model.root.children.length, 28)
    const geometries = new Set(model.root.children.map((m) => (m as import('three').Mesh).geometry))
    assert.ok(geometries.size < model.root.children.length)
    let disposed = 0
    for (const geometry of geometries) geometry.addEventListener('dispose', () => disposed++)
    assert.ok(!new Box3().setFromObject(model.root).isEmpty())
    model.dispose()
    model.dispose()
    assert.equal(disposed, geometries.size)
})

test('CPU picking follows Products and editor transforms, without final topology generation', async () => {
    const model = new GoldfeatherRenderer(await scene('difference'))
    assert.equal(model.pick(new Raycaster(new Vector3(0, 0, 40), new Vector3(0, 0, -1))).length, 0, 'hole cannot pick an operand surface')
    model.root.position.x += 10
    model.root.scale.x = 2
    const hit = model.pick(new Raycaster(new Vector3(40, 0, 0), new Vector3(-1, 0, 0)))[0]
    assert.equal(hit.point.x, 30)
    assert.equal(hit.distance, 10)
    assert.equal(hit.object.userData.csg, true)
    model.dispose()
})

test('prepared scene validation rejects invalid convexity and untrusted provenance before GPU allocation', async () => {
    const s = await scene('cube')
    validatePreviewScene(s)
    s.instances[0].convexity = 0
    assert.throws(() => validatePreviewScene(s), /metadata/)
    s.instances[0].convexity = 1
    s.provenance.source = 'unknown'
    assert.throws(() => validatePreviewScene(s), /provenance/)
})

test('phase timing validation keeps measured zero/fractions, rejects nonfinite and unknown values', () => {
    assert.deepEqual(validPreviewTimings({ jsonParseMs: 0.125, exporterMs: 0, booleanPasses: 24, gpuCompleteMs: NaN, decodeMs: -1, shaderMs: Infinity, unknown: 1 } as never), { jsonParseMs: 0.125, exporterMs: 0, booleanPasses: 24 })
    assert.match(PREVIEW_PHASES.booleanSubmitMs.label, /CPU/)
    assert.match(PREVIEW_PHASES.gpuCompleteMs.label, /wait/)
    assert.match(PREVIEW_PHASES.transferSchedulingMs.label, /estimate/)
})
