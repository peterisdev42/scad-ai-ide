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
        calls = 0,
        delay = 0
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
            await new Promise((r) => setTimeout(r, delay))
            signal.throwIfAborted()
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
        setDelay: (v: number) => (delay = v),
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
test('independent cancellation preserves another waiter; last cancellation never caches PASS', async () => {
    const s = await setup()
    try {
        s.setDelay(35)
        const c = new AbortController(),
            a = s.service.check({ uri: 'file:///workspace/.scad/verification.json' }, c.signal),
            b = s.service.check({ uri: 'file:///workspace/.scad/verification.json' })
        await new Promise((r) => setTimeout(r, 10))
        c.abort()
        await assert.rejects(a, /cancel|abort/i)
        assert.equal((await b).overallStatus, 'PASS')
        assert.equal(s.calls(), 1)
    } finally {
        await s.close()
    }
    const q = await setup()
    try {
        q.setDelay(50)
        const c = new AbortController(),
            p = q.service.check({ uri: 'file:///workspace/.scad/verification.json' }, c.signal)
        await new Promise((r) => setTimeout(r, 10))
        c.abort()
        await assert.rejects(p, /cancel|abort/i)
        await new Promise((r) => setTimeout(r, 60))
        assert.equal((await q.service.check({ uri: 'file:///workspace/.scad/verification.json' })).overallStatus, 'PASS')
        assert.equal(q.calls(), 2)
    } finally {
        await q.close()
    }
})
test('input stamp race and active invalidation prevent publication', async () => {
    const s = await setup()
    try {
        s.setDelay(40)
        const p = s.service.check({ uri: 'file:///workspace/.scad/verification.json' })
        await new Promise((r) => setTimeout(r, 15))
        s.setStamp('2')
        await assert.rejects(p, /changed/i)
        const q = s.service.check({ uri: 'file:///workspace/.scad/verification.json' })
        await new Promise((r) => setTimeout(r, 15))
        s.service.invalidate()
        await assert.rejects(q, /abort|cancel/i)
    } finally {
        await s.close()
    }
})
