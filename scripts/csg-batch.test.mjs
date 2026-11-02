import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { overlapUnion, overlappingBoxes, negativeUnion, mixedDifference, nonconvexUnion } from './helpers/csg-batch-models.mjs'
import { startRasterFixture, compileRasterFixture } from './helpers/csg-raster-fixture.mjs'
let harness
before(async () => {
    harness = await startRasterFixture()
})
after(async () => harness?.close())
const cases = [
    ['192 overlapping convex union', overlapUnion],
    ['camera inside 192 overlapping union', overlappingBoxes(192), { perspective: true, position: [0, 0, 0], target: [0, 1, 0] }],
    ['257 convex operands across parity groups', overlappingBoxes(257, 'intersection')],
    ['negative-literal union', negativeUnion],
    ['mixed positive and negative conjunction', mixedDifference],
    ['mirrored nonuniform parity groups', `multmatrix([[-1.2,0,0,0],[0,.8,0,0],[0,0,1.1,0],[0,0,0,1]])${mixedDifference}`, { perspective: true, position: [30, -65, 25] }],
    ['nonconvex unions retain independent parity', nonconvexUnion],
    ['union of nested products shares opaque exterior depth', `union(){${mixedDifference}intersection(){cube(size=[20,40,20],center=true);sphere(r=19,$fn=24);}}`, { perspective: true, position: [30, -65, 25] }],
    ['filled subtraction shares exterior union depth', `union(){difference(){cube(size=[30,30,30],center=true);cube(size=[12,40,12],center=true);}cube(size=[12,30,12],center=true);}`, { perspective: true, position: [30, -65, 25] }],
    ['outside-to-inside union reselects cached classification', overlappingBoxes(12), { perspective: true, cameraPath: [{ position: [0, 0, 0], target: [0, 1, 0] }] }],
    ['near-clipped union retains whole-expression classification', overlappingBoxes(12), { perspective: true, position: [0, -16, 0], target: [0, 0, 0], near: 2 }],
]
for (const forceWebGL of [false, true])
    for (const [name, source, options = {}] of cases)
        test(`${name} stencil batch pixels on ${forceWebGL ? 'WebGL2' : 'WebGPU'}`, { timeout: 120000 }, async (t) => {
            const page = await harness.browser.newPage()
            t.after(() => page.close())
            const errors = []
            page.on('pageerror', (error) => errors.push(error.message))
            page.on('console', (message) => {
                if (message.type() === 'error') errors.push(message.text())
            })
            await page.goto(harness.url)
            await page.waitForFunction(() => typeof window.compare === 'function')
            const { data, topology } = await compileRasterFixture(source)
            const result = await page.evaluate((q) => window.compare(q.data, q.topology, [], q.forceWebGL, q.options), {
                data,
                topology,
                forceWebGL,
                options: { width: Number(process.env.SCAD_GPU_WIDTH || 1920), height: Number(process.env.SCAD_GPU_HEIGHT || 1080), ...options },
            })
            assert.deepEqual(errors, [])
            assert.equal(result.backend, forceWebGL ? 'webgl2' : 'webgpu')
            assert.ok(result.visible > 10000, JSON.stringify(result))
            assert.equal(result.mismatches, 0, JSON.stringify(result))
            assert.equal(result.depthMismatches, 0, JSON.stringify(result))
        })
