import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssemblyVerificationService, type AssemblyHost, type FrozenAssembly } from '../../core/assembly/VerificationService'
import { parseManifest } from '../../core/assembly/PartRegistry'
import { analyzeAssembly } from '../../core/assembly/AssemblyKernel'
import { MeshVerificationService, type MeshCapture } from '../../core/mesh/VerificationService'
import { decodeMesh } from '../../core/mesh/decode'
import { analyzeMesh } from '../../core/mesh/analyze'
import { ArtifactStore } from '../../platform/cad/ArtifactStore'
import { OperationQueue } from '../../platform/cad/OperationQueue'
import { box, stl } from '../mesh/fixtures'
import { digest } from '../../core/cad/snapshot'
import Ajv from 'ajv'
import schema from '../../../resources/schemas/cad-report-v3.schema.json'

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((finish) => { resolve = finish })
    return { promise, resolve }
}

function capture(id: string, selector?: string): MeshCapture {
    const hash = digest([id, selector])
    return {
        format: 'stl',
        stamps: { [id]: '1' },
        snapshot: {
            schemaVersion: 2,
            id: hash,
            sourceStateId: hash,
            kernelVersion: 'raw-mesh-v1',
            inputEvidenceHash: digest(true),
            document: { uri: `file:///workspace/${id}.stl`, sourceSha256: hash, dirty: false },
            project: { rootUri: 'file:///workspace' },
            dependencies: [],
            inputKind: 'stl',
            runtime: { used: false },
            quality: { profile: 'verification', requestedGlobalTessellation: {}, localSettings: 'source-controlled' },
            units: 'mm',
            sourceUnit: 'user-declared-mm',
            complete: true,
            unresolvedInputs: [],
            policyHash: digest('policy'),
        },
    }
}
async function setup() {
    const dir = await mkdtemp(join(tmpdir(), 'cad-assembly-')),
        store = new ArtifactStore(dir),
        queue = new OperationQueue(),
        assemblyQueue = new OperationQueue()
    let content = JSON.stringify({
            schemaVersion: 1,
            units: 'mm',
            parts: [
                { id: 'a', selector: { type: 'file', path: 'a.stl' } },
                { id: 'b', selector: { type: 'file', path: 'b.stl' } },
            ],
            checks: [{ id: 'gap', type: 'clearance', parts: ['a', 'b'], min: 0.25, max: 0.35 }],
        }),
        stamp = '1',
        calls = 0
    let gate: { started: ReturnType<typeof deferred<AbortSignal>>; proceed: ReturnType<typeof deferred<void>> } | undefined
    const meshes = new MeshVerificationService(
        {
            capture: async (input) => capture(input.uri.includes('/a.') ? 'a' : 'b'),
            materialize: async (source) => ({
                source,
                bytes: stl(box([1, 1, 1], source.snapshot.document.uri.includes('/a.') ? [0, 0, 0] : [1.3, 0, 0]), true),
                empty: false,
                executionStatus: 'SUCCEEDED',
                checks: [],
                issues: [],
                incomplete: [],
            }),
            analyze: async (bytes) => ({ executionStatus: 'SUCCEEDED', facts: await analyzeMesh(decodeMesh(bytes, 'stl')) }),
            schedule: (task, signal) => queue.run(task, signal),
        },
        store,
    )
    const freeze = async (): Promise<FrozenAssembly> => ({
        uri: 'file:///workspace/.scad/verification.json',
        text: content,
        dirty: true,
        rootUri: 'file:///workspace',
        registry: parseManifest(content),
        parts: ['a', 'b'].map((id) => ({
            id,
            input: { uri: `file:///workspace/${id}.stl`, units: 'mm', requireNonEmpty: true },
            capture: { ...capture(id), stamps: { [id]: stamp } },
            stabilityHash: digest(id),
        })),
    })
    const host: AssemblyHost = {
        freeze,
        verify: (input, signal) => meshes.verify(input, signal),
        current: (r) => meshes.current(r),
        analyze: async (parts, pairs, signal) => {
            calls++
            const pending = gate
            gate = undefined
            if (pending) {
                pending.started.resolve(signal)
                // A worker can return after cancellation. The service must discard that result.
                await pending.proceed.promise
            }
            return analyzeAssembly(parts, pairs)
        },
        schedule: (task, signal) => assemblyQueue.run(task, signal),
    }
    const service = new AssemblyVerificationService(host, store)
    return {
        service,
        store,
        setContent: (v: string) => (content = v),
        setStamp: (v: string) => (stamp = v),
        pauseAnalysis: () => {
            gate = { started: deferred<AbortSignal>(), proceed: deferred<void>() }
            return { started: gate.started.promise, resume: gate.proceed.resolve }
        },
        calls: () => calls,
        close: async () => {
            service.dispose()
            meshes.dispose()
            queue.dispose()
            assemblyQueue.dispose()
            await store.dispose()
        },
    }
}
test('v3 schema, immutable evidence, cache, historical read and baseline precondition', async () => {
    const s = await setup()
    try {
        const a = await s.service.check({ uri: 'file:///workspace/.scad/verification.json' })
        assert.equal(a.overallStatus, 'PASS', JSON.stringify(a.checks))
        const validate = new Ajv({ strict: true }).compile(schema)
        assert.ok(validate(a), JSON.stringify(validate.errors))
        assert.equal(Object.isFrozen(a.snapshot.manifest?.parts), true)
        const b = await s.service.check({ uri: a.snapshot.document.uri })
        assert.equal(a.reportId, b.reportId)
        assert.equal(s.calls(), 1)
        await assert.rejects(s.service.check({ uri: a.snapshot.document.uri, expectedManifestDigest: digest('wrong') }), /baseline changed/i)
        assert.equal((await s.service.check({ reportId: a.reportId })).reportId, a.reportId)
        assert.equal(s.calls(), 1)
        assert.equal(await s.service.current(a), true)
        await assert.rejects(s.service.check({ reportId: 'missing' }), /expired|evicted/)
    } finally {
        await s.close()
    }
})
test('cancelling one waiter preserves the shared analysis for the other waiter', { timeout: 15_000 }, async () => {
    const s = await setup()
    const analysis = s.pauseAnalysis()
    try {
        const c = new AbortController(),
            a = s.service.check({ uri: 'file:///workspace/.scad/verification.json' }, c.signal),
            b = s.service.check({ uri: 'file:///workspace/.scad/verification.json' })
        const signal = await analysis.started
        c.abort()
        await assert.rejects(a, /cancel|abort/i)
        assert.equal(signal.aborted, false)
        analysis.resume()
        assert.equal((await b).overallStatus, 'PASS')
        assert.equal(s.calls(), 1)
    } finally {
        analysis.resume()
        await s.close()
    }
})

test('cancelling the last waiter discards late analysis and allows an immediate retry', { timeout: 15_000 }, async () => {
    const q = await setup()
    const analysis = q.pauseAnalysis()
    try {
        const c = new AbortController(),
            p = q.service.check({ uri: 'file:///workspace/.scad/verification.json' }, c.signal)
        const signal = await analysis.started
        c.abort()
        await assert.rejects(p, /cancel|abort/i)
        assert.equal(signal.aborted, true)
        const retry = q.service.check({ uri: 'file:///workspace/.scad/verification.json' })
        analysis.resume()
        const report = await retry
        assert.equal(report.overallStatus, 'PASS')
        assert.equal(q.calls(), 2)
        assert.deepEqual(q.service.all().map((item) => item.reportId), [report.reportId])
    } finally {
        analysis.resume()
        await q.close()
    }
})
test('a changed input stamp prevents publication of completed analysis', { timeout: 15_000 }, async () => {
    const s = await setup()
    const changed = s.pauseAnalysis()
    try {
        const p = s.service.check({ uri: 'file:///workspace/.scad/verification.json' })
        await changed.started
        s.setStamp('2')
        changed.resume()
        await assert.rejects(p, /changed/i)
        assert.deepEqual(s.service.all(), [])
    } finally {
        changed.resume()
        await s.close()
    }
})

test('active invalidation aborts the analysis and prevents publication', { timeout: 15_000 }, async () => {
    const s = await setup()
    const analysis = s.pauseAnalysis()
    try {
        const p = s.service.check({ uri: 'file:///workspace/.scad/verification.json' })
        const signal = await analysis.started
        s.service.invalidate()
        assert.equal(signal.aborted, true)
        analysis.resume()
        await assert.rejects(p, /abort|cancel/i)
        assert.deepEqual(s.service.all(), [])
    } finally {
        analysis.resume()
        await s.close()
    }
})
