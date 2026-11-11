import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {analyzeCustomizerSource}=require('../out/core/customizer/CustomizerSourceAnalyzer.js');
const scenario=process.env.SCAD_AGENT_SCENARIO;
assert.ok(['author','cancel'].includes(scenario));
assert.equal(process.env.SCAD_REVIEWED_FIXTURE_AUTHORIZATION,'user-approved-20261111');
const child=spawn(process.execPath,['scripts/helpers/customizer-native-omlx-observer.mjs'],{env:{...process.env,SCAD_AGENT_MANUAL_REVIEW:'1'},stdio:['ignore','pipe','pipe']});
let output='',directory,ended=false,browser,clicked=false;
child.stdout.on('data',chunk=>{process.stdout.write(chunk);output+=chunk;directory=output.match(/Native Agent evidence directory: (.+)/)?.[1]});child.stderr.pipe(process.stderr);
const done=new Promise(resolve=>child.on('exit',code=>{ended=true;resolve(code)}));
const read=async name=>{try{return await readFile(`${directory}/${name}`,'utf8')}catch{return null}};
const deadline=Date.now()+240000;
const decisions=[];
while(!ended&&Date.now()<deadline){
 const pending=await read('pending-confirmation.json');
 if(pending&&!clicked){
  const confirmation=JSON.parse(pending);assert.equal(confirmation.toolId,'scad_ai_ide_customizer_sourceApply');
  const traces=JSON.parse(await read('tool-traces.json'));
  const planTrace=traces.findLast(t=>t.capability==='customizer.sourceApply'&&t.input.mode==='plan'&&t.output?.ok);
  assert.ok(planTrace,'No successful plan to review');const plan=planTrace.output.data;
  const before=await read('buffer-before.scad');let after=before;
  const offset=position=>{const lines=before.split('\n');return lines.slice(0,position.line).reduce((n,line)=>n+line.length+1,0)+position.character};
  for(const edit of [...plan.preview].sort((a,b)=>offset(b.range.start)-offset(a.range.start))){const start=offset(edit.range.start),end=offset(edit.range.end);assert.equal(before.slice(start,end),edit.before);after=after.slice(0,start)+edit.after+after.slice(end)}
  const geometryMarker=scenario==='author'?'module model()':'cube(';assert.equal(after.slice(after.indexOf(geometryMarker)),before.slice(before.indexOf(geometryMarker)),'Geometry bytes must be unchanged');
  const analysis=analyzeCustomizerSource(after),byName=new Map(analysis.parameters.map(p=>[p.name,p]));
  const width=byName.get('width');assert.equal(width.defaultValue,40);assert.equal(width.widget,'slider');assert.deepEqual(width.range,{min:10,max:100,step:5});
  if(scenario==='author'){
   assert.equal(width.group,'Dimensions');assert.equal(width.description,'Width in millimeters');
   const shape=byName.get('shape');assert.equal(shape.defaultValue,'round');assert.equal(shape.group,'Appearance');assert.equal(shape.widget,'dropdown');
   assert.deepEqual(shape.choices,[{value:'round',label:'Round'},{value:'square',label:'Square'}]);assert.equal(byName.has('internalOffset'),false);assert.match(after,/internalOffset=0\.01;/);
  }
  const debug=JSON.parse(await read('controller.json'));browser=await chromium.connectOverCDP(debug.debugUrl);const page=browser.contexts().flatMap(c=>c.pages()).find(p=>/workbench/.test(p.url()));assert.ok(page);
  const body=await page.locator('body').innerText();assert.ok(body.replaceAll('\u00a0',' ').includes('Target: '+plan.planId),'Native confirmation must identify this exact reviewed plan');
  const label=scenario==='cancel'?'Skip':'Allow in this Session';const action=page.getByText(label,{exact:true}).filter({visible:true});assert.equal(await action.count(),1);
  await page.screenshot({path:`${directory}/reviewed-confirmation.png`});
  decisions.push({at:new Date().toISOString(),userAuthorization:'Explicit user approval of two author fixtures and a separate Skip cancellation scenario in this chat, 2026-11-11',tool:confirmation.toolId,planId:plan.planId,decision:scenario==='cancel'?'skip':'allow',nativeLabel:label,reviewedBefore:before,reviewedAfter:after,geometryBytesUnchanged:true});
  await action.click();clicked=true;await writeFile(`${directory}/manual-decisions.json`,JSON.stringify(decisions,null,2)+'\n');
 }
 await new Promise(resolve=>setTimeout(resolve,200));
}
if(!ended){child.kill('SIGTERM');throw new Error('User-reviewed fixture controller deadline reached')}
const code=await done;console.log(`User-reviewed decision count=${decisions.length}; observation exit=${code}`);process.exitCode=code??1;
