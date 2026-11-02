import { previewFixture } from './helpers/prepared-preview-fixture.mjs'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cpus } from 'node:os'
const executable = process.env.SCAD_PREVIEW_EXPORTER
if (!executable) throw new Error('Set SCAD_PREVIEW_EXPORTER to the validated bin/openscad-preview-exporter wrapper.')
const fixture = await previewFixture(),
    samples = [],
    navigation = []
const cases = { simple: 'cube(20,center=true);', complex: 'difference(){intersection(){cube(30,center=true);sphere(20,$fn=48);}for(x=[-8,0,8])translate([x,0,0])cylinder(h=40,r=2,center=true,$fn=24);}', instances: 'for(x=[0:7],y=[0:7])translate([x*15,y*15,0])cube(10);', hole: 'difference(){cube(30,center=true);cylinder(h=40,r=5,center=true,$fn=32);}', grid: 'for(x=[0:3],y=[0:3])translate([x*15,y*15,0])difference(){cube(12);cylinder(h=15,r=3,$fn=16);}' }
cases.holes25 = await readFile('src/test/preview/fixtures/prepared/complex.scad', 'utf8')
try {
    for (const forceWebGL of [false, true]) {
        const page = await fixture.browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
        page.on('console', (m) => {
            if (m.type() === 'error') console.error(m.text())
        })
        await page.goto(fixture.url)
        await page.waitForFunction(() => typeof window.setup === 'function')
        await page.evaluate((force) => window.setup(force), forceWebGL)
        let version = 0
        for (const [name, source] of Object.entries(cases))
            for (const update of [false, true]) {
                const started = performance.now(),
                    file = join(fixture.directory, 'model.csgp'),
                    exportStarted = performance.now()
                execFileSync(executable, ['--export-format=preview-scene', '-D', '$preview=true', '-D', `$t=${update ? 1 : 0}`, '-o', file, '-'], { input: 'scale(1+$t*.01){' + source + '}', stdio: ['pipe', 'ignore', 'pipe'] })
                const exporterMs = performance.now() - exportStarted,
                    readStarted = performance.now(),
                    bytes = await readFile(file),
                    readMs = performance.now() - readStarted,
                    scene = fixture.readPreviewScene(bytes)
                const data = Buffer.from(JSON.stringify(scene)).toString('base64'),
                    viewport = await page.evaluate(({ data, version }) => window.draw('csgp', data, version), { data, version: ++version })
                samples.push({ ...scene.timings, readMs, name, update, width: 800, height: 600, shadows: false, exporterMs, readParseMs: readMs + scene.timings.readParseMs, conversionMs: scene.timings.conversionMs, ...viewport, totalMs: performance.now() - started, bytes: bytes.length, meshes: scene.meshes.length, instances: scene.instances.length, triangles: scene.triangleCount })
                if (name === 'complex' && !update && process.argv[2]) await page.screenshot({ path: process.argv[2].replace(/\.json$/, `-${viewport.backend}.png`) })
                if (!update && ['simple', 'complex', 'instances', 'holes25'].includes(name)) {
                    const navigate = async (format) =>
                        page.evaluate(async (format) => {
                            const intervals = [],
                                submissions = [],
                                stage = window.stage,
                                controls = stage.activeCameraRig.getControls(),
                                camera = stage.activeCameraRig.activeCamera
                            const original = stage.drawFrame.bind(stage),
                                oldQuery = stage.modelRepresentation.queryTopology
                            let queries = 0,
                                previous
                            stage.modelRepresentation.queryTopology = async (...args) => {
                                queries++
                                return oldQuery.apply(stage.modelRepresentation, args)
                            }
                            stage.drawFrame = () => {
                                const start = performance.now()
                                original()
                                submissions.push(performance.now() - start)
                            }
                            for (let frame = 0; frame < 130; frame++)
                                await new Promise((resolve) =>
                                    requestAnimationFrame((now) => {
                                        if (frame >= 10 && previous !== undefined) intervals.push(now - previous)
                                        previous = now
                                        camera.position.sub(controls.target).applyAxisAngle(camera.up, 0.008).add(controls.target)
                                        camera.lookAt(controls.target)
                                        resolve()
                                    }),
                                )
                            stage.drawFrame = original
                            stage.modelRepresentation.queryTopology = oldQuery
                            const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]
                            return { format, frames: intervals.length, medianFrameMs: percentile(intervals, 0.5), p95FrameMs: percentile(intervals, 0.95), medianSubmissionMs: percentile(submissions, 0.5), p95SubmissionMs: percentile(submissions, 0.95), geometryQueries: queries }
                        }, format)
                    navigation.push({ name, backend: viewport.backend, ...(await navigate('csgp')) })
                    const stlFile = join(fixture.directory, 'comparison.stl')
                    execFileSync(executable, ['--export-format=binstl', '-o', stlFile, '-'], { input: source, stdio: ['pipe', 'ignore', 'pipe'] })
                    const stl = (await readFile(stlFile)).toString('base64')
                    await page.evaluate(({ data, version }) => window.draw('stl', data, version), { data: stl, version: ++version })
                    navigation.push({ name, backend: viewport.backend, ...(await navigate('stl')) })
                }
                console.error(name, viewport.backend, Math.round(samples.at(-1).totalMs) + 'ms')
            }
        await page.evaluate(() => stage.dispose())
        await page.close()
    }
    const result = JSON.stringify({ cpu: cpus()[0].model, browser: fixture.browser.version(), samples, navigation }, null, 2) + '\n'
    if (process.argv[2]) await writeFile(process.argv[2], result)
    else process.stdout.write(result)
} finally {
    await fixture.close()
}
