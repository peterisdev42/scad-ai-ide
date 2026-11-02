import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
export async function previewFixture() {
    const directory = await mkdtemp(join(tmpdir(), 'prepared-preview-gpu-'))
    await build({ stdin: { contents: "export {readPreviewScene} from './src/core/preview/read';export {tracePreview} from './src/core/preview/query';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: join(directory, 'reader.cjs'), logLevel: 'silent' })
    const { readPreviewScene, tracePreview } = createRequire(import.meta.url)(join(directory, 'reader.cjs'))
    await build({
        stdin: {
            contents: `
        import {Stage} from './src/features/preview/webview/preview/Stage';
        import {readPreviewTheme} from './src/features/preview/webview/preview/Theme';
        import {GoldfeatherRenderer} from './src/features/preview/webview/preview/csg/GoldfeatherRenderer';
        import {WebGPURenderer} from 'three/webgpu';
        import {Scene,AmbientLight,OrthographicCamera,PerspectiveCamera,Color,Vector3,RenderTarget,MeshBasicMaterial,Mesh} from 'three';
        window.testModel=async(scene,forceWebGL,focus,pose={})=>{
            const renderer=new WebGPURenderer({forceWebGL,antialias:pose.antialias??false});renderer.highPrecision=true;await renderer.init();renderer.setSize(128,128);
            document.body.append(renderer.domElement);
            const camera=pose.perspective?new PerspectiveCamera(50,1,.1,500):new OrthographicCamera(-16,16,16,-16,.1,200);camera.position.set(...(pose.position??[focus[0],focus[1],focus[2]+100]));camera.up.set(...(pose.up??[0,1,0]));camera.lookAt(...(pose.target??focus));camera.updateMatrixWorld();
            const world=new Scene(), model=new GoldfeatherRenderer(scene);world.add(model.root,new AmbientLight(0xffffff,1));model.updateAppearance(new Color(1,1,1),pose.override??true,world);
            const target=new RenderTarget(128,128,{stencilBuffer:true,samples:pose.antialias?4:0});renderer.setRenderTarget(target);renderer.setClearColor(0x000000,0);renderer.clear();
            const gpu=await model.prepare(renderer,camera);const start=performance.now();model.render(renderer,camera);const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,128,128);
            const result={backend:renderer.backend.isWebGPUBackend?'webgpu':'webgl2',pixels:Array.from(pixels),gpu,renderMs:performance.now()-start};
            model.dispose();target.dispose();renderer.dispose();renderer.domElement.remove();return result;
        };
        window.setup=async forceWebGL=>{window.stage=new Stage(document.getElementById('root'),readPreviewTheme(getComputedStyle(document.body)),{forceWebGL});await stage.ready;const options={environment:'none',buildPlateOrigin:'center',renderMode:'solid',camera:'perspective',modelColor:null,shadows:false,fogDensity:0};stage.applySettings({options,get:key=>options[key],is:(key,value)=>options[key]===value,set:(key,value)=>options[key]=value});for(const type of ['ambient-light','directional-light','spot-light','point-light']){stage.addSceneObject(type,type);stage.setObjectVisible(type,false)}stage.initializeView(false)};
        window.draw=async(format,base64Data,modelVersion)=>{const timings={},started=performance.now();return new Promise((resolve,reject)=>{stage.setErrorCallback(reject);stage.setDeviceLossCallback(reject);stage.loadModelData({format,base64Data,modelVersion,isLoading:false,loadingMessage:'',export(){},sendToSlicer(){},reportPerformance:value=>Object.assign(timings,value),frameReady:(backend,firstFrameMs)=>resolve({backend,firstFrameMs,viewportMs:performance.now()-started,...timings})}).then(()=>stage.initializeView(false)).catch(reject)})};
    `,
            resolveDir: process.cwd(),
            sourcefile: 'prepared-gpu-fixture.ts',
            loader: 'ts',
        },
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile: join(directory, 'fixture.js'),
        loader: { '.stl': 'binary', '.glsl': 'text' },
        logLevel: 'silent',
    })
    const server = createServer(async (req, res) => {
        if (req.url === '/fixture.js') {
            res.setHeader('Content-Type', 'text/javascript')
            res.end(await readFile(join(directory, 'fixture.js')))
        } else res.end('<!doctype html><style>body{margin:0;--vscode-editor-background:#202020;--vscode-foreground:#ddd}#root{width:800px;height:600px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>')
    })
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] })
    return {
        browser,
        directory,
        readPreviewScene,
        tracePreview,
        url: `http://127.0.0.1:${server.address().port}`,
        async scene(name) {
            return readPreviewScene(await readFile(resolve('src/test/preview/fixtures/prepared', name + '.csgp')))
        },
        async close() {
            await browser.close()
            await new Promise((done) => server.close(done))
            await rm(directory, { recursive: true, force: true })
        },
    }
}
