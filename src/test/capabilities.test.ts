import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { CapabilityError, type CapabilityContext } from '../core/capabilities/CapabilityTypes'

test('capability contract preserves caller, cancellation and explicit failure identity', async () => {
    const abort = new AbortController()
    const context: CapabilityContext = { actor: 'agent', signal: abort.signal }
    const handler = (_: unknown, ctx: CapabilityContext) => {
        assert.equal(ctx.actor, 'agent')
        assert.equal(ctx.signal, abort.signal)
        throw new CapabilityError('STALE_STATE', 'Read the target again.', true)
    }
    await assert.rejects(async () => handler({}, context), (e: unknown) => e instanceof CapabilityError && e.code === 'STALE_STATE' && e.retryable)
})

import { toolFeatures, FeatureRegistry, featureCatalog } from '../ai/runtime/FeatureRegistry'
import { testDispatcher as dispatcher } from './FeatureTestSupport'
import { safePreview } from '../core/capabilities/SafeOutput'
import legacySourceApplySchema from './fixtures/customizer-source-apply-schema-v1.json'
import Ajv from 'ajv'

test('Source Apply exposes object properties to model clients without changing the accepted input contract', () => {
    const schema = toolFeatures.find(entry => entry.tool.capabilityId === 'customizer.sourceApply')!.tool.inputSchema as { type?: string; properties?: Record<string, unknown> }
    assert.equal(schema.type, 'object')
    assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), ['edits', 'identity', 'mode', 'planId', 'uri'])
    const ajv = new Ajv({ strict: true })
    const before = ajv.compile(legacySourceApplySchema)
    const after = ajv.compile(schema)
    const base = { mode: 'plan', uri: 'file:///workspace/model.scad', identity: { version: 1, sha256: 'a'.repeat(64) }, edits: [{ kind: 'annotateExisting', name: 'width', widget: 'slider', range: { min: 10, max: 100, step: 5 } }] }
    const inputs: unknown[] = [base, { mode: 'commit', planId: 'observed-plan' }, {}, null, [], 'plan',
        { ...base, mode: 'unused' }, { ...base, approved: true }, { ...base, planId: 'mixed-modes' },
        { ...base, identity: { version: '1', sha256: 'a'.repeat(64) } }, { ...base, edits: [] },
        { mode: 'commit' }, { mode: 'commit', planId: 'x', uri: base.uri },
    ]
    for (const intent of [
        { kind: 'annotateExisting', name: 'width', widget: 'slider', range: { min: 10, max: 100 } },
        { kind: 'changeWidget', name: 'width', widget: 'slider', range: { min: 10, max: 100 } },
        { kind: 'moveGroup', name: 'width', group: 'Dimensions' },
        { kind: 'hideParameter', name: 'width' },
        { kind: 'insertLiteralParameter', name: 'width', widget: 'slider', defaultValue: 40, range: { min: 10, max: 100 } },
    ]) {
        const input = { ...base, edits: [intent] }
        assert.equal(before(input), true)
        inputs.push(input, { ...input, approved: true })
    }
    assert.equal(before(base), true)
    assert.equal(after(base), true)
    for (const input of inputs) assert.equal(after(input), before(input), JSON.stringify(input))
})

test('all feature tool schemas compile strictly and preserve unique names', () => {
    assert.doesNotThrow(() => new FeatureRegistry(featureCatalog))
    assert.equal(new Set(toolFeatures.map(({ tool }) => tool.name)).size, toolFeatures.length)
})

test('schemas reject forged approval, unknown fields, missing targets, invalid enums and excessive reads', async () => {
    const d = dispatcher()
    for (const [id, input] of [
        ['runtime.remove', { id: 'x', approved: true }],
        ['customizer.set', { values: { width: 1 } }],
        ['runtime.builds', { channel: 'Latest' }],
        ['libraries.search', { limit: 1000 }],
        ['development.clearCaches', { scope: 'runtimes' }],
        ['libraries.install', { project: '/project', id: 'test' }],
    ] as const) {
        const result = await d.invoke(id, input, { actor: 'agent' })
        assert.equal(result.ok, false)
        if (!result.ok) assert.equal(result.error.code, 'INVALID_INPUT')
    }
})

test('dispatcher denies unavailable handlers even when invoked directly and preserves failed terminal state', async () => {
    let calls = 0
    const d = dispatcher(() => calls++, undefined, { trusted: () => true, availability: () => ({ enabled: false, reasonCode: 'DEVELOPMENT_ONLY' }) })
    const result = await d.invoke('development.listCaches', {}, { actor: 'agent' })
    assert.equal(result.ok, false)
    assert.equal(calls, 0)
    const failed = await dispatcher(() => { throw new CapabilityError('TARGET_CHANGED', 'Read again.', true) }).invoke('runtime.state', {}, { actor: 'agent' })
    assert.equal(failed.operation?.status, 'failed')
    if (!failed.ok) assert.equal(failed.error.code, 'TARGET_CHANGED')
})

test('running operations expose progress, cancellation reaches AbortSignal and never claims success', async () => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    const d = dispatcher((_, ctx) => new Promise((_, reject) => {
        ctx.report?.('Downloading')
        ctx.signal!.addEventListener('abort', () => reject(new CapabilityError('CANCELLED', 'Cancelled download')))
        started()
    }))
    const pending = d.invoke('runtime.installBuild', { id: 1 }, { actor: 'agent' })
    await ready
    const status = d.operations.status() as { operations: Array<{ id: string; status: string; message: string }> }
    assert.equal(status.operations[0].status, 'running')
    assert.equal(status.operations[0].message, 'Downloading')
    d.operations.cancel(status.operations[0].id)
    const result = await pending
    assert.equal(result.ok, false)
    assert.equal(result.operation?.status, 'cancelled')
})

test('cache previews redact credentials and personal identifiers, cap depth/entries/bytes, handle cycles', () => {
    const circular: Record<string, unknown> = { token: 'private', nested: { password: 'private', text: 'Bearer abc ghp_123 a@example.com' } }
    circular.self = circular
    const json = JSON.stringify(safePreview(circular))
    assert.doesNotMatch(json, /private|ghp_123|a@example.com|Bearer abc/)
    assert.match(json, /REDACTED/)
    assert.match(json, /CIRCULAR/)
    const bounded = JSON.stringify(safePreview(Array.from({ length: 1000 }, () => '中'.repeat(1000)), 100))
    assert.ok(Buffer.byteLength(bounded) < 200)
})

test('source tool schemas reject arbitrary edits, numeric strings, forged permission and mixed plan/commit fields', async () => {
    const d = dispatcher()
    const identity = { version: 1, sha256: 'a'.repeat(64) }
    const uri = 'file:///workspace/model.scad'
    const plan = { mode: 'plan', uri, identity, edits: [{ kind: 'changeWidget', name: 'width', widget: 'slider', range: { min: 0, max: 100 } }] }
    assert.equal((await d.invoke('customizer.sourceApply', plan, { actor: 'agent' })).ok, true)
    for (const input of [
        { ...plan, approved: true }, { ...plan, planId: 'x' }, { mode: 'commit', planId: 'x', uri },
        { ...plan, edits: [{ kind: 'replace', text: 'evil' }] },
        { ...plan, edits: [{ kind: 'changeWidget', name: 'width', widget: 'slider', range: { min: '0', max: 100 } }] },
        { ...plan, edits: [{ kind: 'changeWidget', name: 'width', widget: 'spinbox', step: 0 }] },
    ]) {
        const result = await d.invoke('customizer.sourceApply', input, { actor: 'agent' })
        assert.equal(result.ok, false)
        if (!result.ok) assert.equal(result.error.code, 'INVALID_INPUT')
    }
})


test('cancellation accepts exactly an Agent operation ID or a supported GUI domain', async () => {
    const d = dispatcher()
    for (const input of [{ domain: 'runtime' }, { domain: 'libraries' }, { id: 'observed-operation' }]) assert.equal((await d.invoke('operation.cancel', input, { actor: 'agent' })).ok, true)
    for (const input of [{}, { domain: 'all' }, { domain: 'runtime', id: 'operation' }, { domain: 'runtime', approved: true }]) {
        const result = await d.invoke('operation.cancel', input, { actor: 'agent' })
        assert.equal(result.ok, false)
        if (!result.ok) assert.equal(result.error.code, 'INVALID_INPUT')
    }
})

test('policy reports independent preference, dependency, Trust and availability gates', async () => {
    const { FeaturePolicyEngine } = await import('../ai/runtime/FeaturePolicyEngine.js')
    const { defaultPreferences } = await import('./FeatureTestSupport.js')
    const target = toolFeatures.find(feature => feature.tool.capabilityId === 'runtime.state')!
    const dependency = toolFeatures.find(feature => feature.tool.capabilityId === 'cad.modelAnalyze')!
    const guidance = featureCatalog.features.find(feature => feature.kind === 'skill')!
    const registry = new FeatureRegistry({ ...featureCatalog, features: featureCatalog.features.map(feature =>
        feature.id === target.id || feature.id === guidance.id ? { ...feature, dependencies: { allOf: [dependency.id] } } : feature) })
    const preferences = defaultPreferences()
    let trusted = false
    let busy = false
    const policy = new FeaturePolicyEngine(registry, () => preferences, {
        trusted: () => trusted,
        availability: feature => feature.id === target.id && busy ? { enabled: false, reasonCode: 'BUSY' } : { enabled: true },
    })
    assert.equal(policy.snapshot().state[dependency.id].reasonCode, 'UNTRUSTED_WORKSPACE')
    assert.equal(policy.snapshot().state[target.id].reasonCode, 'DISABLED_DEPENDENCY')
    assert.equal(policy.snapshot().state[target.id].environmentAvailable, true)
    trusted = true
    preferences.features[dependency.id] = false
    assert.equal(policy.snapshot().state[guidance.id].reasonCode, 'DISABLED_DEPENDENCY')
    preferences.guidanceEnabled = false
    assert.equal(policy.snapshot().state[guidance.id].reasonCode, 'DISABLED_GUIDANCE')
    preferences.features[dependency.id] = true
    busy = true
    assert.equal(policy.snapshot().state[target.id].reasonCode, 'BUSY')
    busy = false
    preferences.groups[target.group] = false
    assert.equal(policy.snapshot().state[target.id].reasonCode, 'DISABLED_GROUP')
    assert.equal(policy.snapshot().state[target.id].userPreferenceEnabled, true)
    preferences.agentEnabled = false
    assert.equal(policy.snapshot().state[target.id].reasonCode, 'DISABLED_GLOBAL')
    assert.doesNotThrow(() => policy.assertCanInvokeTool(target.tool.capabilityId, 'command'))
    assert.equal(policy.snapshot().state['setting.editor.sourceDiagnostics'].effectiveEnabled, true)
})
