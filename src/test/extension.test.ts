import * as assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import * as vscode from 'vscode'
import type { activate } from '../extension'
import { QuickAccessTreeProvider, quickAccess } from '../features/sidebar/QuickAccessTreeProvider'
import { CustomizerViewProvider } from '../features/sidebar/CustomizerViewProvider'
import { CustomizerService } from '../core/customizer/CustomizerService'

suite('SCAD AI IDE integration', () => {
    async function api() {
        const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')
        assert.ok(extension)
        return (await extension.activate()) as Awaited<ReturnType<typeof activate>>
    }

    test('registers native Quick Access and an HTML Customizer with five plain navigation items', async () => {
        await api()
        const manifest = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')!.packageJSON
        assert.deepEqual(
            manifest.contributes.views['scad-ai-ide'].map((view: { name: string }) => view.name),
            ['Quick Access', 'Customizer'],
        )
        assert.equal(manifest.contributes.views['scad-ai-ide'][1].type, 'webview')
        await vscode.commands.executeCommand('scad-ai.quickAccess.focus')
        const tree = new QuickAccessTreeProvider()
        const items = tree.getChildren()
        assert.deepEqual(
            items.map((item) => item.label),
            ['AI', 'Bricks', 'Libraries', 'Runtime', 'More'],
        )
        assert.deepEqual(
            items.map((item) => item.command?.command),
            quickAccess.map((page) => page.command),
        )
        for (const item of items) {
            assert.equal(item.iconPath, undefined)
            assert.equal(item.description, undefined)
            assert.deepEqual(tree.getChildren(item), [])
        }
    })

    test('panel navigation reuses tabs without creating editor groups', async () => {
        const extension = await api()
        const groupCount = vscode.window.tabGroups.all.length
        try {
            for (const page of quickAccess) {
                await vscode.commands.executeCommand(page.command)
                const panel = extension.panels.getPanel(page.id)
                assert.ok(panel)
                assert.match(panel.webview.html, /Content-Security-Policy/)
                assert.match(panel.webview.html, /script-src 'nonce-/)
                assert.ok(!panel.webview.html.includes('{{'))
                assert.equal(panel.title, page.title)
                await vscode.commands.executeCommand(page.command)
                assert.equal(extension.panels.getPanel(page.id), panel)
                assert.equal(vscode.window.tabGroups.all.length, groupCount)
            }
            const panel = extension.panels.getPanel('ai')!
            panel.dispose()
            await vscode.commands.executeCommand('scad-ai.ai.open')
            assert.notEqual(extension.panels.getPanel('ai'), panel)
        } finally {
            for (const page of quickAccess) {
                extension.panels.getPanel(page.id)?.dispose()
            }
        }
    })

    test('customizer follows SCAD files, retains target after focus changes and toggles overrides without editing source', async () => {
        const extension = await api()
        assert.equal(extension.customizer.target, undefined)
        const first = await vscode.workspace.openTextDocument({ language: 'openscad', content: '/* [Geometry] */\nwidth = 40; // [10:100]\nhollow = true;\n' })
        await vscode.window.showTextDocument(first)
        assert.equal(extension.customizer.target, first.uri.toString())
        extension.customizer.set('hollow', false)
        assert.deepEqual(extension.getRenderArguments(), ['-D', 'hollow=false'])
        assert.equal(first.getText().includes('hollow = true'), true)
        const second = await vscode.workspace.openTextDocument({ language: 'openscad', content: 'height = 20;\n' })
        await vscode.window.showTextDocument(second)
        assert.equal(extension.customizer.target, second.uri.toString())
        assert.deepEqual(extension.getRenderArguments(), [])
        await vscode.window.showTextDocument(first)
        assert.deepEqual(extension.getRenderArguments(), ['-D', 'hollow=false'])
        await vscode.commands.executeCommand('scad-ai.runtime.open')
        assert.equal(extension.customizer.target, first.uri.toString())
        extension.panels.getPanel('runtime')?.dispose()
    })

    test('HTML Customizer validates messages and rejects edits from a stale document', async () => {
        const service = new CustomizerService()
        const provider = new CustomizerViewProvider(service, vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')!.extensionUri)
        const messages: any[] = []
        let receive!: (message: unknown) => void
        const disposable = { dispose() {} }
        const webview = {
            options: {} as vscode.WebviewOptions,
            html: '',
            cspSource: 'vscode-webview:',
            asWebviewUri: (uri: vscode.Uri) => uri,
            postMessage: (message: unknown) => {
                messages.push(message)
                return Promise.resolve(true)
            },
            onDidReceiveMessage: (handler: typeof receive) => {
                receive = handler
                return disposable
            },
        }
        try {
            provider.resolveWebviewView({ webview, onDidChangeVisibility: () => disposable, onDidDispose: () => disposable } as unknown as vscode.WebviewView)
            assert.match(webview.html, /Content-Security-Policy/)
            assert.match(webview.html, /script-src 'nonce-/)
            assert.match(webview.html, /role="tree"/)
            assert.match(webview.html, /role="tooltip"/)
            assert.match(webview.html, /dist\/customizer\.js/)
            assert.match(webview.html, /dist\/customizer\.css/)
            assert.match(webview.html, /id="scroll-host"/)
            assert.equal(webview.options.localResourceRoots?.length, 2)
            service.load('first.scad', 'size = [1, 2]; // [0:10]')
            receive({ type: 'ready' })
            const first = messages.at(-1)
            receive({ type: 'set', target: first.target, revision: first.revision - 1, name: 'size', value: [7, 8] })
            assert.deepEqual(service.getOverrides('first.scad'), {})
            receive({ type: 'set', target: first.target, revision: first.revision, name: 'size', value: [3, 4] })
            assert.deepEqual(service.getOverrides('first.scad'), { size: [3, 4] })
            receive({ type: 'set', target: first.target, revision: first.revision, name: 'size', value: [3, 'unsafe'] })
            assert.equal(messages.at(-1).type, 'error')
            service.load('second.scad', 'size = [1, 2];')
            receive({ type: 'set', target: first.target, revision: first.revision, name: 'size', value: [7, 8] })
            assert.deepEqual(service.getOverrides('second.scad'), {})
            const second = messages.at(-1)
            receive({ type: 'set', target: second.target, revision: second.revision, name: 'size', value: [5, 6] })
            receive({ type: 'reset', target: second.target, revision: second.revision })
            assert.deepEqual(service.getOverrides('second.scad'), {})
        } finally {
            provider.dispose()
        }
    })

    test('configuration selects a validated runtime and rejects invalid overrides', async function () {
        if (process.platform === 'win32') {
            this.skip()
        }
        const runtimeApi = await api()
        const directory = await mkdtemp(path.join(os.tmpdir(), 'scad-integration-'))
        const file = path.join(directory, 'test openscad')
        const configuration = vscode.workspace.getConfiguration('scad-ai-ide')
        const previousPath = configuration.inspect<string>('openscadPath')?.globalValue
        const previousCommand = configuration.inspect('runtimeCommand')?.globalValue
        try {
            await writeFile(file, '#!/bin/sh\necho "OpenSCAD version 2026.10.TEST" >&2\n')
            await chmod(file, 0o755)
            await configuration.update('openscadPath', '', vscode.ConfigurationTarget.Global)
            await configuration.update('runtimeCommand', { executable: file, argsPrefix: [] }, vscode.ConfigurationTarget.Global)
            await runtimeApi.refresh()
            assert.equal(runtimeApi.getActiveRuntime()?.version, '2026.10.TEST')
            await configuration.update('openscadPath', path.join(directory, 'missing'), vscode.ConfigurationTarget.Global)
            await vscode.commands.executeCommand('scad-ai-ide.refreshRuntimes')
            assert.equal(runtimeApi.getActiveRuntime(), undefined)
        } finally {
            await configuration.update('openscadPath', previousPath, vscode.ConfigurationTarget.Global)
            await configuration.update('runtimeCommand', previousCommand, vscode.ConfigurationTarget.Global)
            await rm(directory, { recursive: true, force: true })
        }
    })
})
