import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { CapabilityError, type CapabilityContext, type CapabilityHandler } from '../core/capabilities/CapabilityTypes'

test('capability contract preserves caller, cancellation and explicit failure identity', async () => {
    const abort = new AbortController()
    const context: CapabilityContext = { actor: 'agent', signal: abort.signal }
    const handler: CapabilityHandler = {
        available: () => ({ enabled: true }),
        invoke: (_, ctx) => {
            assert.equal(ctx.actor, 'agent')
            assert.equal(ctx.signal, abort.signal)
            throw new CapabilityError('STALE_STATE', 'Read the target again.', true)
        },
    }
    await assert.rejects(async () => handler.invoke({}, context), (e: unknown) => e instanceof CapabilityError && e.code === 'STALE_STATE' && e.retryable)
})

import { capabilityCatalog, CapabilityRegistry } from '../core/capabilities/CapabilityRegistry'
import { CapabilityDispatcher } from '../core/capabilities/CapabilityDispatcher'
import { safePreview } from '../core/capabilities/SafeOutput'

function dispatcher(invoke: CapabilityHandler['invoke'] = (input) => input) {
    const registry = new CapabilityRegistry()
    for (const d of capabilityCatalog) registry.bind(d.id, { available: () => ({ enabled: true }), invoke })
    registry.assertComplete()
    return new CapabilityDispatcher(registry)
}

test('all catalog schemas compile strictly, completeness and duplicate bindings are enforced', () => {
    const registry = new CapabilityRegistry()
    assert.throws(() => registry.assertComplete(), /Missing/)
    registry.bind('runtime.state', { available: () => ({ enabled: true }), invoke: () => ({}) })
    assert.throws(() => registry.bind('runtime.state', { available: () => ({ enabled: true }), invoke: () => ({}) }), /duplicate/)
    assert.equal(new Set(capabilityCatalog.map((d) => d.toolName)).size, capabilityCatalog.length)
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
    const registry = new CapabilityRegistry()
    let calls = 0
    registry.bind('development.listCaches', { available: () => ({ enabled: false, reasonCode: 'DEVELOPMENT_ONLY' }), invoke: () => calls++ })
    const result = await new CapabilityDispatcher(registry).invoke('development.listCaches', {}, { actor: 'agent' })
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
