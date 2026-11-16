import test from 'node:test'
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {configureReviewWorker,reviewWorker} from '../../platform/review/ReviewWorker'
import {stl} from '../mesh/fixtures'
configureReviewWorker(resolve('dist/review-geometry-worker.mjs'))
const request={operation:'digest' as const,subjects:[{id:null,bytes:stl(),format:'stl' as const,units:'mm' as const}]}
test('isolated worker produces bound evidence, cancellation/timeout cannot produce complete results, and a later task recovers',async()=>{
 const abort=new AbortController();abort.abort();await assert.rejects(async()=>reviewWorker(request,abort.signal),/abort/i)
 await assert.rejects(reviewWorker(request,undefined,1),/exceeded/)
 const result=await reviewWorker(request);assert.ok(Array.isArray(result));assert.equal(result[0].triangles,12)
 const invalid={...request,subjects:[{...request.subjects[0],bytes:new Uint8Array(10)}]};await assert.rejects(reviewWorker(invalid),/STL/)
 const view=await reviewWorker({...request,operation:'view'});assert.ok('display' in view)
})
