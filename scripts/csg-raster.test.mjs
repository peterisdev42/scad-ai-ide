import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { complexPolyhedron } from './csg-raster-benchmark.mjs'
import { startRasterFixture, compileRasterFixture as fixture } from './helpers/csg-raster-fixture.mjs'
const width = Number(process.env.SCAD_GPU_WIDTH || 1920),
    height = Number(process.env.SCAD_GPU_HEIGHT || 1080)
let harness, browser, url
before(async () => {
    harness = await startRasterFixture()
    ;({ browser, url } = harness)
})
after(async () => harness?.close())

const box = 'cube(size=[30,30,30],center=true);',
    hole = 'cube(size=[10,40,10],center=true);',
    sphere = 'sphere(r=20,$fn=32);'
const cases = [
    [
        'union',
        `union(){${box}${sphere}}`,
        [
            { intersections: [0], subtractions: [] },
            { intersections: [1], subtractions: [] },
        ],
    ],
    ['intersection', `intersection(){${box}${sphere}}`, [{ intersections: [0, 1], subtractions: [] }]],
    ['difference', `difference(){${box}${hole}}`, [{ intersections: [0], subtractions: [1] }]],
    ['three operand difference', `difference(){${box}${hole}cube(size=[40,10,10],center=true);}`, [{ intersections: [0], subtractions: [1, 2] }]],
    ['three operand intersection', `intersection(){${box}${sphere}cube(size=[20,40,20],center=true);}`, [{ intersections: [0, 1, 2], subtractions: [] }]],
]
cases.push(['nine cylinder holes', `difference(){cube(size=[40,40,12],center=true);${[-12, 0, 12].flatMap((x) => [-12, 0, 12].map((y) => `multmatrix([[1,0,0,${x}],[0,1,0,${y}],[0,0,1,0],[0,0,0,1]])cylinder(h=20,r=3,center=true,$fn=24);`)).join('')}}`, [], { position: [38, -58, 45], perspective: true }], ['complex concave polyhedron', `difference(){${complexPolyhedron}cube(size=[8,40,8],center=true);}`, [], { position: [30, -65, 25], perspective: true }], ['nested differences', `difference(){intersection(){${box}${sphere}}difference(){sphere(r=17,$fn=24);cube(size=[12,40,12],center=true);}}`, []], ['nonconvex operand', `difference(){render()difference(){${box}${hole}}sphere(r=15,$fn=24);}`, []], ['extrude operand', 'difference(){linear_extrude(height=20,center=true,twist=60,slices=12,scale=[1,1])polygon(points=[[-15,-10],[15,-10],[15,10],[0,3],[-15,10]]);cylinder(h=40,r=4,center=true,$fn=24);}', [], { position: [35, -60, 35], perspective: true }], ['mirrored nonuniform scale', `difference(){multmatrix([[-1.3,0,0,0],[0,.8,0,0],[0,0,1.2,0],[0,0,0,1]])${box}${sphere}}`, [], { position: [35, -60, 35], perspective: true }], ['camera inside', box, [], { position: [0, 0, 0], target: [0, 1, 0], perspective: true }], ['camera inside union', `union(){${box}${sphere}}`, [], { position: [0, 0, 0], target: [0, 1, 0], perspective: true }], ['perspective cavity', `difference(){${box}multmatrix([[1,0,0,0],[0,1,0,-10],[0,0,1,0],[0,0,0,1]])cube(size=[10,30,10],center=true);}`, [], { position: [20, -60, 20], perspective: true }], ['coincident empty difference', `difference(){${box}${box}}`, []], ['touching union inside', `union(){${box}multmatrix([[1,0,0,0],[0,1,0,30],[0,0,1,0],[0,0,0,1]])${box}}`, [], { position: [0, 0, 0], target: [0, 1, 0], perspective: true }], ['large coordinates', `multmatrix([[1,0,0,1000000000],[0,1,0,0],[0,0,1,0],[0,0,0,1]])${box}`, [], { position: [1e9, -60, 0], target: [1e9, 0, 0] }], ['depth occlusion', `difference(){${box}multmatrix([[1,0,0,0],[0,1,0,-10],[0,0,1,0],[0,0,0,1]])cube(size=[10,30,10],center=true);}`, [], { occluder: true }], ['thin wall', 'cube(size=[20,.00001,20],center=true);', []])
for (const forceWebGL of [false, true])
    for (const [name, source, products, options = {}] of cases)
        test(`${name} raster pixels on ${forceWebGL ? 'WebGL2' : 'WebGPU'} at ${width}x${height}`, async (t) => {
            const page = await browser.newPage()
            t.after(() => page.close())
            const errors = []
            page.on('pageerror', (e) => errors.push(e.message))
            page.on('console', (m) => {
                if (m.type() === 'error') errors.push(m.text())
            })
            const { data, topology } = await fixture(source)
            await page.goto(url)
            await page.waitForFunction(() => typeof window.compare === 'function')
            const result = await page.evaluate((q) => window.compare(q.data, q.topology, q.products, q.forceWebGL, q.options), { data, topology, products, forceWebGL, options: { width, height, ...options } })
            assert.deepEqual(errors, [])
            assert.equal(result.backend, forceWebGL ? 'webgl2' : 'webgpu')
            if (!name.includes('empty')) assert.ok(result.visible > 10000, JSON.stringify(result))
            assert.equal(result.mismatches, 0, JSON.stringify(result))
            assert.equal(result.depthMismatches, 0, JSON.stringify(result))
        })

for (const forceWebGL of [false, true])
    test(`source color, Highlight and Background on ${forceWebGL ? 'WebGL2' : 'WebGPU'}`, async (t) => {
        const page = await browser.newPage()
        t.after(() => page.close())
        await page.goto(url)
        await page.waitForFunction(() => typeof window.compare === 'function')
        const { data, topology } = await fixture('union(){multmatrix([[1,0,0,-16],[0,1,0,0],[0,0,1,0],[0,0,0,1]])color([1,0,0])cube(size=[12,12,12],center=true);multmatrix([[1,0,0,16],[0,1,0,0],[0,0,1,0],[0,0,0,1]])color([0,0,1])cube(size=[12,12,12],center=true);}')
        const result = await page.evaluate(
            (q) =>
                window.compare(q.data, q.topology, [], q.forceWebGL, {
                    width: q.width,
                    height: q.height,
                    samples: [
                        [Math.round((690 * q.width) / 1920), q.height / 2],
                        [Math.round((1230 * q.width) / 1920), q.height / 2],
                    ],
                }),
            { data, topology, forceWebGL, width, height },
        )
        assert.ok(result.samples[0][0] > result.samples[0][2] + 40, JSON.stringify(result.samples))
        assert.ok(result.samples[1][2] > result.samples[1][0] + 40, JSON.stringify(result.samples))
        const overlay = await fixture('cube(size=[8,8,8],center=true);#multmatrix([[1,0,0,-16],[0,1,0,0],[0,0,1,0],[0,0,0,1]])cube(size=[12,12,12],center=true);%multmatrix([[1,0,0,16],[0,1,0,0],[0,0,1,0],[0,0,0,1]])cube(size=[12,12,12],center=true);')
        const highlighted = await page.evaluate(
            (q) =>
                window.compare(q.data, q.topology, [], q.forceWebGL, {
                    width: q.width,
                    height: q.height,
                    samples: [
                        [Math.round((690 * q.width) / 1920), q.height / 2],
                        [Math.round((1230 * q.width) / 1920), q.height / 2],
                        [q.width / 2, q.height / 2],
                    ],
                }),
            { ...overlay, forceWebGL, width, height },
        )
        assert.ok(highlighted.samples[0][0] > highlighted.samples[0][1] + 20, JSON.stringify(highlighted.samples))
        assert.ok(highlighted.samples[1][0] > 10, JSON.stringify(highlighted.samples))
        assert.ok(Math.abs(highlighted.samples[1][0] - highlighted.samples[1][1]) < 3, JSON.stringify(highlighted.samples))
    })

for (const forceWebGL of [false, true])
    test(`nonconvex layer overflow reports a controlled error on ${forceWebGL ? 'WebGL2' : 'WebGPU'}`, async (t) => {
        const page = await browser.newPage()
        t.after(() => page.close())
        await page.goto(url)
        await page.waitForFunction(() => typeof window.compare === 'function')
        const stack = Array.from({ length: 65 }, (_, i) => `multmatrix([[1,0,0,0],[0,1,0,${i * 3}],[0,0,1,0],[0,0,0,1]])cube(size=[10,1,10],center=true);`).join('')
        const { data, topology } = await fixture(`difference(){render()union(){${stack}}cube(size=[1,500,1],center=true);}`, false)
        await assert.rejects(
            page.evaluate((q) => window.compare(q.data, q.topology, [], q.forceWebGL), { data, topology, forceWebGL }),
            /depth complexity exceeds 64/,
        )
    })

for (const forceWebGL of [false, true])
    test(`subtraction wall normals face out of the result on ${forceWebGL ? 'WebGL2' : 'WebGPU'}`, async (t) => {
        const page = await browser.newPage()
        t.after(() => page.close())
        await page.goto(url)
        await page.waitForFunction(() => typeof window.compare === 'function')
        const { data, topology } = await fixture(`difference(){${box}multmatrix([[1,0,0,0],[0,1,0,-10],[0,0,1,0],[0,0,0,1]])cube(size=[10,30,10],center=true);}`)
        const result = await page.evaluate((q) => window.compare(q.data, q.topology, [], q.forceWebGL, { width: q.width, height: q.height, directionalTest: true, samples: [[q.width / 2, q.height / 2]] }), { data, topology, forceWebGL, width, height })
        assert.ok(
            result.samples[0].slice(0, 3).every((c) => c > 180),
            `The cavity's subtraction back face must receive the front directional light: ${JSON.stringify(result.samples)}`,
        )
    })
