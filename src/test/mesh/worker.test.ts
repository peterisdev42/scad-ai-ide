import test from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { analyzeInWorker, configureMeshVerificationWorker } from '../../platform/cad/MeshWorker'
import { stl } from './fixtures'
test('disposable Worker recovers after timeout, crash and cancellation and returns raw evidence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mesh-worker-')),
        worker = resolve('dist/mesh-verification-worker.mjs')
    try {
        const hang = join(dir, 'hang.mjs')
        await writeFile(hang, 'setInterval(()=>{},1000)')
        configureMeshVerificationWorker(hang)
        const timeout = await analyzeInWorker(stl(), 'stl', undefined, 20)
        assert.equal(timeout.executionStatus, 'TIMED_OUT')
        assert.equal(timeout.error?.unresolved, true)
        const abort = new AbortController(),
            task = analyzeInWorker(stl(), 'stl', abort.signal)
        abort.abort()
        await assert.rejects(task, /cancel/i)
        const crash = join(dir, 'crash.mjs')
        await writeFile(crash, 'throw new Error("fixture crash")')
        configureMeshVerificationWorker(crash)
        assert.equal((await analyzeInWorker(stl(), 'stl')).executionStatus, 'FAILED')
        configureMeshVerificationWorker(worker)
        const good = await analyzeInWorker(stl(), 'stl')
        assert.equal(good.executionStatus, 'SUCCEEDED')
        assert.equal(good.facts?.physicalVolume.value, 1)
        assert.ok(good.display?.bytes.length)
    } finally {
        configureMeshVerificationWorker(worker)
        await rm(dir, { recursive: true, force: true })
    }
})
