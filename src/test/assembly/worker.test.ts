import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { assemblyInWorker, configureAssemblyWorker } from '../../platform/cad/AssemblyWorker'
import { stl, box } from '../mesh/fixtures'
configureAssemblyWorker(resolve('dist/assembly-verification-worker.mjs'))
const parts = () => [
    { id: 'a', bytes: stl(), format: 'stl' as const, transform: undefined },
    { id: 'b', bytes: stl(box([1, 1, 1], [1.3, 0, 0]), true), format: 'stl' as const, transform: undefined },
]
test('bundled isolated Worker, timeout termination and next-task recovery', async () => {
    const result = await assemblyInWorker(parts(), [['a', 'b']])
    assert.equal(result.complete, true, JSON.stringify(result.incomplete))
    assert.equal(result.pairs[0].relation, 'clear')
    const timed = await assemblyInWorker(parts(), [['a', 'b']], undefined, 1)
    assert.equal(timed.complete, false)
    assert.ok(timed.incomplete.includes('ASSEMBLY_WORKER_TIMEOUT'))
    assert.equal((await assemblyInWorker(parts(), [['a', 'b']])).complete, true)
    const abort = new AbortController()
    const cancelled = assemblyInWorker(parts(), [['a', 'b']], abort.signal)
    abort.abort()
    await assert.rejects(cancelled, /cancel|abort/i)
})
