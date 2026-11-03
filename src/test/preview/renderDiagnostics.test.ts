import { readCsgPartHints } from '../../core/preview/csgParts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as vm from 'node:vm'
import { transformSync } from 'esbuild'
import { syntaxErrorMessage } from '../../features/preview/extension/services/renderDiagnostics'
import { EmptyModelError } from '../../features/preview/extension/services/previewEligibility'
import { ModelFormat } from '../../features/preview/shared/types/ModelFormat'
import type { ScadWebviewPanel } from '../../features/preview/extension/views/ScadWebviewPanel'
import type { ExtensionToWebviewMessage } from '../../features/preview/shared/types/ExtensionToWebviewMessage'

const parserError = new Error("OpenSCAD exited with code 1\nERROR: Parser error: syntax error in file cube(20).scad, line 2\nCan't parse file '/models/cube(20).scad'!\n")

test('syntax diagnostics retain the file and line without CLI output noise', () => {
    assert.equal(syntaxErrorMessage(parserError), 'Syntax error in file cube(20).scad, line 2')
    assert.equal(syntaxErrorMessage(new Error('Parser error: line 3')), 'Syntax error: line 3')
    for (const message of ['ERROR: assertion failed', 'No OpenSCAD runtime is available.', 'OpenSCAD exited with code 1', 'Current top level object is empty.']) {
        assert.equal(syntaxErrorMessage(new Error(message)), undefined)
    }
})

function panelFixture(render: (...args: unknown[]) => Promise<Buffer> = async () => Buffer.from('color([1,0,0,1]){cube(size=1);}')) {
    const messages: ExtensionToWebviewMessage[] = []
    const notices: Error[] = []
    const timings: unknown[] = [],
        frames: unknown[] = []
    let ready!: (message: { type: 'ready' }) => void
    let start!: () => void
    let complete!: (result: { buffer: Buffer; format: ModelFormat }) => void
    let fail!: (error: Error) => void
    const disposable = { dispose() {} }
    const module = { exports: {} as { ScadWebviewPanel: typeof ScadWebviewPanel } }
    const require = createRequire(import.meta.url)
    const source = readFileSync(new URL('../../features/preview/extension/views/ScadWebviewPanel.ts', import.meta.url), 'utf8')
    vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
        module,
        performance,
        AbortController,
        AbortSignal,
        require: (id: string) => {
            if (id.endsWith('/formats/meshTopology')) return { queryMeshTopology: async () => ({ version: 1, meshes: [] }) }
            if (id.endsWith('/platform/notifications')) return { notifications: { previewError: (error: Error) => notices.push(error) } }
            if (id.endsWith('/renderError')) return { showRenderError: (error: Error) => notices.push(error) }
            if (id.endsWith('/renderDiagnostics')) return { syntaxErrorMessage }
            if (id.endsWith('/previewEligibility')) return { EmptyModelError }
            if (id.endsWith('/ScadClient')) return { ScadClient: { render } }
            if (id.endsWith('/preview/csgParts')) return { readCsgPartHints }
            if (id.endsWith('/ModelFormat')) return { ModelFormat }
            if (id === 'vscode') return { Uri: { joinPath: (...parts: string[]) => parts.join('/') }, workspace: { isTrusted: true } }
            return require(id)
        },
    })
    const panel = {
        webview: {
            asWebviewUri: (uri: string) => uri,
            postMessage: (message: ExtensionToWebviewMessage) => messages.push(message),
            onDidReceiveMessage: (listener: typeof ready) => {
                ready = listener
            },
        },
        onDidDispose: () => disposable,
    }
    const session = {
        documentUri: { fsPath: '/models/cube(20).scad', toString: () => 'file:///models/cube(20).scad' },
        onRenderStarted: (listener: typeof start) => {
            start = listener
        },
        onRenderCompleted: (listener: typeof complete) => {
            complete = listener
        },
        onRenderError: (listener: typeof fail) => {
            fail = listener
        },
        acceptPerformance: (value: unknown) => timings.push(value),
        acceptFrame: (...values: unknown[]) => frames.push(values),
        onParametersChanged: () => disposable,
        onLog: () => disposable,
    }
    new module.exports.ScadWebviewPanel(panel as never, '/extension' as never, session as never, { get: () => null } as never)
    return { messages, notices, timings, frames, receive: (message: unknown) => ready(message as never), ready: () => ready({ type: 'ready' }), start: () => start(), complete: () => complete({ buffer: Buffer.from('model'), format: ModelFormat.STL }), fail: (error: Error) => fail(error) }
}

test('syntax failures replace stale models with a persistent centered message and recover after a successful render', () => {
    const mock = panelFixture()
    mock.ready()
    mock.complete()
    mock.fail(parserError)
    assert.equal(mock.messages.at(-1)?.type, 'renderError')
    assert.equal(mock.notices.length, 0)
    mock.messages.length = 0
    mock.ready()
    assert.deepEqual(
        mock.messages.map((message) => message.type),
        ['loadScene', 'renderError'],
    )
    assert.equal((mock.messages.at(-1) as { message: string }).message, 'Syntax error in file cube(20).scad, line 2')
    mock.start()
    assert.equal(mock.messages.at(-1)?.type, 'loadingState')
    mock.complete()
    mock.messages.length = 0
    mock.ready()
    assert.deepEqual(
        mock.messages.map((message) => message.type),
        ['loadScene', 'update'],
    )
})

test('syntax failures before webview readiness are replayed, while empty models and other errors keep their handling', () => {
    const mock = panelFixture()
    mock.fail(parserError)
    mock.messages.length = 0
    mock.ready()
    assert.equal(mock.messages.at(-1)?.type, 'renderError')
    mock.fail(new EmptyModelError())
    assert.equal(mock.messages.at(-1)?.type, 'emptyModel')
    assert.equal(mock.notices.length, 0)
    const error = new Error('ERROR: assertion failed')
    mock.fail(error)
    assert.deepEqual(mock.notices, [error])
})

test('a superseded canvas cannot overwrite timings or acknowledge the next host request', () => {
    const mock = panelFixture()
    mock.ready()
    mock.complete()
    mock.timings.length = 0
    const first = mock.messages.find((m) => m.type === 'update') as { modelVersion: number }
    const profile = (version: number) => mock.receive({ type: 'previewPerformance', modelVersion: version, timings: { shaderMs: 1.25 } })
    const frame = (version: number) => mock.receive({ type: 'frameReady', modelVersion: version, graphics: 'webgpu', elapsedMs: 12 })
    profile(first.modelVersion)
    frame(first.modelVersion)
    assert.equal(mock.timings.length, 1)
    assert.equal(mock.frames.length, 1)
    mock.start()
    profile(first.modelVersion)
    frame(first.modelVersion)
    assert.equal(mock.timings.length, 1)
    assert.equal(mock.frames.length, 1)
    mock.complete()
    mock.timings.length = 1
    profile(first.modelVersion)
    frame(first.modelVersion)
    assert.equal(mock.timings.length, 1)
    profile(first.modelVersion + 1)
    frame(first.modelVersion + 1)
    assert.equal(mock.timings.length, 2)
    assert.equal(mock.frames.length, 2)
})

test('CSG is exported only when requested, cached for the current model and invalidated after a new render', async () => {
    const calls: unknown[][] = []
    const mock = panelFixture(async (...args) => {
        calls.push(args)
        return Buffer.from('color([1,0,0,1]){cube(size=1);}')
    })
    mock.ready()
    mock.complete()
    assert.equal(calls.length, 0)
    const version = (mock.messages.find((m) => m.type === 'update') as { modelVersion: number }).modelVersion
    await mock.receive({ type: 'setPartColors', enabled: true, modelVersion: version })
    assert.equal(calls.length, 1)
    assert.equal(calls[0][2], 'csg')
    assert.equal((calls[0][1] as Record<string, boolean>)['$preview'], false)
    assert.equal(mock.messages.at(-1)?.type, 'partHints')
    await mock.receive({ type: 'setPartColors', enabled: false, modelVersion: version })
    await mock.receive({ type: 'setPartColors', enabled: true, modelVersion: version })
    assert.equal(calls.length, 1)
    mock.start()
    await mock.receive({ type: 'setPartColors', enabled: true, modelVersion: version })
    assert.equal(calls.length, 1)
    mock.complete()
    await mock.receive({ type: 'setPartColors', enabled: true, modelVersion: version + 1 })
    assert.equal(calls.length, 2)
})

test('obsolete CSG responses are discarded and in-flight exports abort when the model starts changing', async () => {
    let finish!: (buffer: Buffer) => void
    let signal!: AbortSignal
    let calls = 0
    const mock = panelFixture((...args) => {
        calls++
        signal = args[6] as AbortSignal
        return new Promise((resolve) => {
            finish = resolve
        })
    })
    mock.ready()
    mock.complete()
    const version = (mock.messages.find((m) => m.type === 'update') as { modelVersion: number }).modelVersion
    const pending = mock.receive({ type: 'setPartColors', enabled: true, modelVersion: version })
    await mock.receive({ type: 'setPartColors', enabled: true, modelVersion: version })
    assert.equal(calls, 1)
    mock.start()
    assert.equal(signal.aborted, true)
    finish(Buffer.from('cube(size=1);'))
    await pending
    assert.equal(mock.messages.filter((m) => m.type === 'partHints').length, 0)
})

test('failed CSG assistance quietly falls back and is not repeatedly exported on camera updates or retoggles', async () => {
    let calls = 0
    const mock = panelFixture(async () => {
        calls++
        throw new Error('CLI unavailable')
    })
    mock.ready()
    mock.complete()
    const version = (mock.messages.find((m) => m.type === 'update') as { modelVersion: number }).modelVersion
    await mock.receive({ type: 'setPartColors', enabled: true, modelVersion: version })
    const result = mock.messages.at(-1)
    assert.equal(result?.type, 'partHints')
    assert.equal((result as { hints: unknown[] }).hints.length, 0)
    await mock.receive({ type: 'setPartColors', enabled: true, modelVersion: version })
    assert.equal(calls, 1)
    assert.equal(mock.notices.length, 0)
})
