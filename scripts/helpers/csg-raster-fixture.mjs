import { build } from 'esbuild'
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'

export async function startRasterFixture() {
    let directory, server, browser, url
    directory = await mkdtemp(join(tmpdir(), 'scad-raster-test-'))
    await build({
        stdin: {
            contents: `
        import {Scene,Mesh,MeshBasicMaterial,BufferGeometry,BufferAttribute,Matrix4,Color,OrthographicCamera,PerspectiveCamera,Vector3,RenderTarget,DepthTexture,FloatType,BoxGeometry} from 'three';
        import {WebGPURenderer,MeshBasicNodeMaterial,QuadMesh} from 'three/webgpu';
        import {screenCoordinate,textureLoad,vec4} from 'three/tsl';
        import {CsgModel} from './src/features/preview/webview/preview/csg/CsgModel';
        import {ModelRepresentation} from './src/features/preview/webview/preview/models/ModelRepresentation';
        import {Group} from 'three';
        const decode=(s,T)=>{const bytes=Uint8Array.from(atob(s),c=>c.charCodeAt(0));return new T(bytes.buffer)};
        const geometry=m=>{const p=decode(m.properties,Float32Array),positions=new Float32Array(p.length/m.stride*3);for(let i=0;i<positions.length/3;i++)positions.set(p.subarray(i*m.stride,i*m.stride+3),i*3);const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(positions,3));g.setIndex(new BufferAttribute(decode(m.indices,Uint32Array),1));g.computeVertexNormals();return g;};
        window.compare=async(data,topology,products,forceWebGL,options={})=>{
            const width=options.width??1920,height=options.height??1080,renderer=new WebGPURenderer({forceWebGL,antialias:false,stencil:true});renderer.setSize(width,height);await renderer.init();document.body.append(renderer.domElement);
            const camera=options.perspective?new PerspectiveCamera(options.fov??45,width/height,.1,500):new OrthographicCamera(-32*width/height,32*width/height,32,-32,.1,500);camera.up.set(0,0,1);camera.position.fromArray(options.position??[0,-60,0]);camera.lookAt(new Vector3(...(options.target??[0,0,0])));camera.updateMatrixWorld();
            const scene=new Scene();scene.background=new Color(0);let occluder;if(options.occluder){occluder=new Mesh(new BoxGeometry(4,4,4),new MeshBasicMaterial({color:0x00ff00}));scene.add(occluder)}const geometries=data.meshes.map(geometry),materials=data.operands.map(o=>new MeshBasicMaterial({color:new Color(...o.color.slice(0,3))}));
            const operands=data.operands.map((o,i)=>{const mesh=new Mesh(geometries[o.mesh],materials[i]);mesh.applyMatrix4(new Matrix4().fromArray(o.matrix));mesh.updateMatrixWorld();return mesh});
            const target=new RenderTarget(width,height,{stencilBuffer:false,depthTexture:new DepthTexture(width,height,FloatType)}),csg=new CsgModel(data),models=[csg,...data.overlays.map(o=>new CsgModel(data,o.root,o.kind))],group=new Group();if(options.directionalTest)models.forEach(m=>m.setLights([{position:new Vector3(0,-1,0),color:new Color(Math.PI,Math.PI,Math.PI),directional:true}],new Color(0,0,0)));group.add(...models.map(m=>m.mesh));scene.add(group);const representation=new ModelRepresentation(group,models,1);renderer.setRenderTarget(target);await representation.render(renderer,scene,camera);
            const actual=await renderer.readRenderTargetPixelsAsync(target,0,0,width,height);
            const depthTarget=new RenderTarget(width,height,{type:FloatType,depthBuffer:false}),depthMaterial=new MeshBasicNodeMaterial({depthWrite:false,depthTest:false,toneMapped:false});depthMaterial.fragmentNode=vec4(textureLoad(target.depthTexture,screenCoordinate).r,0,0,1);const depthQuad=new QuadMesh(depthMaterial);
            const readDepth=async()=>{renderer.setRenderTarget(depthTarget);depthQuad.render(renderer);const pixels=await renderer.readRenderTargetPixelsAsync(depthTarget,0,0,width,height);renderer.setRenderTarget(target);return pixels};
            const actualDepth=options.reference?null:await readDepth();
            const referenceGeometry=topology.meshes.map(geometry),referenceMaterial=new MeshBasicMaterial({color:0xffffff,side:2});referenceGeometry.forEach(g=>{const m=new Mesh(g,referenceMaterial);m.position.fromArray(topology.origin??[0,0,0]);scene.add(m)});
            group.removeFromParent();renderer.render(scene,camera);const expected=await renderer.readRenderTargetPixelsAsync(target,0,0,width,height),expectedDepth=options.reference?null:await readDepth();
            const mask=p=>Uint8Array.from({length:width*height},(_,i)=>p[i*4]>10||p[i*4+1]>10||p[i*4+2]>10),raw=mask(actual),a=options.reference&&forceWebGL?Uint8Array.from(raw,(_,i)=>raw[(height-1-Math.floor(i/width))*width+i%width]):raw,b=options.reference?Uint8Array.from(atob(options.reference),c=>c.charCodeAt(0)):mask(expected);let mismatches=0,checked=0,visible=0,depthMismatches=0,maxDepthError=0;const examples=[];
            for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){const i=y*width+x;let edge=false;for(let dy=-2;dy<=2&&!edge;dy++)for(let dx=-2;dx<=2;dx++)if(b[(y+dy)*width+x+dx]!==b[i]){edge=true;break}if(!edge){checked++;visible+=a[i];if(a[i]&&b[i]&&actualDepth){const error=Math.abs(actualDepth[i*4]-expectedDepth[i*4]);maxDepthError=Math.max(maxDepthError,error);if(error>3e-6){let low=1,high=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const value=expectedDepth[((y+dy)*width+x+dx)*4];low=Math.min(low,value);high=Math.max(high,value)}if(actualDepth[i*4]<low-3e-6||actualDepth[i*4]>high+3e-6)depthMismatches++}}if(a[i]!==b[i]){mismatches++;if(examples.length<10)examples.push([x,y,a[i],b[i]])}}}
            const samples=(options.samples??[]).map(([x,y])=>Array.from(actual.slice(((forceWebGL?height-1-y:y)*width+x)*4,((forceWebGL?height-1-y:y)*width+x)*4+4)));
            let captured;if(options.capture){let binary='';for(let i=0;i<actual.length;i+=8192)binary+=String.fromCharCode(...actual.subarray(i,i+8192));captured=btoa(binary)}
            const backend=renderer.coordinateSystem===2001?'webgpu':'webgl2';representation.dispose();target.dispose();depthTarget.dispose();depthMaterial.dispose();if(occluder){occluder.geometry.dispose();occluder.material.dispose()}[...geometries,...referenceGeometry].forEach(g=>g.dispose());[...materials,referenceMaterial].forEach(m=>m.dispose());await renderer.dispose();renderer.domElement.remove();return {backend,width,height,checked,visible,mismatches,examples,depthMismatches,maxDepthError,samples,captured};
        };`,
            resolveDir: process.cwd(),
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
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${server.address().port}`
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] })
    return {
        browser,
        url,
        directory,
        close: async () => {
            await browser?.close()
            if (server) await new Promise((r) => server.close(r))
            if (directory) await rm(directory, { recursive: true, force: true })
        },
    }
}

export async function compileRasterFixture(source, topologyRequired = true) {
    const worker = new Worker(resolve('dist/csg-worker.mjs'))
    const request = (q) =>
        new Promise((resolve, reject) => {
            worker.once('error', reject)
            worker.once('message', (r) => (r.error ? reject(new Error(r.error)) : resolve(r.scene)))
            worker.postMessage(q)
        })
    try {
        const data = await request(source),
            topology = topologyRequired ? await request({ topology: data }) : { meshes: [] }
        return { data, topology }
    } finally {
        await worker.terminate()
    }
}
