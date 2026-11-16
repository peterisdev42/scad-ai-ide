import test from 'node:test'
import assert from 'node:assert/strict'
import {previewFixture} from './helpers/prepared-preview-fixture.mjs'
import {subjects,encodeDisplay} from '../src/core/review/geometry.ts'
import {decodeDisplay} from '../src/core/review/display.ts'
import {box,stl} from '../src/test/mesh/fixtures.ts'
const packet=decodeDisplay(encodeDisplay(subjects([{id:'body',format:'stl',bytes:stl(box([20,20,10],[1e10,0,0]),true),units:'mm'}]),'target').display)
const wire={...packet,parts:packet.parts.map(p=>({...p,positions:[...p.positions],indices:[...p.indices]}))}
test('frozen evidence Stage renders and picks the target with original triangle identity on WebGPU and WebGL2',{timeout:120000},async()=>{
 const fixture=await previewFixture();try{for(const forceWebGL of [false,true]){const page=await fixture.browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(fixture.url);await page.waitForFunction(()=>window.setup)
 await page.evaluate(async({forceWebGL,wire})=>{await window.setup(forceWebGL);window.hits=[];stage.setEvidencePicking(hit=>window.hits.push(hit));const evidence={...wire,parts:wire.parts.map(p=>({...p,positions:new Float32Array(p.positions),indices:new Uint32Array(p.indices)}))};await stage.loadModelData({format:'verification-evidence',evidence,base64Data:null,isLoading:false,loadingMessage:'',export(){},sendToSlicer(){}});stage.setObjectVisible('ambient-light',true);stage.initializeView(false)}, {forceWebGL,wire})
 await page.mouse.click(400,300);await page.waitForFunction(()=>window.hits.length>0);const hit=await page.evaluate(()=>window.hits[0]);assert.equal(hit.key,'target:body:0');assert.ok(hit.triangle>=0&&hit.triangle<12);assert.ok(hit.ray.origin[0]>1e9);assert.ok(hit.ray.direction.every(Number.isFinite))
 await page.evaluate(()=>{stage.setEvidenceVisible('target','body',false);window.hits=[]});await page.mouse.click(400,300);assert.deepEqual(await page.evaluate(()=>window.hits),[])
 await page.evaluate(()=>{stage.setEvidenceVisible('target','body',true);stage.setEvidenceMarkers([{position:[1e10+10,10,10],status:'stale'}],[{a:[1e10,0,0],b:[1e10+20,20,10]}]);stage.dispose()});assert.deepEqual(errors,[]);await page.close()}}finally{await fixture.close()}
})
