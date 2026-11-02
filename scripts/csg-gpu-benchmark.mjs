import { build } from 'esbuild'
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** Full HD shared-backend viewport: timings include GPU completion, not only submission. */
export async function benchmarkGpu(scenes) {
    const directory = await mkdtemp(join(tmpdir(), 'scad-gpu-bench-'))
    let server, browser
    try {
        await build({
            stdin: {
                contents: `
            import { Scene,Group,PerspectiveCamera,Color,Vector3,AmbientLight,RenderTarget } from 'three';
            import { WebGPURenderer } from 'three/webgpu';
            import { CsgModel } from './src/features/preview/webview/preview/csg/CsgModel';
            import { ModelRepresentation } from './src/features/preview/webview/preview/models/ModelRepresentation';
            window.measure=async(data,forceWebGL)=>{
                const renderer=new WebGPURenderer({forceWebGL,antialias:false});renderer.setSize(1920,1080);
                const initializationStarted=performance.now();await renderer.init();const initializationMs=performance.now()-initializationStarted;
                const started=performance.now(),model=new CsgModel(data),group=new Group(),scene=new Scene();group.add(model.mesh);scene.add(group,new AmbientLight(0xffffff,1));scene.background=new Color(0,0,0);const target=new RenderTarget(1920,1080);renderer.setRenderTarget(target);
                const center=new Vector3(...data.origin),size=new Vector3(...data.bounds.max).sub(new Vector3(...data.bounds.min)),diagonal=size.length();
                const camera=new PerspectiveCamera(45,1920/1080,diagonal*.001,diagonal*10);camera.up.set(0,0,1);camera.position.copy(center).add(new Vector3(-1,-1,1).normalize().multiplyScalar(diagonal*1.8));camera.lookAt(center);camera.updateMatrixWorld();
                const representation=new ModelRepresentation(group,[model],1);
                model.update(camera,new Color(.8,.8,.8),false,'solid',[],!forceWebGL,false);
                model.setLights([],new Color(1,1,1));
                const {value:prepared}=await representation.prepare(renderer,camera,scene);
                await representation.render(renderer,scene,camera);await renderer.readRenderTargetPixelsAsync(target,960,540,1,1);const firstFrameMs=performance.now()-started,frames=[];
                for(let i=0;i<5;i++){camera.position.x+=diagonal*.01;camera.lookAt(center);camera.updateMatrixWorld();const frame=performance.now();await representation.render(renderer,scene,camera);await renderer.readRenderTargetPixelsAsync(target,960,540,1,1);frames.push(performance.now()-frame)}
                const backend=renderer.coordinateSystem===2001?'webgpu':'webgl2';const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,1920,1080);if(!pixels.some((value,index)=>index%4!==3&&value>20))throw new Error('Benchmark rendered no visible CSG pixels');representation.dispose();target.dispose();await renderer.dispose();
                return {backend,width:1920,height:1080,initializationMs,...prepared,firstFrameMs,interactiveFramesMs:frames,interactiveFrameMs:frames.reduce((a,b)=>a+b,0)/frames.length};
            };
        `,
                resolveDir: process.cwd(),
                sourcefile: 'csg-benchmark.ts',
                loader: 'ts',
            },
            bundle: true,
            platform: 'browser',
            format: 'esm',
            outfile: join(directory, 'fixture.js'),
            logLevel: 'silent',
        })
        server = createServer(async (req, res) => {
            if (req.url === '/fixture.js') {
                res.setHeader('Content-Type', 'text/javascript')
                res.end(await readFile(join(directory, 'fixture.js')))
            } else res.end('<!doctype html><script type="module" src="/fixture.js"></script>')
        })
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
        browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])], executablePath: process.env.SCAD_CHROMIUM_EXECUTABLE || undefined })
        const page = await browser.newPage(),
            errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        await page.goto(`http://127.0.0.1:${server.address().port}`)
        await page.waitForFunction(() => typeof window.measure === 'function')
        const samples = []
        for (const { name, scene } of scenes) for (const forceWebGL of [true, false]) samples.push({ name, ...(await page.evaluate(({ scene, forceWebGL }) => window.measure(scene, forceWebGL), { scene, forceWebGL })) })
        if (errors.length) throw new Error(errors.join('\n'))
        return samples
    } finally {
        await browser?.close()
        if (server) await new Promise((resolve) => server.close(resolve))
        await rm(directory, { recursive: true, force: true })
    }
}
