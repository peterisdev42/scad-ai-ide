import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import * as vm from 'node:vm'
import { transformSync } from 'esbuild'
import { RuntimeUnavailableError } from '../../core/runtime/errors'
import type { Runtime } from '../../core/runtime/types'

function mockPreview(initialRuntime?: Runtime) {
    let active = initialRuntime
    let onRuntimeChanged!: () => void
    let refreshes = 0
    let state = { busy: false, selectingId: undefined as string | undefined, installing: undefined as object | undefined, deletingId: undefined as string | undefined }
    const disposable = { dispose() {} }
    const module = { exports: {} as { registerPreview: (context: unknown, runtime: unknown, customizer: unknown) => unknown } }
    const source = readFileSync(new URL('../../features/preview/registerPreview.ts', import.meta.url), 'utf8')
    vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
        module,
        require: (id: string) => {
            if (id === 'vscode')
                return {
                    window: { registerCustomEditorProvider: () => disposable },
                    workspace: { onDidChangeConfiguration: () => disposable },
                }
            if (id.endsWith('/runtime/errors')) return { RuntimeUnavailableError }
            if (id.endsWith('/ScadSessionManager'))
                return {
                    ScadSessionManager: class {
                        refresh() {
                            refreshes++
                        }
                    },
                }
            if (id.endsWith('/ScadClient')) return { ScadClient: { configure() {}, outputChannel: disposable } }
            if (id.endsWith('/ScadPreviewEditorProvider')) return { ScadPreviewEditorProvider: class {} }
            if (id.endsWith('/showPanel')) return { registerShowPanelCommand: () => disposable, previewEditorViewType: 'preview' }
            throw new Error(`Unexpected dependency: ${id}`)
        },
    })
    module.exports.registerPreview(
        { subscriptions: [] },
        {
            getActiveRuntime: () => active,
            getState: () => state,
            onDidChange: (listener: () => void) => {
                onRuntimeChanged = listener
                return disposable
            },
        },
        {},
    )
    return {
        refreshes: () => refreshes,
        update: (runtime: Runtime | undefined, changes: Partial<typeof state> = {}) => {
            active = runtime
            state = { ...state, ...changes }
            onRuntimeChanged()
        },
    }
}

const installed: Runtime = { id: 'managed', version: '2026.10.28', source: 'managed', command: { executable: '/managed/bin/openscad', argsPrefix: [] }, platform: 'linux', status: 'available' }

test('opening Runtime or refreshing release lists does not rerender an unchanged or missing Runtime', () => {
    for (const active of [undefined, installed]) {
        const mock = mockPreview(active)
        // Release loading emits multiple idle updates; an unchanged local scan does too.
        mock.update(active)
        mock.update(active)
        mock.update(active, { busy: true })
        mock.update(active, { busy: false })
        assert.equal(mock.refreshes(), 0)
    }
})

test('Runtime discovery, switching and removal refresh previews once after settling', () => {
    const mock = mockPreview()
    mock.update(installed, { busy: true })
    assert.equal(mock.refreshes(), 0)
    mock.update(installed, { busy: false })
    assert.equal(mock.refreshes(), 1)
    const next = { ...installed, id: 'next', command: { executable: '/next/bin/openscad', argsPrefix: ['--prefix'] } }
    mock.update(next, { selectingId: next.id })
    assert.equal(mock.refreshes(), 1)
    mock.update(next, { selectingId: undefined })
    assert.equal(mock.refreshes(), 2)
    mock.update(undefined, { deletingId: next.id })
    assert.equal(mock.refreshes(), 2)
    mock.update(undefined, { deletingId: undefined })
    mock.update(undefined)
    assert.equal(mock.refreshes(), 3)
})

test('reinstalling the same active Runtime retries rendering once, without retrying missing-Runtime errors', () => {
    for (const active of [installed, undefined]) {
        const mock = mockPreview(active)
        mock.update(active, { installing: {} })
        mock.update(active, { installing: {}, busy: true })
        mock.update(active, { installing: undefined, busy: false })
        mock.update(active)
        assert.equal(mock.refreshes(), active ? 1 : 0)
    }
})
