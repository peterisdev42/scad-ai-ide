import Ajv from 'ajv'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const reportSchema = JSON.parse(readFileSync(join(process.cwd(), 'resources/schemas/cad-report-v1.schema.json'), 'utf8'))
import assert from 'node:assert/strict'
import test from 'node:test'
import { createVerificationReport } from '../../core/cad/report'
import { digest, identifySnapshot, verdict } from '../../core/cad/snapshot'
import { normalizeCliDiagnostics, BoundedCliLog } from '../../core/cad/diagnostics'
import { ReportStore } from '../../core/cad/ReportStore'
import { SharedTasks } from '../../core/cad/SharedTasks'
import { CadVerificationService } from '../../core/cad/CadVerificationService'
import type { CadExecutionResult, CadInputs, CheckStatus, VerificationCheck } from '../../core/cad/types'

const check = (status: CheckStatus, required = true): VerificationCheck => ({ id: status, category: 'compile', status, required, issueIds: [] })
function inputs(text = 'cube(1);', dependencyPaths: string[] = [], dirty = false): CadInputs {
    return { path: '/workspace/model.scad', text, command: { executable: '/cli', argsPrefix: [] }, env: {}, parameters: {}, hasGeometry: true, snapshot: identifySnapshot({ schemaVersion: 1, document: { uri: 'file:///workspace/model.scad', sourceSha256: digest(text), dirty: false, version: 1 }, project: { rootUri: 'file:///workspace', libraryEnvironmentHash: 'lib' }, dependencies: dependencyPaths.map((path) => ({ uri: `file://${path}`, sha256: digest(path), status: 'resolved', dirty })), runtime: { executable: '/cli', version: 'test', identityHash: 'cli', capabilityHash: 'help', hostPlatform: 'test' }, parameters: { overrides: {}, digest: digest({}) }, evaluation: { mode: 'csg', sourceTransport: 'stdin', exportFormat: 'csg', settingsHash: 'settings' }, constraintsDigest: 'none', kernelVersion: 'diagnostics-v1', complete: !dirty, unresolvedInputs: dirty ? ['DIRTY_DEPENDENCY_NOT_EVALUATED'] : [] }) }
}
const result = (overrides: Partial<CadExecutionResult> = {}): CadExecutionResult => ({ status: 'SUCCEEDED', exitCode: 0, content: Buffer.from('cube(1);'), dependencies: [], dependenciesComplete: true, log: '', truncated: false, diagnostics: [], elapsedMs: 1, empty: false, ...overrides })

test('verdict never promotes missing, interrupted, partial or skipped checks to PASS', () => {
    assert.equal(verdict('SUCCEEDED', [], true), 'UNRESOLVED')
    assert.equal(verdict('SUCCEEDED', [check('PASS', false)], true), 'UNRESOLVED')
    assert.equal(verdict('SUCCEEDED', [check('PASS')], false), 'UNRESOLVED')
    for (const state of ['FAILED', 'CANCELLED', 'TIMED_OUT'] as const) assert.notEqual(verdict(state, [check('PASS')], true), 'PASS')
    assert.equal(verdict('SUCCEEDED', [check('SKIPPED')], true), 'SKIPPED')
    assert.equal(verdict('SUCCEEDED', [check('UNRESOLVED'), check('SKIPPED')], true), 'UNRESOLVED')
    assert.equal(verdict('FAILED', [check('UNRESOLVED'), check('FAIL')], false), 'FAIL')
    assert.equal(verdict('SUCCEEDED', [check('PASS'), check('FAIL', false)], true), 'PASS')
})
test('snapshot identities include actual inputs and ignore host-only version/dirty metadata', () => {
    const first = inputs().snapshot
    assert.equal(digest({ a: 1, b: [2, 3] }), digest({ b: [2, 3], a: 1 }))
    assert.equal(first.id, identifySnapshot({ ...first, document: { ...first.document, version: 99, dirty: true } }).id)
    for (const modified of [
        { ...first, project: { ...first.project, rootUri: 'file:///other' } },
        { ...first, runtime: { ...first.runtime, identityHash: 'new' } },
        { ...first, constraintsDigest: 'changed' },
        { ...first, parameters: { overrides: { width: 2 }, digest: 'changed' } },
        { ...first, dependencies: [{ uri: 'file:///lib.scad', status: 'resolved' as const, sha256: 'hash', dirty: false }] },
    ])
        assert.notEqual(first.id, identifySnapshot(modified).id)
})
test('CLI parsing preserves Windows/Unicode paths, actual severity and TRACE provenance', () => {
    const diagnostics = normalizeCliDiagnostics('ERROR: Assertion false failed in file C:\\模型\\part.scad, line 7\nTRACE: called by box in file main.scad, line 2\nWARNING: Ignoring unknown module missing in file - , line 3\nECHO: hello', 0)
    assert.equal(diagnostics[0].code, 'SCAD_CLI_ASSERT_FAILED')
    assert.equal(diagnostics[0].file, 'C:\\模型\\part.scad')
    assert.equal(diagnostics[0].line, 6)
    assert.equal(diagnostics[0].trace.length, 1)
    assert.equal(diagnostics[1].severity, 'warning')
    assert.equal(diagnostics[1].incomplete, true)
    assert.equal(normalizeCliDiagnostics('native crash', 3)[0].code, 'SCAD_CLI_UNCLASSIFIED_ERROR')
})
test('streaming logs keep split middle errors and remain bounded under output floods', () => {
    const log = new BoundedCliLog()
    log.append('noise\n'.repeat(50000))
    log.append('ERR')
    log.append('OR: assertion failed in file -, line 3\n')
    log.append('noise\n'.repeat(50000))
    assert.ok(log.text.length < 100000)
    assert.equal(log.truncated, true)
    assert.equal(normalizeCliDiagnostics(log.text, 0).find((d) => d.severity === 'error')?.line, 2)
})
test('shared tasks isolate subscriber cancellation and abort the last abandoned task', async () => {
    const shared = new SharedTasks<number>(),
        one = new AbortController(),
        two = new AbortController()
    let release!: (v: number) => void,
        called = 0,
        taskSignal!: AbortSignal
    const task = (signal: AbortSignal) => {
        called++
        taskSignal = signal
        return new Promise<number>((resolve) => {
            release = resolve
        })
    }
    const a = shared.run('same', task, one.signal),
        b = shared.run('same', task, two.signal)
    await Promise.resolve()
    one.abort()
    await assert.rejects(a, /cancelled/i)
    assert.equal(taskSignal.aborted, false)
    release(9)
    assert.equal(await b, 9)
    assert.equal(called, 1)
    const abort = new AbortController()
    const abandoned = shared.run('next', (signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('task aborted')))), abort.signal)
    await Promise.resolve()
    abort.abort()
    await assert.rejects(abandoned, /cancelled/i)
    shared.dispose()
})
test('analysis discovers dependencies then reexecutes against their content snapshot and reuses complete evidence', async () => {
    let calls = 0
    const service = new CadVerificationService({
        capture: async (_uri, deps) => inputs('cube(1);', deps),
        execute: async () => {
            calls++
            return result({ dependencies: ['/workspace/lib.scad'] })
        },
        locate: async () => undefined,
    })
    try {
        const first = await service.analyze({ uri: 'file:///workspace/model.scad' })
        const validate = new Ajv({ strict: true }).compile(reportSchema)
        assert.equal(validate(first), true, JSON.stringify(validate.errors))
        assert.equal(validate({ ...first, overallStatus: 'UNKNOWN' }), false)
        assert.equal(calls, 2)
        assert.equal(first.overallStatus, 'PASS')
        assert.equal(first.snapshot.dependencies.length, 1)
        const again = await service.analyze({ uri: 'file:///workspace/model.scad' })
        assert.equal(again.reportId, first.reportId)
        assert.equal(calls, 2)
        assert.ok(Object.isFrozen(first.snapshot.document))
        const store = new ReportStore(1)
        store.put(first, 'a')
        store.put({ ...first, reportId: 'other' }, 'b')
        assert.equal(store.get(first.reportId), undefined)
        assert.equal(store.get('other')?.log, 'b')
    } finally {
        service.dispose()
    }
})
test('dirty include, missing dependencies and truncated evidence never produce PASS', async () => {
    for (const scenario of ['dirty', 'missing', 'truncated'] as const) {
        const service = new CadVerificationService({ capture: async (_uri, deps) => inputs('cube(1);', deps, scenario === 'dirty' && !!deps.length), execute: async () => result({ dependencies: ['/workspace/lib.scad'], dependenciesComplete: scenario !== 'missing', truncated: scenario === 'truncated' }), locate: async () => undefined })
        try {
            const report = await service.analyze({ uri: 'file:///workspace/model.scad' })
            assert.equal(report.overallStatus, 'UNRESOLVED', scenario)
        } finally {
            service.dispose()
        }
    }
})
test('old completion and expectedSnapshot mismatch cannot certify current source', async () => {
    let source = 'cube(1);',
        release!: (value: CadExecutionResult) => void
    const service = new CadVerificationService({
        capture: async () => inputs(source),
        execute: () =>
            new Promise((resolve) => {
                release = resolve
            }),
        locate: async () => undefined,
    })
    try {
        await assert.rejects(service.analyze({ uri: 'file:///workspace/model.scad', expectedSnapshotId: 'wrong' }), /Expected snapshot/)
        const pending = service.analyze({ uri: 'file:///workspace/model.scad' })
        for (let i = 0; i < 10 && !release; i++) await Promise.resolve()
        source = 'cube(2);'
        service.invalidate('file:///workspace/model.scad')
        release(result())
        await assert.rejects(pending, /historical/)
    } finally {
        service.dispose()
    }
})
test('exit-zero ERROR is FAIL, ordinary warnings stay warnings, unsafe locations fall back', async () => {
    const service = new CadVerificationService({ capture: async () => inputs(), execute: async () => result({ status: 'FAILED', diagnostics: [{ code: 'SCAD_CLI_ASSERT_FAILED', message: 'assertion failed', severity: 'error', trace: [], file: '/private/unknown.scad', line: 9 }] }), locate: async () => undefined })
    try {
        const report = await service.analyze({ uri: 'file:///workspace/model.scad' })
        assert.equal(report.overallStatus, 'FAIL')
        assert.equal(report.issues[0].location?.confidence, 'fallback')
        assert.equal(report.issues[0].location?.line, 0)
    } finally {
        service.dispose()
    }
})

test('twenty simultaneous consumers of the same snapshot perform one evaluation', async () => {
    let calls = 0
    const service = new CadVerificationService({
        capture: async () => inputs(),
        execute: async () => {
            calls++
            await new Promise((r) => setTimeout(r, 10))
            return result()
        },
        locate: async () => undefined,
    })
    try {
        const reports = await Promise.all(Array.from({ length: 20 }, () => service.analyze({ uri: 'file:///workspace/model.scad' })))
        assert.equal(calls, 1)
        assert.equal(new Set(reports.map((r) => r.reportId)).size, 1)
    } finally {
        service.dispose()
    }
})
test('changing a dependency graph on its second evaluation remains unresolved', async () => {
    let calls = 0
    const service = new CadVerificationService({ capture: async (_uri, deps) => inputs('cube(1);', deps), execute: async () => result({ dependencies: [++calls === 1 ? '/workspace/a.scad' : '/workspace/b.scad'] }), locate: async () => undefined })
    try {
        const report = await service.analyze({ uri: 'file:///workspace/model.scad' })
        assert.equal(report.overallStatus, 'UNRESOLVED')
        assert.ok(report.incomplete.includes('DEPENDENCIES_CHANGED_DURING_ANALYSIS'))
        assert.equal(calls, 2)
    } finally {
        service.dispose()
    }
})
test('content changed and restored during execution cannot enter the green cache', async () => {
    let stamp = 'before'
    const service = new CadVerificationService({
        capture: async () => ({ ...inputs(), fileStamps: { '/workspace/lib.scad': stamp } }),
        execute: async () => {
            stamp = 'after'
            return result()
        },
        locate: async () => undefined,
    })
    try {
        await assert.rejects(service.analyze({ uri: 'file:///workspace/model.scad' }), /historical/)
        assert.equal(service.reports.all().length, 0)
    } finally {
        service.dispose()
    }
})
test('a middle ERROR survives the separate warning-retention budget', () => {
    const log = new BoundedCliLog()
    log.append(Array.from({ length: 150 }, (_, i) => `WARNING: ${i}\n`).join(''))
    log.append('ERROR: important failure\n')
    log.append('normal output\n'.repeat(10000))
    assert.ok(normalizeCliDiagnostics(log.text, 0).some((d) => d.message === 'ERROR: important failure'))
    assert.equal(log.truncated, true)
})

test('stdin and disk compiler messages project the same trusted semantic issue title', async () => {
    const input = inputs()
    const a = await createVerificationReport(input, result({ diagnostics: [{ code: 'ASSERT', message: 'ERROR: Assertion failed in file <stdin>, line 1', severity: 'error', file: '<stdin>', line: 0, trace: [] }] }), [], async () => undefined)
    const b = await createVerificationReport(input, result({ diagnostics: [{ code: 'ASSERT', message: 'ERROR: Assertion failed in file model.scad, line 1', severity: 'error', file: 'model.scad', line: 0, trace: [] }] }), [], async () => undefined)
    assert.equal(a.issues[0].title, b.issues[0].title)
    assert.deepEqual(a.issues[0].location, b.issues[0].location)
})

test('immutable reports clone caller-owned vectors rather than freezing Customizer state', async () => {
    const vector = [1, 2, 3], input = inputs()
    input.parameters.vector = vector
    input.snapshot = identifySnapshot({ ...input.snapshot, parameters: { overrides: { vector }, digest: digest({ vector }) } })
    const service = new CadVerificationService({ capture: async () => input, execute: async () => result(), locate: async () => undefined })
    try {
        const report = await service.analyze({ uri: input.snapshot.document.uri })
        assert.equal(Object.isFrozen(vector), false)
        vector[0] = 9
        assert.deepEqual(report.snapshot.parameters.overrides.vector, [1, 2, 3])
        assert.equal(Object.isFrozen(report.snapshot.parameters.overrides.vector), true)
    } finally { service.dispose() }
})
