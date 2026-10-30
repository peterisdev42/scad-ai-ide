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

function panelFixture() {
    const messages: ExtensionToWebviewMessage[] = []
    const notices: Error[] = []
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
        require: (id: string) => {
            if (id.endsWith('/platform/notifications')) return { notifications: { previewError: (error: Error) => notices.push(error) } }
            if (id.endsWith('/renderError')) return { showRenderError: (error: Error) => notices.push(error) }
            if (id.endsWith('/renderDiagnostics')) return { syntaxErrorMessage }
            if (id.endsWith('/previewEligibility')) return { EmptyModelError }
            if (id.endsWith('/ScadClient')) return { ScadClient: {} }
            if (id.endsWith('/ModelFormat')) return { ModelFormat }
            if (id === 'vscode') return { Uri: { joinPath: (...parts: string[]) => parts.join('/') } }
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
        documentUri: { toString: () => 'file:///models/cube(20).scad' },
        onRenderStarted: (listener: typeof start) => {
            start = listener
        },
        onRenderCompleted: (listener: typeof complete) => {
            complete = listener
        },
        onRenderError: (listener: typeof fail) => {
            fail = listener
        },
        onParametersChanged: () => disposable,
        onLog: () => disposable,
    }
    new module.exports.ScadWebviewPanel(panel as never, '/extension' as never, session as never, { get: () => null } as never)
    return { messages, notices, ready: () => ready({ type: 'ready' }), start: () => start(), complete: () => complete({ buffer: Buffer.from('model'), format: ModelFormat.STL }), fail: (error: Error) => fail(error) }
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
