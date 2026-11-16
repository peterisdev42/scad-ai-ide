import {execFileSync} from 'node:child_process'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {previewFixture} from './helpers/prepared-preview-fixture.mjs'
const baseline='12c106372be287f50775320bb79c97e1077f337c',source=execFileSync('git',['show',baseline+':src/features/preview/webview/preview/Stage.ts'],{encoding:'utf8'}),results=[]
for(const variant of ['baseline','phase4']){
 const fixture=await previewFixture(variant==='baseline'?{stageSource:source}:{});try{for(const forceWebGL of [false,true]){const page=await fixture.browser.newPage();await page.goto(fixture.url);await page.waitForFunction(()=>window.setup);await page.evaluate(force=>window.setup(force),forceWebGL)
 const base64=Buffer.from(JSON.stringify(await fixture.scene('largeBoolean'))).toString('base64');await page.evaluate(base64=>window.draw('csgp',base64,1),base64)
 const samples=await page.evaluate(async()=>{cancelAnimationFrame(stage.animationFrameId);stage.animationFrameId=null;const values=[];for(let i=0;i<200;i++){const t=performance.now();stage.drawFrame();await stage.gpuCompletion.wait(stage.renderer);if(i>=40)values.push(performance.now()-t)}stage.dispose();return values});samples.sort((a,b)=>a-b);results.push({variant,backend:forceWebGL?'webgl2':'webgpu',sampleCount:samples.length,p50Ms:samples[Math.floor(samples.length*.5)],p95Ms:samples[Math.floor(samples.length*.95)]});await page.close()}}finally{await fixture.close()}
}
const comparisons=['webgpu','webgl2'].map(backend=>{const a=results.find(r=>r.backend===backend&&r.variant==='baseline'),b=results.find(r=>r.backend===backend&&r.variant==='phase4'),limit=Math.max(a.p95Ms*.1,1);return{backend,deltaP95Ms:b.p95Ms-a.p95Ms,allowedDeltaMs:limit,pass:b.p95Ms-a.p95Ms<=limit}})
await mkdir('.build',{recursive:true});await writeFile('.build/p4-preview-performance.json',JSON.stringify({baseline,scope:'same machine, same largeBoolean Fast Preview fixture; drawFrame plus GPU completion; 40 warmup +160 measured frames per backend/variant',results,comparisons},null,2));console.log(JSON.stringify({results,comparisons}));if(comparisons.some(r=>!r.pass))process.exitCode=1
