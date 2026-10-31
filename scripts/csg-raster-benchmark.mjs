import { build } from 'esbuild'
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir, cpus } from 'node:os'
import { join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'

// Use exactly this harness before and after the replacement. Frames include the
// renderer's completion fence and two presentation opportunities on the canvas.
const starPoints = Array.from({ length: 40 }, (_, i) => {
    const a = ((i % 20) * Math.PI) / 10,
        r = i % 2 ? 10 : 18
    return [r * Math.cos(a), r * Math.sin(a), i < 20 ? -8 : 8]
})
const starFaces = [Array.from({ length: 20 }, (_, i) => i), Array.from({ length: 20 }, (_, i) => 39 - i), ...Array.from({ length: 20 }, (_, i) => [i, i + 20, ((i + 1) % 20) + 20, (i + 1) % 20])]
export const complexPolyhedron = `polyhedron(points=${JSON.stringify(starPoints)},faces=${JSON.stringify(starFaces)},convexity=10);`
export const libraryModel = 'use <MCAD/involute_gears.scad>;rotate([50,0,25])translate([0,0,-4])gear(number_of_teeth=12,circular_pitch=8,gear_thickness=6,rim_thickness=6,hub_thickness=8,bore_diameter=4,circles=4,$fn=24);'
export const cases = {
    sphereDifference: 'difference(){cube(30,center=true);sphere(20,$fn=32);}',
    nested: 'difference(){intersection(){cube(30,center=true);sphere(20,$fn=32);}difference(){sphere(17,$fn=24);cube([12,40,12],center=true);}}',
    holes: 'difference(){cube([40,40,12],center=true);for(x=[-12,0,12],y=[-12,0,12])translate([x,y,0])cylinder(h=20,r=3,center=true,$fn=24);}',
    repeated: 'for(x=[0:19],y=[0:9])translate([x*6,y*6,0])cube(4);',
    nonconvex: 'difference(){render()difference(){cube(30,center=true);cube([10,40,10],center=true);}sphere(15,$fn=24);}',
    extrude: 'difference(){linear_extrude(20,twist=60,slices=12,center=true)polygon([[-15,-10],[15,-10],[15,10],[0,3],[-15,10]]);cylinder(h=40,r=4,center=true,$fn=24);}',
    polyhedron: 'difference(){polyhedron(points=[[-15,-15,0],[15,-15,0],[15,15,0],[-15,15,0],[0,0,25]],faces=[[3,2,1,0],[0,1,4],[1,2,4],[2,3,4],[3,0,4]],convexity=2);translate([0,0,10])sphere(10,$fn=24);}',
    complexPolyhedron: `difference(){${complexPolyhedron}cube([8,40,8],center=true);}`,
    mcadGear: libraryModel,
    // Official examples use instantiated modules and ordinary geometry barriers.
    roundedEnclosure: '$fn=24;module rounded(s,r){hull()for(x=[-1,1],y=[-1,1])translate([x*(s[0]/2-r),y*(s[1]/2-r),0])cylinder(h=s[2],r=r,center=true);}difference(){rounded([60,40,20],4);translate([0,0,2])rounded([56,36,20],2);for(x=[-20,20])translate([x,0,0])cylinder(h=40,r=3,center=true);}',
}

if (process.argv[1] === resolve('scripts/csg-raster-benchmark.mjs')) {
    const cli = process.env.SCAD_OPENSCAD_CSG_EXECUTABLE
    if (!cli) throw new Error('Set SCAD_OPENSCAD_CSG_EXECUTABLE.')
    const width = Number(process.env.SCAD_BENCH_WIDTH || 1920),
        height = Number(process.env.SCAD_BENCH_HEIGHT || 1080)
    const frames = Number(process.env.SCAD_BENCH_FRAMES || 20)
    const sourceRoot = resolve(process.env.SCAD_BENCH_SOURCE_ROOT || 'src'),
        workerPath = resolve(process.env.SCAD_BENCH_WORKER || 'dist/csg-worker.mjs')
    const directory = await mkdtemp(join(tmpdir(), 'scad-raster-bench-'))
    let server, browser
    const results = { implementation: process.env.SCAD_BENCH_LABEL || 'raster', width, height, frames, cpu: cpus()[0].model, samples: [] }
    try {
        await build({
            stdin: {
                contents: `
            import { Scene,Group,PerspectiveCamera,Color,Vector3,AmbientLight,RenderTarget } from 'three';
            import {WebGPURenderer,MeshBasicNodeMaterial,QuadMesh} from 'three/webgpu';
            import {texture} from 'three/tsl';
            import {CsgModel} from ${JSON.stringify(join(sourceRoot, 'features/preview/webview/preview/csg/CsgModel.ts'))};
            import {ModelRepresentation} from ${JSON.stringify(join(sourceRoot, 'features/preview/webview/preview/models/ModelRepresentation.ts'))};
            import {CsgFramePass} from ${JSON.stringify(join(sourceRoot, 'features/preview/webview/preview/passes/CsgFramePass.ts'))};
            window.measure=async(data,updateData,forceWebGL,width,height,count)=>{
                const initialization=performance.now(),renderer=new WebGPURenderer({forceWebGL,antialias:false,stencil:true});
                renderer.setSize(width,height);await renderer.init();document.body.append(renderer.domElement);
                const initializationMs=performance.now()-initialization,started=performance.now(),model=new CsgModel(data),group=new Group(),scene=new Scene();
                group.add(model.mesh);scene.add(group,new AmbientLight(0xffffff,1));scene.background=new Color(0,0,0);
                const center=new Vector3(...data.origin),size=new Vector3(...data.bounds.max).sub(new Vector3(...data.bounds.min)),diagonal=size.length();
                const camera=new PerspectiveCamera(45,width/height,diagonal*.001,diagonal*20);camera.up.set(0,0,1);
                camera.position.copy(center).add(new Vector3(-1,-1,1).normalize().multiplyScalar(diagonal*1.8));camera.lookAt(center);camera.updateMatrixWorld();
                const representation=new ModelRepresentation(group,[model],1),pass=new CsgFramePass(),target=new RenderTarget(width,height,{stencilBuffer:true}),presentMaterial=new MeshBasicNodeMaterial({depthTest:false,depthWrite:false});presentMaterial.fragmentNode=texture(target.texture);const quad=new QuadMesh(presentMaterial);
                model.update(camera,new Color(.8,.8,.8),false,'solid',[],!forceWebGL,false);model.setLights([],new Color(1,1,1));
                const {value:prepared}=await representation.prepare(renderer,camera,scene);
                const draw=async(current=representation)=>{renderer.setRenderTarget(target);await pass.render(renderer,scene,camera,view=>current.render(renderer,scene,view),()=>true);await renderer.readRenderTargetPixelsAsync(target,Math.floor(width/2),Math.floor(height/2),1,1);renderer.setRenderTarget(null);quad.render(renderer);};
                await draw();const firstFrameMs=performance.now()-started;
                const presentation=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
                await presentation();const firstPresentedMs=performance.now()-started,times=[];
                const orbit=camera.position.clone().sub(center),axis=new Vector3(0,0,1);
                for(let i=0;i<count;i++){camera.position.copy(center).add(orbit.clone().applyAxisAngle(axis,(i+1)*.015));camera.lookAt(center);camera.updateMatrixWorld();const t=performance.now();await draw();times.push(performance.now()-t);}
                times.sort((a,b)=>a-b);const percentile=p=>{const at=(times.length-1)*p,low=Math.floor(at);return times[low]+(times[Math.ceil(at)]-times[low])*(at-low)};const info={...prepared,initializationMs,firstFrameMs,firstPresentedMs,p50Ms:percentile(.5),p95Ms:percentile(.95),framesMs:times,memory:structuredClone(renderer.info.memory),backend:renderer.coordinateSystem===2001?'webgpu':'webgl2'};
                const updateStarted=performance.now();let updated=representation;
                if(!representation.update(updateData,2)){const next=new CsgModel(updateData);group.clear();group.add(next.mesh);updated=new ModelRepresentation(group,[next],2);next.update(camera,new Color(.8,.8,.8),false,'solid',[],!forceWebGL,false);next.setLights([],new Color(1,1,1));await updated.prepare(renderer,camera,scene);}
                await draw(updated);info.updateGpuMs=performance.now()-updateStarted;await presentation();info.updatePresentedMs=performance.now()-updateStarted;
                const context=renderer.backend.getContext?.();info.gpu=context?.getExtension?context.getParameter(context.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL??context.RENDERER):null;
                if(!forceWebGL){const adapter=await navigator.gpu?.requestAdapter();if(adapter?.info)info.adapter={vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description};}
                pass.dispose();if(updated!==representation)updated.dispose();representation.dispose();target.dispose();presentMaterial.dispose();await renderer.dispose();renderer.domElement.remove();return info;
            };`,
                resolveDir: process.cwd(),
                loader: 'ts',
            },
            bundle: true,
            format: 'esm',
            platform: 'browser',
            outfile: join(directory, 'fixture.js'),
            logLevel: 'silent',
        })
        server = createServer(async (req, res) => {
            if (req.url === '/fixture.js') {
                res.setHeader('Content-Type', 'text/javascript')
                res.end(await readFile(join(directory, 'fixture.js')))
            } else res.end('<!doctype html><style>body{margin:0}</style><script type="module" src="/fixture.js"></script>')
        })
        await new Promise((r) => server.listen(0, '127.0.0.1', r))
        browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] })
        results.browser = browser.version()
        const version = spawnSync(cli, ['--version'], { encoding: 'utf8' })
        results.runtime = (version.stdout + version.stderr).trim()
        results.threeVersion = JSON.parse(await readFile('node_modules/three/package.json', 'utf8')).version
        results.sourceSnapshot = process.env.SCAD_BENCH_SOURCE_ROOT || 'src'
        results.note = 'GPU-completed Z-axis orbit samples; P50/P95 use linear interpolation of the saved samples (0.015 radians per frame). One cached CLI/worker parameter edit plus GPU completion and two animation frames per case; excludes VS Code IPC/input debounce. Console errors retained with duplicate counts.'
        for (const [name, source] of Object.entries(cases)) {
            if (process.env.SCAD_BENCH_CASES && !process.env.SCAD_BENCH_CASES.split(',').includes(name)) continue
            const started = performance.now()
            const csg = execFileSync(cli, ['--export-format', 'csg', '-D', '$preview=true', '-o', '-', '-'], { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
            const cliMs = performance.now() - started,
                workerStarted = performance.now(),
                worker = new Worker(workerPath)
            let data
            try {
                data = await new Promise((resolve, reject) => {
                    worker.once('error', reject)
                    worker.once('message', (r) => (r.error ? reject(new Error(r.error)) : resolve(r.scene)))
                    worker.postMessage(csg)
                })
            } finally {
                await worker.terminate()
            }
            const workerMs = performance.now() - workerStarted
            const updateStarted = performance.now(),
                updateSource = name === 'roundedEnclosure' ? source.replace('rounded([60,', 'rounded([60.6,') : source === libraryModel ? source.replace('gear(number', 'scale([1.01,1,1])gear(number') : `scale([1.01,1,1]){${source}}`
            const updateCsg = execFileSync(cli, ['--export-format', 'csg', '-D', '$preview=true', '-o', '-', '-'], { input: updateSource, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
            const updateCliMs = performance.now() - updateStarted,
                updatedWorker = new Worker(workerPath),
                cached = Object.fromEntries(data.geometryKeys.map((key, i) => [key, { mesh: data.meshes[i], ...(data.blas ? { blas: data.blas[i] } : {}) }]))
            let updateData
            try {
                updateData = await new Promise((resolve, reject) => {
                    updatedWorker.once('error', reject)
                    updatedWorker.once('message', (r) => (r.error ? reject(new Error(r.error)) : resolve(r.scene)))
                    updatedWorker.postMessage({ source: updateCsg, cached })
                })
            } finally {
                await updatedWorker.terminate()
            }
            const updateHostMs = performance.now() - updateStarted
            const host = { updateKind: name === 'roundedEnclosure' ? 'operand-dimension' : 'instance-transform', cliMs, workerMs, ...data.timings, bytes: JSON.stringify(data).length, operands: data.operands.length, triangles: data.triangleCount }
            for (const forceWebGL of [false, true]) {
                const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 }),
                    errors = []
                page.on('pageerror', (e) => errors.push(e.message))
                page.on('console', (m) => {
                    if (m.type() === 'error') errors.push(m.text())
                })
                await page.goto(`http://127.0.0.1:${server.address().port}`)
                await page.waitForFunction(() => typeof window.measure === 'function')
                console.error('measuring', name, forceWebGL ? 'webgl2' : 'webgpu')
                try {
                    const gpu = await page.evaluate(({ data, updateData, forceWebGL, width, height, frames }) => window.measure(data, updateData, forceWebGL, width, height, frames), { data, updateData, forceWebGL, width, height, frames })
                    const consoleErrors = [...new Set(errors)].map((message) => ({ message: message.slice(0, 1800), count: errors.filter((e) => e === message).length }))
                    results.samples.push({ name, ...host, ...gpu, updateCliMs, updateHostMs, customizerTransformUpdateMs: updateHostMs + gpu.updatePresentedMs, consoleErrors })
                } catch (e) {
                    results.samples.push({ name, ...host, backend: forceWebGL ? 'webgl2' : 'webgpu', error: String(e).slice(0, 2500), consoleErrors: [...new Set(errors)].map((message) => ({ message: message.slice(0, 1800), count: errors.filter((e) => e === message).length })) })
                }
                if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(results, null, 2) + '\n')
                await page.close()
            }
        }
    } finally {
        await browser?.close()
        if (server) await new Promise((r) => server.close(r))
        await rm(directory, { recursive: true, force: true })
    }
}
