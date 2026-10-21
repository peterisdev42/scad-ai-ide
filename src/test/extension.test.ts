import * as assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import * as vscode from 'vscode'
import type { activate } from '../extension'
import { QuickAccessTreeProvider, quickAccess } from '../features/sidebar/QuickAccessTreeProvider'
import { CustomizerTreeProvider } from '../features/sidebar/CustomizerTreeProvider'
import { CustomizerService } from '../core/customizer/CustomizerService'

suite('SCAD AI IDE integration', () => {
    async function api() {
        const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')
        assert.ok(extension)
        return (await extension.activate()) as ReturnType<typeof activate>
    }

    test('registers exactly two native views and four plain leaf navigation items', async () => {
        await api()
        const manifest = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')!.packageJSON
        assert.deepEqual(
            manifest.contributes.views['scad-ai-ide'].map((view: { name: string }) => view.name),
            ['Quick Access', 'Customizer'],
        )
        await vscode.commands.executeCommand('scad-ai.quickAccess.focus')
        const tree = new QuickAccessTreeProvider()
        const items = tree.getChildren()
        assert.deepEqual(
            items.map((item) => item.label),
            ['AI', 'Bricks', 'Libraries', 'Runtime'],
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
        await vscode.commands.executeCommand('scad-ai.customizer.edit', first.uri.toString(), 'hollow')
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
        const service = new CustomizerService()
        const tree = new CustomizerTreeProvider(service)
        try {
            service.clear()
            assert.deepEqual(tree.getChildren(), [])
            service.load('test.scad', '/* [Geometry] */\nwidth = 40;\n')
            const groups = tree.getChildren()
            const parameter = tree.getChildren(groups[0])[0]
            assert.equal(groups[0].label, 'Geometry')
            assert.equal(parameter.label, 'width')
            assert.equal(parameter.description, '40')
            assert.equal(parameter.iconPath, undefined)
            assert.deepEqual(tree.getChildren(parameter), [])
            service.load('ungrouped.scad', 'width = 40;\nheight = 20;\n/* [Parameters] */\nwall = 2.5;\n')
            const items = tree.getChildren()
            assert.deepEqual(
                items.map((item) => item.label),
                ['width', 'height', 'Parameters'],
            )
            assert.equal(items[0].description, '40')
            assert.deepEqual(items[0].command?.arguments, ['ungrouped.scad', 'width'])
            assert.deepEqual(tree.getChildren(items[0]), [])
            assert.deepEqual(
                tree.getChildren(items[2]).map((item) => item.label),
                ['wall'],
            )
        } finally {
            tree.dispose()
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
