import { randomUUID, createHash } from 'node:crypto'
import type { MeshReport } from '../../core/mesh/types'
import { analyzeMesh } from '../../core/mesh/analyze'
import { decodeMesh } from '../../core/mesh/decode'
import { digest } from '../../core/cad/snapshot'
import { stl } from '../mesh/fixtures'
export async function evidence(bytes = stl()): Promise<MeshReport> {
    const id = digest(bytes),
        facts = await analyzeMesh(decodeMesh(bytes, 'stl'))
    facts.units = 'mm'
    return { schemaVersion: 2, reportId: `cad-${randomUUID()}`, snapshot: { schemaVersion: 2, id, sourceStateId: id, inputEvidenceHash: id, document: { uri: 'file:///workspace/model.stl', sourceSha256: id, dirty: false }, project: { rootUri: 'file:///workspace' }, dependencies: [], inputKind: 'stl', runtime: { used: false }, quality: { profile: 'verification', requestedGlobalTessellation: {}, localSettings: 'source-controlled' }, units: 'mm', sourceUnit: 'user-declared-mm', complete: true, unresolvedInputs: [], policyHash: id, kernelVersion: 'raw-mesh-v1' }, executionStatus: 'SUCCEEDED', overallStatus: 'PASS', units: 'mm', checks: [{ id: 'mesh-validity', category: 'mesh', required: true, status: 'PASS', issueIds: [] }], issues: [], issueCount: 0, facts, artifacts: [{ id: id, kind: 'mesh', mimeType: 'model/stl', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, snapshotId: id, role: 'raw' }], examined: ['raw-mesh'], notExamined: [], incomplete: [], metrics: { elapsedMs: 0, truncated: false }, createdAt: Date.now() }
}
import type {AssemblyReport,Manifest} from '../../core/assembly/types'
import {analyzeAssembly} from '../../core/assembly/AssemblyKernel'
import {evaluate} from '../../core/assembly/constraints'
export async function assembly(gap=0.3):Promise<AssemblyReport>{
 const mesh=await evidence(),parts=[{id:'body',selector:{type:'file' as const,path:'body.stl'}},{id:'lid',selector:{type:'file' as const,path:'lid.stl'},transform:{translate:[1+gap,0,0] as [number,number,number]}}],manifest:Manifest={schemaVersion:1,units:'mm',parts,checks:[{id:'gap',type:'clearance',parts:['body','lid'],min:0.25,max:0.35}]},facts=await analyzeAssembly(parts.map(p=>({id:p.id,bytes:stl(),format:'stl',transform:p.transform})),[['body','lid']])
 return{schemaVersion:3,units:'mm',reportId:`cad-${randomUUID()}`,snapshot:{schemaVersion:3,id:digest(gap),document:{uri:'file:///workspace/.scad/verification.json',sourceSha256:digest(manifest),dirty:false},project:{rootUri:'file:///workspace'},dependencies:[],manifestDigest:digest(manifest),manifest,sources:parts.map(p=>({partId:p.id,uri:mesh.snapshot.document.uri,selector:p.selector,sourceReport:structuredClone(mesh),transform:p.transform})),requirementsHash:digest('req'),algorithm:'exact-dyadic-bvh-v1',complete:true},facts,overallStatus:gap>=0.25&&gap<=0.35?'PASS':'FAIL',executionStatus:'SUCCEEDED',checks:evaluate(manifest,facts),issues:[],artifacts:[],incomplete:[],examined:[],notExamined:[],createdAt:Date.now()}
}
