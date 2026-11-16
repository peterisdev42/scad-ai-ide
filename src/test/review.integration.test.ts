import {tmpdir} from 'node:os'
import * as assert from 'node:assert/strict'
import {mkdir,writeFile,rm,mkdtemp} from 'node:fs/promises'
import {join,dirname} from 'node:path'
import * as vscode from 'vscode'
import type {activate} from '../extension'
import {EvidenceRepository} from '../features/cad-review/EvidenceRepository'
import {CapabilityError} from '../core/capabilities/CapabilityTypes'
import {stl,box} from './mesh/fixtures'
import type {Anchor} from '../core/review/types'
suite('Frozen CAD review Extension Host',()=>{
 let api:Awaited<ReturnType<typeof activate>>,root:string,extension:vscode.Extension<Awaited<ReturnType<typeof activate>>>
 const invoke=async(name:string,input:Record<string,unknown>)=>{const result=await api.capabilities.invoke('cad.'+name,input,{actor:'agent'});assert.equal(result.ok,true,JSON.stringify(result));return result.ok?result.data as Record<string,any>:undefined!}
 suiteSetup(async function(){if(!vscode.workspace.workspaceFolders?.[0]){this.skip();return}extension=vscode.extensions.all.find(e=>e.packageJSON.name==='scad-ai-ide')!;api=await extension.activate();root=join(vscode.workspace.workspaceFolders[0].uri.fsPath,'review-host');await mkdir(root,{recursive:true})})
 suiteTeardown(async()=>{api?.cad.problems.invalidateAll();if(root)await rm(root,{recursive:true,force:true})})
 const verify=async(file:string)=>{await writeFile(file,stl());return api.cad.geometry!.verify({uri:vscode.Uri.file(file).toString(),units:'mm'})}
 test('all five tools are exposed; no Preview comparison and explicit print screening preserve baseline and model states',async()=>{
  const file=join(root,'compare.stl'),before=await verify(file),retained=await invoke('manageReview',{action:'retainBaseline',reportId:before.reportId,label:'Host baseline'})
  assert.equal(retained.retained,true);await writeFile(file,stl(box([2,1,1])));const after=await api.cad.geometry!.verify({uri:vscode.Uri.file(file).toString(),units:'mm'}),compared=await invoke('compare',{baselineReportId:before.reportId,targetReportId:after.reportId})
  assert.equal(compared.items[0].geometryChanged,true);assert.equal(compared.regressionStatus,'NO_REGRESSIONS_FOUND');assert.equal(compared.current.baseline,false);assert.equal(compared.current.target,true)
  await assert.rejects(api.cad.review!.compare({reportId:after.reportId}),/baselineReportId and targetReportId/)
  const readonly=await vscode.workspace.openTextDocument(vscode.Uri.parse(compared.reportUri));assert.equal(JSON.parse(readonly.getText()).targetReportId,after.reportId)
  const profile=join(root,'print.json');await writeFile(profile,JSON.stringify({schemaVersion:1,units:'mm',process:'fdm',buildVolumeMm:[1,1,1],buildPose:{rotate:[0,0,0],translate:[0,0,0]},maxOverhangFromVerticalDeg:45}))
  const screened=await invoke('checkPrintability',{reportId:after.reportId,profileUri:vscode.Uri.file(profile).toString()});assert.equal(screened.result.envelope.status,'FAIL');assert.equal(screened.printability,'NOT_CHECKED');assert.equal(after.overallStatus,'PASS')
  const issue=await api.cad.issueDetails(screened.reportId,screened.issues[0].id,true);assert.equal(issue.current,true)
  const feedback=await invoke('getFeedback',{reportId:after.reportId});assert.equal(feedback.items.length,0)
  const tools=vscode.lm.tools.map(t=>t.name);for(const name of ['compare','getFeedback','requestPointing','checkPrintability','manageReview'])assert.ok(tools.includes('scad_ai_ide_model_'+name))
  await invoke('manageReview',{action:'releaseBaseline',reportId:before.reportId})
 })
 test('cold repository reads retained original report and raw mesh with no compile, including a deleted source',async()=>{
  const file=join(root,'restart.stl'),r=await verify(file),review=api.cad.review!;await review.manage({action:'retainBaseline',reportId:r.reportId});const h=await review.evidence.resolve(r.reportId),storage=dirname(dirname(h.store.directory));h.release()
  const cold=new EvidenceRepository({extensionUri:extension.extensionUri,globalStorageUri:vscode.Uri.file(storage)} as vscode.ExtensionContext,{...api.cad,assembly:undefined,verification:api.cad.verification,geometry:{core:{get(){throw new CapabilityError('REPORT_NOT_FOUND','No live cache')}},capturePart:api.cad.geometry!.capturePart.bind(api.cad.geometry)}} as never)
  await api.refresh();await new Promise(resolve=>setTimeout(resolve,750)) // Let selected Runtime discovery and extension environment activation settle before the first PNG fingerprint.
  await rm(file);const liveRead=await review.evidence.resolve(r.reportId);liveRead.release();const views=await review.renderViews({reportId:r.reportId,cameras:['iso']});assert.equal(views.renderStatus,'AVAILABLE');assert.equal(views.current,false);assert.equal(views.frames[0].sourceMeshSha256,r.snapshot.meshSha256);const read=await cold.resolve(r.reportId);try{assert.equal(read.report.reportId,r.reportId);assert.equal(await read.current(),false);assert.deepEqual(await read.read(r.artifacts.find(a=>a.role==='raw')!.id),Buffer.from(stl()))}finally{read.release()}
  await review.manage({action:'releaseBaseline',reportId:r.reportId})
 })
 test('scripted interaction adapter tests commit/CAS/stale lifecycle, without claiming real human acceptance',async()=>{
  const file=join(root,'point.stl');await writeFile(file,stl(box().slice(1)));const r=await api.cad.geometry!.verify({uri:vscode.Uri.file(file).toString(),units:'mm'}),review=api.cad.review!,original=review.views;assert.equal(r.overallStatus,'FAIL')
  const anchor:Anchor={reportId:r.reportId,snapshotId:r.snapshot.id,revision:r.snapshot.id,partId:null,objectId:'stl:0',anchorHash:r.artifacts[0].sha256,triangle:2,mesh:0,position:[0.5,0.25,1],localPosition:[0.5,0.25,1],normal:[0,0,1],localNormal:[0,0,1],matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],units:'mm',camera:null,source:{uri:r.snapshot.document.uri,instanceId:'stl:0',sourceTriangle:2,confidence:'mesh-only'}}
  review.views={open:async()=>{},dispose(){},request:async input=>input.submit(anchor,'Scripted integration fixture')}
  try{const result=await review.requestPointing({reportId:r.reportId,prompt:'Scripted lifecycle'});assert.equal(result.status,'ACCEPTED');const f=result.feedback!;const resolved=await review.manage({action:'resolveFeedback',feedbackId:f.id,expectedRevision:f.recordRevision}) as {status:string};assert.equal(resolved.status,'resolved');assert.equal(r.overallStatus,'FAIL')
   await writeFile(file,stl(box([2,1,1])));await review.refresh();const data=await review.getFeedback({reportId:r.reportId}),stale=data.items[0];assert.equal(stale.status,'stale');await writeFile(file,stl());await review.refresh();assert.equal((await review.getFeedback({reportId:r.reportId})).items[0].status,'stale')
   await assert.rejects(review.manage({action:'reopenFeedback',feedbackId:f.id,expectedRevision:stale.recordRevision}),/stale/i);await review.manage({action:'deleteFeedback',feedbackId:f.id,expectedRevision:stale.recordRevision})
  }finally{review.views=original}
 })
 test('cancel before submission leaves no record; concurrent requests are rejected',async()=>{
  const file=join(root,'cancel.stl'),r=await verify(file),review=api.cad.review!,original=review.views,abort=new AbortController();let ready!:()=>void;const entered=new Promise<void>(r=>ready=r)
  review.views={open:async()=>{},dispose(){},request:async(_input,signal)=>{ready();return new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}))}}
  try{const first=review.requestPointing({reportId:r.reportId,prompt:'Scripted cancel'},abort.signal);await entered;await assert.rejects(review.requestPointing({reportId:r.reportId,prompt:'Concurrent'}),/Another pointing/);abort.abort();await assert.rejects(first,/Cancelled/);assert.equal((await review.getFeedback({reportId:r.reportId})).items.length,0)}finally{review.views=original}
 })
 test('retained project stores leave tool visibility when their workspace folder is removed',async function(){
  if(process.env.SCAD_TEST_DYNAMIC_WORKSPACE!=='1'){this.skip();return} // Opt in on a Host that accepts folder mutation; prior rejected runs remain in the acceptance ledger.
  const other=await mkdtemp(join(tmpdir(),'cad-review-scope-')),uri=vscode.Uri.file(other),file=join(other,'isolated.stl'),review=api.cad.review!
  const change=(add:boolean)=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{sub.dispose();reject(new Error('Workspace folder event timeout'))},10000),sub=vscode.workspace.onDidChangeWorkspaceFolders(()=>{clearTimeout(timer);sub.dispose();resolve()});const ok=add?vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders!.length,0,{uri}):vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders!.findIndex(f=>f.uri.path.endsWith('/'+other.split('/').at(-1)!)),1);if(!ok){clearTimeout(timer);sub.dispose();reject(new Error('Workspace folder update was rejected before its event'))}})
  let id:string|undefined,store:import('../platform/review/ReviewEvidenceStore').ReviewEvidenceStore|undefined
  try{await change(true);await writeFile(file,stl());const r=await api.cad.geometry!.verify({uri:vscode.Uri.file(file).toString(),units:'mm'});id=r.reportId;await review.manage({action:'retainBaseline',reportId:id});const h=await review.evidence.resolve(id),directory=h.store.directory;store=h.store;h.release();assert.ok((await review.evidence.activeStores()).some(s=>s.directory===directory))
   await change(false);assert.ok(!(await review.evidence.activeStores()).some(s=>s.directory===directory));await assert.rejects(review.manage({action:'releaseBaseline',reportId:id}),/Unknown retained/)
  }finally{if(id&&store)await store.releaseBaseline(id);if(vscode.workspace.getWorkspaceFolder(uri))await change(false);await rm(other,{recursive:true,force:true})}
 })
 test('partial comparison acquisition failures release caller and shared-job evidence leases',async()=>{
  const r=await verify(join(root,'lease.stl')),review=api.cad.review!,original=review.evidence.resolve.bind(review.evidence);let leases=0,calls=0
  review.evidence.resolve=async(id:string)=>{calls++;if(calls===2||calls===4)throw new CapabilityError('REPORT_NOT_FOUND','Scripted second-handle failure');const h=await original(id),release=h.release;leases++;h.release=()=>{leases--;release()};return h}
  try{await assert.rejects(review.compare({baselineReportId:r.reportId,targetReportId:r.reportId}),/second-handle/);assert.equal(leases,0);calls=0;review.evidence.resolve=async(id:string)=>{calls++;if(calls===4)throw new CapabilityError('REPORT_NOT_FOUND','Scripted shared second-handle failure');const h=await original(id),release=h.release;leases++;h.release=()=>{leases--;release()};return h};await assert.rejects(review.compare({baselineReportId:r.reportId,targetReportId:r.reportId}),/shared second-handle/);assert.equal(leases,0)}finally{review.evidence.resolve=original}
 })

})
