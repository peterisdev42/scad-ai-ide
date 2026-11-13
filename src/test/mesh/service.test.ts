import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeshVerificationService, type MeshCapture, type MeshHost } from '../../core/mesh/VerificationService'
import { digest } from '../../core/cad/snapshot'
import { ArtifactStore } from '../../platform/cad/ArtifactStore'
import { OperationQueue } from '../../platform/cad/OperationQueue'
import { decodeMesh } from '../../core/mesh/decode'
import { analyzeMesh } from '../../core/mesh/analyze'
import { stl } from './fixtures'
function capture(incomplete: boolean, stamp = '1'): MeshCapture {
    const key = digest({ incomplete })
    return { format: 'stl', stamps: { model: stamp }, snapshot: { schemaVersion: 2, id: key, sourceStateId: key, kernelVersion: 'raw-mesh-v1', inputEvidenceHash: digest([!incomplete, incomplete ? ['DIRTY_MESH_BUFFER_NOT_EVALUATED'] : []]), document: { uri: 'file:///workspace/model.stl', sourceSha256: digest('mesh'), dirty: incomplete }, project: { rootUri: 'file:///workspace' }, dependencies: [], inputKind: 'stl', runtime: { used: false }, quality: { profile: 'verification', requestedGlobalTessellation: {}, localSettings: 'source-controlled' }, units: 'modelUnits', sourceUnit: 'undeclared', complete: !incomplete, unresolvedInputs: incomplete ? ['DIRTY_MESH_BUFFER_NOT_EVALUATED'] : [], policyHash: digest('policy') } }
}
test('v2 shares one immutable mesh, isolates cancellation, blocks stale evidence and reuses complete facts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cad-v2-service-')),
        store = new ArtifactStore(dir),
        queue = new OperationQueue()
    let incomplete = false,
        stamp = '1',
        calls = 0
    const host: MeshHost = {
        capture: async () => capture(incomplete, stamp),
        materialize: async (source) => {
            calls++
            await new Promise((r) => setTimeout(r, 15))
            return { source, bytes: stl(), empty: false, executionStatus: 'SUCCEEDED', checks: [], issues: [], incomplete: [] }
        },
        analyze: async (bytes) => ({ executionStatus: 'SUCCEEDED', facts: await analyzeMesh(decodeMesh(bytes, 'stl')) }),
        schedule: (task, signal) => queue.run(task, signal),
    }
    const service = new MeshVerificationService(host, store)
    try {
        const abort = new AbortController(),
            a = service.verify({ uri: 'file:///workspace/model.stl' }, abort.signal),
            b = service.verify({ uri: 'file:///workspace/model.stl' })
        abort.abort()
        await assert.rejects(a, /abort|cancel/i)
        const good = await b
        assert.equal(good.overallStatus, 'PASS')
        assert.equal(calls, 1)
        assert.equal(Object.isFrozen(good.facts?.objects[0]), true)
        assert.equal((await service.verify({ uri: 'file:///workspace/model.stl' })).reportId, good.reportId)
        incomplete = true
        assert.equal(await service.current(good), false)
        const partial = await service.verify({ uri: 'file:///workspace/model.stl' })
        assert.equal(partial.overallStatus, 'UNRESOLVED')
        assert.notEqual(partial.reportId, good.reportId)
        await assert.rejects(service.verify({ uri: 'file:///workspace/model.stl', expectedSnapshotId: good.snapshot.id }), /snapshot/i)
        incomplete = false
        stamp = 'new'
        const c = await service.verify({ uri: 'file:///workspace/model.stl' })
        assert.equal(c.overallStatus, 'PASS')
        await assert.rejects(
            Promise.resolve().then(() => service.get('no-such-report')),
            /expired|evicted/,
        )
    } finally {
        service.dispose()
        queue.dispose()
        await store.dispose()
    }
})
test('an input changed and restored while mesh analysis is running cannot publish a v2 report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cad-v2-race-')),
        store = new ArtifactStore(dir),
        queue = new OperationQueue()
    let stamp = '1'
    const service = new MeshVerificationService(
        {
            capture: async () => capture(false, stamp),
            materialize: async (source) => ({ source, bytes: stl(), empty: false, executionStatus: 'SUCCEEDED', checks: [], issues: [], incomplete: [] }),
            analyze: async (bytes) => {
                stamp = '2'
                return { executionStatus: 'SUCCEEDED', facts: await analyzeMesh(decodeMesh(bytes, 'stl')) }
            },
            schedule: (task, signal) => queue.run(task, signal),
        },
        store,
    )
    try {
        await assert.rejects(service.verify({ uri: 'file:///workspace/model.stl' }), /Inputs changed/)
    } finally {
        service.dispose()
        queue.dispose()
        await store.dispose()
    }
})

test('v2 report schema validates complete and incomplete evidence and unavailable artifacts never rerender report IDs', async () => {
    const { Ajv } = await import('ajv'),
        { readFile, rm } = await import('node:fs/promises')
    const validate = new Ajv({ strict: true }).compile(JSON.parse(await readFile('resources/schemas/cad-report-v2.schema.json', 'utf8')))
    const dir = await mkdtemp(join(tmpdir(), 'cad-v2-schema-')),
        store = new ArtifactStore(dir),
        queue = new OperationQueue()
    let calls = 0
    const service = new MeshVerificationService(
        {
            capture: async () => capture(false),
            materialize: async (source) => {
                calls++
                return { source, bytes: stl(), empty: false, executionStatus: 'SUCCEEDED', checks: [], issues: [], incomplete: [] }
            },
            analyze: async (bytes) => ({ executionStatus: 'SUCCEEDED', facts: await analyzeMesh(decodeMesh(bytes, 'stl')) }),
            schedule: (task, signal) => queue.run(task, signal),
        },
        store,
    )
    try {
        const r = await service.verify({ uri: 'file:///workspace/model.stl' })
        assert.equal(validate(JSON.parse(JSON.stringify(r))), true, JSON.stringify(validate.errors))
        await rm(join(dir, r.artifacts[0].id))
        await assert.rejects(service.ensureArtifacts(service.get(r.reportId)), /unavailable|changed/)
        assert.equal(calls, 1)
    } finally {
        service.dispose()
        queue.dispose()
        await store.dispose()
    }
})

test('an oversized evidence report is rejected rather than returning an immediately evicted PASS', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cad-v2-report-budget-')),
        store = new ArtifactStore(dir),
        queue = new OperationQueue()
    const service = new MeshVerificationService(
        {
            capture: async () => capture(false),
            materialize: async (source) => ({ source, bytes: stl(), empty: false, executionStatus: 'SUCCEEDED', checks: [], issues: [], incomplete: [] }),
            analyze: async (bytes) => {
                const facts = await analyzeMesh(decodeMesh(bytes, 'stl'))
                facts.limitations = ['x'.repeat(16 * 1048576)]
                return { executionStatus: 'SUCCEEDED', facts }
            },
            schedule: (task, signal) => queue.run(task, signal),
        },
        store,
    )
    try {
        await assert.rejects(service.verify({ uri: 'file:///workspace/model.stl' }), /exceeds the bounded evidence store/)
    } finally {
        service.dispose()
        queue.dispose()
        await store.dispose()
    }
})

test('last caller cancellation during final capture cannot populate a cached PASS', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cad-v2-final-cancel-')),
        store = new ArtifactStore(dir),
        queue = new OperationQueue()
    let captures = 0,
        executions = 0,
        release!: () => void,
        ready!: () => void
    const blocked = new Promise<void>((resolve) => {
            release = resolve
        }),
        reached = new Promise<void>((resolve) => {
            ready = resolve
        })
    const service = new MeshVerificationService(
        {
            capture: async () => {
                if (++captures === 2) {
                    ready()
                    await blocked
                }
                return capture(false)
            },
            materialize: async (source) => {
                executions++
                return { source, bytes: stl(), empty: false, executionStatus: 'SUCCEEDED', checks: [], issues: [], incomplete: [] }
            },
            analyze: async (bytes) => ({ executionStatus: 'SUCCEEDED', facts: await analyzeMesh(decodeMesh(bytes, 'stl')) }),
            schedule: (task, signal) => queue.run(task, signal),
        },
        store,
    )
    try {
        const abort = new AbortController(),
            pending = service.verify({ uri: 'file:///workspace/model.stl' }, abort.signal)
        await reached
        abort.abort()
        await assert.rejects(pending, /abort|cancel/i)
        release()
        await queue.run(async () => undefined)
        assert.equal((await service.verify({ uri: 'file:///workspace/model.stl' })).overallStatus, 'PASS')
        assert.equal(executions, 2)
    } finally {
        release()
        service.dispose()
        queue.dispose()
        await store.dispose()
    }
})
