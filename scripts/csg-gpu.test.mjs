import { execFileSync } from 'node:child_process'
import { PNG } from 'pngjs'
import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, rm, readFile, copyFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { build } from 'esbuild'
import { chromium } from 'playwright'

let directory, server, browser, url
before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'scad-gpu-test-'))
    await build({ entryPoints: [resolve('src/core/csg/worker.mts')], outfile: join(directory, 'worker.mjs'), bundle: true, platform: 'node', format: 'esm', banner: { js: "import { createRequire as scadWorkerRequireFactory } from 'node:module'; const require = scadWorkerRequireFactory(import.meta.url);" }, logLevel: 'silent' })
    await copyFile(createRequire(import.meta.url).resolve('manifold-3d/manifold.wasm'), join(directory, 'manifold.wasm'))
    await build({
        stdin: {
            contents: `
        import { Scene, AmbientLight, DirectionalLight, PerspectiveCamera, OrthographicCamera, BoxGeometry, Mesh, MeshBasicMaterial, Plane, Color, RenderTarget, UnsignedByteType, Vector3 } from 'three';
        import { WebGPURenderer } from 'three/webgpu';
        import {vec4,vec3,select,float} from 'three/tsl';
        import { CsgModel } from './src/features/preview/webview/preview/csg/CsgModel';
        window.renderFixture = async (data, forceWebGL, mode='solid', planes=[], options={}) => {
            const renderer = new WebGPURenderer({forceWebGL, antialias:false});
            renderer.setSize(96,96); await renderer.init();
            document.body.append(renderer.domElement);
            const scene = new Scene(); scene.background = new Color(0,0,0); scene.add(new AmbientLight(0xffffff,0.8));const sun=new DirectionalLight(0xffffff,2);sun.position.set(0,-1,1);scene.add(sun);
            const camera = options.orthographic ? new OrthographicCamera(-25,25,25,-25,0.1,200) : new PerspectiveCamera(options.fov??45,1,0.1,200); camera.up.set(0,0,1); camera.position.fromArray(options.position??[0,-60,0]); camera.lookAt(new Vector3(...options.target??[0,0,0])); camera.updateMatrixWorld();
            const model = new CsgModel(data); scene.add(model.mesh);
            model.update(camera,new Color(0.8,0.8,0.8),false,mode,planes.map(p=>new Plane(new Vector3(...p.normal),p.constant)),renderer.coordinateSystem===2001);
            model.setLights([{position:new Vector3(0,-1,1), color:new Color(1,1,1),directional:true}],new Color(0.2,0.2,0.2));
            let occluder; if(options.occluder){occluder=new Mesh(new BoxGeometry(4,4,4),new MeshBasicMaterial({color:0x00ff00}));scene.add(occluder)}
            if(options.diagnostic)model.mesh.material.outputNode=vec4(select(model.outputs.source.equal(0),vec3(1,0,0),vec3(0,0,1)),1);
            if(options.diagnostic==='state'){model.mesh.material.depthNode=float(.5);model.mesh.material.colorNode=vec4(1);model.mesh.material.normalNode=vec3(0,0,1);model.mesh.material.outputNode=vec4(model.outputs.source.toFloat().add(1).div(2),model.outputs.position.y.div(60).add(.5),0,1)}
            const target = new RenderTarget(96,96,{type:UnsignedByteType}); renderer.setRenderTarget(target); renderer.render(scene,camera);
            const pixels = await renderer.readRenderTargetPixelsAsync(target,0,0,96,96);
            const result={pixels:Array.from(pixels),backend:renderer.coordinateSystem===2001?'webgpu':'webgl2'};
            model.dispose();if(occluder){occluder.geometry.dispose();occluder.material.dispose()}target.dispose();await renderer.dispose();renderer.domElement.remove();return result;
        };
    `,
            resolveDir: process.cwd(),
            sourcefile: 'gpu-fixture.ts',
            loader: 'ts',
        },
        outfile: join(directory, 'fixture.js'),
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
    })
    server = createServer(async (req, res) => {
        if (req.url === '/fixture.js') {
            res.setHeader('Content-Type', 'text/javascript')
            res.end(await readFile(join(directory, 'fixture.js')))
        } else res.end('<!doctype html><body><script type="module" src="/fixture.js"></script></body>')
    })
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    url = `http://127.0.0.1:${server.address().port}`
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu'], executablePath: process.env.SCAD_CHROMIUM_EXECUTABLE || undefined })
})
after(async () => {
    await browser?.close()
    if (server) await new Promise((done) => server.close(done))
    if (directory) await rm(directory, { recursive: true, force: true })
})

async function compile(source) {
    const worker = new Worker(join(directory, 'worker.mjs'))
    try {
        return await new Promise((resolve, reject) => {
            worker.once('error', reject)
            worker.once('message', (result) => (result.error ? reject(new Error(result.error)) : resolve(result.scene)))
            worker.postMessage(source)
        })
    } finally {
        await worker.terminate()
    }
}

for (const forceWebGL of [true, false])
    test(`CSG pixels preserve a through hole on ${forceWebGL ? 'WebGL2' : 'WebGPU'}`, async (t) => {
        const page = await browser.newPage()
        t.after(() => page.close())
        const errors = []
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text())
        })
        const data = await compile('difference(){cube(size=[30,30,30],center=true);cube(size=[10,40,10],center=true);}')
        await page.goto(url)
        await page.waitForFunction(() => typeof window.renderFixture === 'function')
        const result = await page.evaluate(async ({ data, forceWebGL }) => window.renderFixture(data, forceWebGL), { data, forceWebGL })
        assert.equal(result.backend, forceWebGL ? 'webgl2' : 'webgpu')
        assert.deepEqual(errors, [])
        const pixel = (x, y) => result.pixels.slice((y * 96 + x) * 4, (y * 96 + x) * 4 + 3)
        assert.ok(
            pixel(48, 48).every((c) => c < 10),
            `hole must show background: ${pixel(48, 48)}`,
        )
        assert.ok(
            pixel(28, 48).every((c) => c > 40),
            `solid must be visible: ${pixel(28, 48)}`,
        )
    })

async function render(page, data, forceWebGL, mode = 'solid', planes = [], options = {}) {
    return page.evaluate(async ({ data, forceWebGL, mode, planes, options }) => window.renderFixture(data, forceWebGL, mode, planes, options), { data, forceWebGL, mode, planes, options })
}
for (const forceWebGL of [true, false])
    test(`CSG result depth, clipped caps, internal views and X-ray intervals on ${forceWebGL ? 'WebGL2' : 'WebGPU'}`, async (t) => {
        const page = await browser.newPage()
        t.after(() => page.close())
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        page.on('console', (m) => {
            if (m.type() === 'error') errors.push(m.text())
        })
        await page.goto(url)
        await page.waitForFunction(() => typeof window.renderFixture === 'function')
        const pixel = (r, x = 48, y = 48) => r.pixels.slice((y * 96 + x) * 4, (y * 96 + x) * 4 + 3)
        const cube = await compile('cube(size=[30,30,30],center=true);')
        const cap = await render(page, cube, forceWebGL, 'solid', [{ normal: [0, 1, 0], constant: 0 }])
        assert.ok(
            pixel(cap).every((c) => c > 30),
            `clipped cap must be filled: ${pixel(cap)}`,
        )
        const inside = await render(page, cube, forceWebGL, 'solid', [], { position: [0, 0, 0], target: [0, 1, 0] })
        assert.ok(
            pixel(inside).some((c) => c > 30),
            `camera inside must see exit boundary: ${pixel(inside)}`,
        )
        const ortho = await render(page, cube, forceWebGL, 'solid', [], { orthographic: true })
        assert.ok(
            pixel(ortho).some((c) => c > 30),
            'orthographic surface must be visible',
        )
        const cavity = await compile('difference(){cube(size=[30,30,30],center=true);multmatrix([[1,0,0,0],[0,1,0,-10],[0,0,1,0],[0,0,0,1]])cube(size=[10,30,10],center=true);}')
        const depth = await render(page, cavity, forceWebGL, 'solid', [], { occluder: true })
        const color = pixel(depth)
        assert.ok(color[1] > 150 && color[0] < 20 && color[2] < 20, `mesh in front of cavity wall must remain visible: ${color}`)
        const overlap = await compile('union(){cube(size=[20,20,20],center=true);multmatrix([[1,0,0,0],[0,1,0,10],[0,0,1,0],[0,0,0,1]])cube(size=[20,20,20],center=true);}')
        const equivalent = await compile('multmatrix([[1,0,0,0],[0,1,0,5],[0,0,1,0],[0,0,0,1]])cube(size=[20,30,20],center=true);')
        const a = await render(page, overlap, forceWebGL, 'xray'),
            b = await render(page, equivalent, forceWebGL, 'xray')
        assert.ok(
            pixel(a).every((v, i) => Math.abs(v - pixel(b)[i]) <= 1),
            `overlap must count union thickness once: ${pixel(a)} vs ${pixel(b)}`,
        )
        assert.deepEqual(errors, [])
    })

for (const forceWebGL of [true, false])
    test(`shared BLAS materials, mirror transforms, thin walls and relocated depth on ${forceWebGL ? 'WebGL2' : 'WebGPU'}`, async (t) => {
        const page = await browser.newPage()
        t.after(() => page.close())
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        page.on('console', (m) => {
            if (m.type() === 'error') errors.push(m.text())
        })
        await page.goto(url)
        await page.waitForFunction(() => typeof window.renderFixture === 'function')
        const pixel = (r, x = 48, y = 48) => r.pixels.slice((y * 96 + x) * 4, (y * 96 + x) * 4 + 3)
        const instances = await compile('union(){multmatrix([[1,0,0,-9],[0,1,0,0],[0,0,1,0],[0,0,0,1]])color([1,0,0])cube(size=[12,12,12],center=true);multmatrix([[-1,0,0,9],[0,1.5,0,0],[0,0,.8,0],[0,0,0,1]])color([0,0,1])cube(size=[12,12,12],center=true);}')
        assert.equal(instances.blas.length, 1)
        const colors = await render(page, instances, forceWebGL)
        const red = pixel(colors, 30),
            blue = pixel(colors, 66)
        assert.ok(red[0] > red[2] + 60, `first instance must remain red: ${red}`)
        assert.ok(blue[2] > blue[0] + 60, `mirrored instance must remain blue: ${blue}`)
        const thin = await compile('cube(size=[20,.00001,20],center=true);')
        const wall = await render(page, thin, forceWebGL)
        assert.ok(
            pixel(wall).some((c) => c > 40),
            `thin wall must remain visible: ${pixel(wall)}`,
        )
        const moved = await compile('multmatrix([[1,0,0,1000000000],[0,1,0,0],[0,0,1,0],[0,0,0,1]])cube(size=[20,20,20],center=true);')
        const relocated = await render(page, moved, forceWebGL, 'solid', [], { position: [1000000000, -60, 0], target: [1000000000, 0, 0] })
        assert.ok(
            pixel(relocated).some((c) => c > 40),
            `model relocation must preserve depth: ${pixel(relocated)}`,
        )
        assert.deepEqual(errors, [])
    })

const nativeExecutable = process.env.SCAD_OPENSCAD_CSG_EXECUTABLE || process.env.SCAD_OPENSCAD_EXECUTABLE
const nativeCases = {
    throughHole: 'difference(){cube(30,center=true);rotate([90,0,0])cylinder(h=40,r=5,center=true,$fn=32);}',
    asymmetricDifference: 'difference(){cube([30,20,30],center=true);translate([8,-8,8])cube([20,20,20],center=true);}',
    intersection: 'intersection(){cube(30,center=true);translate([9,0,5])sphere(18,$fn=24);}',
    twist: 'linear_extrude(20,twist=90,slices=8,center=true)translate([8,0])square([3,5],center=true);',
}
for (const forceWebGL of [true, false])
    test(`fixed-camera native F5 silhouettes on ${forceWebGL ? 'WebGL2' : 'WebGPU'}`, { skip: !nativeExecutable }, async (t) => {
        const page = await browser.newPage()
        t.after(() => page.close())
        await page.goto(url)
        await page.waitForFunction(() => typeof window.renderFixture === 'function')
        for (const [name, source] of Object.entries(nativeCases)) {
            const path = join(directory, `${name}.png`)
            execFileSync(nativeExecutable, ['--imgsize=96,96', '--camera=0,-120,0,0,0,0', '--projection=p', '--colorscheme=Starnight', '-o', path, '-'], { input: source, stdio: ['pipe', 'ignore', 'pipe'] })
            const png = PNG.sync.read(await readFile(path))
            assert.ok(png.data[0] < 4 && png.data[1] < 4 && png.data[2] < 4, 'The native F5 reference must have a black background.')
            const csg = execFileSync(nativeExecutable, ['--export-format', 'csg', '-D', '$preview=true', '-o', '-', '-'], { input: source, stdio: ['pipe', 'pipe', 'pipe'] }).toString()
            const data = await compile(csg),
                gpu = await render(page, data, forceWebGL, 'solid', [], { position: [0, -120, 0], target: [0, 0, 0], fov: 22.5, diagnostic: true })
            const nativeMask = Array.from({ length: 96 * 96 }, (_, i) => png.data[i * 4] > 10 || png.data[i * 4 + 1] > 10 || png.data[i * 4 + 2] > 10)
            const gpuMask = Array.from({ length: 96 * 96 }, (_, i) => {
                const x = i % 96,
                    y = Math.floor(i / 96),
                    offset = ((forceWebGL ? 95 - y : y) * 96 + x) * 4
                return gpu.pixels[offset] > 10 || gpu.pixels[offset + 1] > 10 || gpu.pixels[offset + 2] > 10
            })
            let checked = 0,
                mismatches = 0
            const mismatchPositions = []
            for (let y = 2; y < 94; y++)
                for (let x = 2; x < 94; x++) {
                    const index = y * 96 + x,
                        value = nativeMask[index]
                    let edge = false
                    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (nativeMask[(y + dy) * 96 + x + dx] !== value) edge = true
                    if (!edge) {
                        checked++
                        if (value !== gpuMask[index]) {
                            mismatches++
                            mismatchPositions.push([x, y, value])
                        }
                    }
                }
            if (mismatches) {
                const state = await render(page, data, forceWebGL, 'solid', [], { position: [0, -120, 0], target: [0, 0, 0], fov: 22.5, diagnostic: 'state' })
                t.diagnostic(
                    JSON.stringify({
                        state: mismatchPositions.slice(0, 10).map(([x, y]) => {
                            const j = ((forceWebGL ? 95 - y : y) * 96 + x) * 4
                            return [x, y, state.pixels.slice(j, j + 4)]
                        }),
                    }),
                )
                await writeFile(`/private/tmp/f5-${name}-${forceWebGL ? 'gl' : 'gpu'}-native.png`, PNG.sync.write(png))
                const actual = new PNG({ width: 96, height: 96 })
                for (let y = 0; y < 96; y++)
                    for (let x = 0; x < 96; x++) {
                        const i = (y * 96 + x) * 4,
                            j = ((forceWebGL ? 95 - y : y) * 96 + x) * 4
                        for (let d = 0; d < 4; d++) actual.data[i + d] = gpu.pixels[j + d]
                    }
                await writeFile(`/private/tmp/f5-${name}-${forceWebGL ? 'gl' : 'gpu'}-actual.png`, PNG.sync.write(actual))
                t.diagnostic(JSON.stringify({ name, mismatchPositions }))
            }
            assert.ok(checked > 1000)
            assert.equal(mismatches, 0, `${name}: F5 silhouette mismatch away from rasterization edges (${mismatches}/${checked})`)
        }
    })
