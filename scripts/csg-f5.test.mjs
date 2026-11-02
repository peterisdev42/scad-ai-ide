import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { complexPolyhedron, libraryModel } from './csg-raster-benchmark.mjs'
import { startRasterFixture, compileRasterFixture } from './helpers/csg-raster-fixture.mjs'

const cli = process.env.SCAD_OPENSCAD_CSG_EXECUTABLE || process.env.SCAD_OPENSCAD_EXECUTABLE
let harness
before(async () => {
    if (cli) harness = await startRasterFixture()
})
after(async () => harness?.close())
const models = {
    transformedBackground: 'difference(){color([.2,.4,.8])translate([0,0,0])%cube(10,center=true);cube(30,center=true);}',
    highlightedBase: 'difference(){#cube(30,center=true);rotate([90,0,0])cylinder(h=40,r=5,center=true,$fn=32);}',
    complexPolyhedron: `difference(){${complexPolyhedron}cube([8,40,8],center=true);}`,
    mcadGear: libraryModel,
    throughHole: 'difference(){cube(30,center=true);rotate([90,0,0])cylinder(h=40,r=5,center=true,$fn=32);}',
    asymmetric: 'difference(){cube([30,20,30],center=true);translate([8,-8,8])cube([20,20,20],center=true);}',
    intersection: 'intersection(){cube(30,center=true);translate([9,0,5])sphere(18,$fn=24);}',
    twist: 'linear_extrude(20,twist=90,slices=8,center=true)translate([8,0])square([3,5],center=true);',
    nested: 'difference(){intersection(){cube(30,center=true);sphere(20,$fn=32);}difference(){sphere(17,$fn=24);cube([12,40,12],center=true);}}',
    nonconvex: 'difference(){render()difference(){cube(30,center=true);cube([10,40,10],center=true);}sphere(15,$fn=24);}',
}
for (const forceWebGL of [false, true])
    test(`official OpenCSG F5 reference at 1080p on ${forceWebGL ? 'WebGL2' : 'WebGPU'}`, { skip: !cli }, async (t) => {
        const page = await harness.browser.newPage()
        t.after(() => page.close())
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        page.on('console', (m) => {
            if (m.type() === 'error') errors.push(m.text())
        })
        await page.goto(harness.url)
        await page.waitForFunction(() => typeof window.compare === 'function')
        const results = []
        for (const [name, source] of Object.entries(models)) {
            const path = join(harness.directory, `${name}.png`),
                start = performance.now()
            execFileSync(cli, ['--preview=opencsg', '--imgsize=1920,1080', '--camera=0,-120,0,0,0,0', '--projection=p', '--colorscheme=Starnight', '-o', path, '-'], { input: source, stdio: ['pipe', 'ignore', 'pipe'] })
            const officialProcessMs = performance.now() - start,
                png = PNG.sync.read(await readFile(path))
            assert.ok(png.data[0] < 4 && png.data[1] < 4 && png.data[2] < 4, 'Reference background must be black.')
            const reference = Buffer.from(Array.from({ length: png.width * png.height }, (_, i) => Number(png.data[i * 4] > 10 || png.data[i * 4 + 1] > 10 || png.data[i * 4 + 2] > 10))).toString('base64')
            const csg = execFileSync(cli, ['--export-format', 'csg', '-D', '$preview=true', '-o', '-', '-'], { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
            const { data, topology } = await compileRasterFixture(csg, false)
            const result = await page.evaluate((q) => window.compare(q.data, q.topology, [], q.forceWebGL, q.options), { data, topology, forceWebGL, options: { perspective: true, fov: 22.5, position: [0, -120, 0], reference, capture: ['throughHole','highlightedBase'].includes(name) && !!process.env.SCAD_F5_REPORT } })
            if (result.captured) {
                const actual = new PNG({ width: 1920, height: 1080 }),
                    raw = Buffer.from(result.captured, 'base64')
                for (let y = 0; y < 1080; y++) raw.copy(actual.data, y * 1920 * 4, (forceWebGL ? 1079 - y : y) * 1920 * 4, (forceWebGL ? 1080 - y : y + 1) * 1920 * 4)
                await writeFile(`${process.env.SCAD_F5_REPORT}-${name}-${forceWebGL ? 'webgl2' : 'webgpu'}.png`, PNG.sync.write(actual))
                await writeFile(`${process.env.SCAD_F5_REPORT}-${name}-official.png`, PNG.sync.write(png))
                delete result.captured
            }
            results.push({ name, officialProcessMs, ...result })
            assert.equal(result.mismatches, 0, `${name}: ${JSON.stringify(result)}`)
        }
        assert.deepEqual(errors, [])
        if (process.env.SCAD_F5_REPORT) await writeFile(`${process.env.SCAD_F5_REPORT}-${forceWebGL ? 'webgl2' : 'webgpu'}.json`, JSON.stringify({ note: 'Official CLI --preview=opencsg screenshot path, not Qt IDE rotation latency. Excludes two-pixel silhouette edge band. Colors/lighting are not pixel-matched.', results }, null, 2) + '\n')
    })
