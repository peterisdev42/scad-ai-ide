import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReports } from '../../core/review/compare'
import { geometryDigest, subjects } from '../../core/review/geometry'
import { evidence } from './fixtures'
import { stl, box } from '../mesh/fixtures'
const identity = (b: Uint8Array) => [geometryDigest(subjects([{ id: null, bytes: b, format: 'stl', units: 'mm' }])[0])]
test('summary separates geometry changes, target failure and constraint regression; a normal geometry edit is not an error', async () => {
    const a = await evidence(),
        bytes = stl(box([2, 1, 1])),
        b = await evidence(bytes),
        r = compareReports(a, b, identity(stl()), identity(bytes))
    assert.equal(r.rows[0].geometryChanged, true)
    assert.equal(r.rows[0].placementChanged, false)
    assert.equal(r.issues.length, 0)
    assert.equal(r.regressionStatus, 'NO_REGRESSIONS_FOUND')
    b.checks[0].status = 'FAIL'
    const failed = compareReports(a, b, identity(stl()), identity(bytes))
    assert.equal(failed.regressionStatus, 'REGRESSIONS_FOUND')
    assert.equal(failed.checks[0].transition, 'regression')
})
test('units, scope and runtime/quality incompatibility stay unresolved; unavailable geometry never appears unchanged', async () => {
    const a = await evidence(),
        b = await evidence()
    b.units = 'modelUnits'
    assert.equal(compareReports(a, b, identity(stl()), identity(stl())).comparisonStatus, 'INCOMPATIBLE')
    b.units = 'mm'
    b.snapshot.document.uri = 'file:///different/model.stl'
    assert.equal(compareReports(a, b, [], []).comparisonStatus, 'INCOMPATIBLE')
    b.snapshot.document.uri = a.snapshot.document.uri
    b.snapshot.quality.requestedGlobalTessellation = { $fn: 100 }
    assert.equal(compareReports(a, b, identity(stl()), identity(stl())).regressionStatus, 'UNRESOLVED')
    b.snapshot.quality.requestedGlobalTessellation = {}
    assert.equal(compareReports(a, b, [], []).regressionStatus, 'UNRESOLVED');assert.equal(compareReports(a,b,[],[]).rows[0].status,'unresolved')
})
import {assembly} from './fixtures'
const pairDigests=()=>['body','lid'].map(id=>({...identity(stl())[0],id}))
test('stable declared IDs survive reordering; pose changes stay separate and protected parts cannot silently move',async()=>{
 const a=await assembly(),b=await assembly();b.snapshot.manifest!.parts.reverse();b.snapshot.sources.reverse();assert.equal(compareReports(a,b,pairDigests(),pairDigests()).regressionStatus,'NO_REGRESSIONS_FOUND')
 b.facts!.parts.find(p=>p.id==='body')!.matrix[12]=1;const moved=compareReports(a,b,pairDigests(),pairDigests(),['body']);assert.equal(moved.rows.find(p=>p.partId==='body')!.geometryChanged,false);assert.equal(moved.rows.find(p=>p.partId==='body')!.placementChanged,true);assert.equal(moved.issues[0].code,'DIFF_PROTECTED_PART_CHANGED')
})
test('changed or removed required constraints never count as repair; baseline rules are rechecked against target facts',async()=>{
 const a=await assembly(),b=await assembly(0.18);b.snapshot.manifest!.checks[0]={id:'gap',type:'clearance',parts:['body','lid'],min:0.1,max:0.35};b.checks[0].status='PASS'
 const changed=compareReports(a,b,pairDigests(),pairDigests());assert.equal(changed.regressionStatus,'UNRESOLVED');assert.equal(changed.checks.find(c=>c.id==='gap')!.baselineRecheck,'FAIL');assert.equal(changed.checks.find(c=>c.id==='gap')!.definitionChanged,true)
 b.snapshot.manifest!.checks=[];b.checks=[];const removed=compareReports(a,b,pairDigests(),pairDigests());assert.equal(removed.regressionStatus,'UNRESOLVED');assert.ok(removed.incomplete.some(s=>s.startsWith('CONSTRAINT_BASELINE_CHANGED:')))
})
import Ajv from 'ajv'
import comparisonSchema from '../../../resources/schemas/cad-comparison-v1.schema.json'
test('versioned comparison schema validates full evidence and rejects invented version/status',async()=>{const a=await evidence(),b=await evidence(),r=compareReports(a,b,identity(stl()),identity(stl())),validate=new Ajv({strict:true}).compile(comparisonSchema);assert.ok(validate(JSON.parse(JSON.stringify(r))),JSON.stringify(validate.errors));assert.equal(validate({...r,schemaVersion:2}),false)})
