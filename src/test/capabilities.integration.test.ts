import * as assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { activate } from '../extension'
import { createAiPanelState } from '../features/agents/CapabilityPresentation'
import { capabilityCatalog } from '../core/capabilities/CapabilityRegistry'

suite('Agent capabilities extension host', () => {
    test('installed manifest, registered LM tools and bundled resources agree without open panels', async () => {
        const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')!
        const api = await extension.activate() as Awaited<ReturnType<typeof activate>>
        assert.equal(api.panels.getPanel('runtime'), undefined)
        assert.equal(api.panels.getPanel('libraries'), undefined)
        const contributed = extension.packageJSON.contributes.languageModelTools as Array<{ name: string }>
        assert.deepEqual(contributed.map((t) => t.name).sort(), capabilityCatalog.map((d) => d.toolName).sort())
        for (const definition of capabilityCatalog) assert.ok(vscode.lm.tools.some((tool) => tool.name === definition.toolName), `LM tool missing: ${definition.toolName}`)
        for (const resource of [...extension.packageJSON.contributes.chatInstructions, ...extension.packageJSON.contributes.chatSkills]) {
            assert.ok((await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extension.extensionUri, resource.path))).length > 0)
        }
        const result = await vscode.lm.invokeTool('scad_ai_ide_more_githubStatus', { input: {}, toolInvocationToken: undefined })
        const text = result.content.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart).map((part) => part.value).join('')
        const output = JSON.parse(text)
        assert.equal(output.ok, true)
        assert.ok(['checking', 'anonymous', 'authenticated'].includes(output.data.mode))
        assert.doesNotMatch(text, /accessToken|Bearer |github_pat_/)
        const state = await api.capabilities.invoke('development.status', {}, { actor: 'agent' })
        assert.equal(state.ok, true)
    })
    test('AI Panel metadata covers every registered tool and all awareness resources without running a capability', async () => {
        const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')!
        const api = await extension.activate() as Awaited<ReturnType<typeof activate>>
        const before = api.capabilities.operations.status()
        const snapshot = createAiPanelState(api.capabilities.registry)
        assert.equal(snapshot.total, capabilityCatalog.length)
        assert.deepEqual(snapshot.capabilities.map((entry) => entry.toolName).sort(), capabilityCatalog.map((entry) => entry.toolName).sort())
        assert.equal(snapshot.resources.filter((entry) => entry.kind === 'Skill').length, 4)
        assert.equal(snapshot.resources.filter((entry) => entry.kind === 'Instruction').length, 1)
        assert.deepEqual(api.capabilities.operations.status(), before)
        await vscode.commands.executeCommand('scad-ai.ai.open')
        try {
            const html = api.panels.getPanel('ai')!.webview.html
            assert.match(html, /id="ai-capability-groups"/)
            assert.match(html, /panels\/ai\.js/)
            assert.ok(!html.includes('{{'))
        } finally { api.panels.getPanel('ai')?.dispose() }
    })
    test('actual host target changes reject stale Agent writes and parameter changes reach shared CLI arguments', async () => {
        const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')!
        const api = await extension.activate() as Awaited<ReturnType<typeof activate>>
        const root = await mkdtemp(path.join(os.tmpdir(), 'scad-agent-host-'))
        await writeFile(path.join(root, 'first.scad'), 'width=10; // [0:5:100]\nsize=[1,2,3];\n')
        const first = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'first.scad')))
        await vscode.window.showTextDocument(first)
        const read = await api.capabilities.invoke('customizer.state', {}, { actor: 'agent' })
        assert.equal(read.ok, true)
        const snapshot = read.ok ? read.data as { target: string; revision: number } : undefined
        assert.ok(snapshot)
        const changed = await api.capabilities.invoke('customizer.set', { target: snapshot.target, revision: snapshot.revision, values: { width: 25 } }, { actor: 'agent' })
        assert.equal(changed.ok, true)
        assert.ok(api.getRenderArguments().includes('width=25'))
        await writeFile(path.join(root, 'second.scad'), 'width=5;\n')
        const second = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'second.scad')))
        await vscode.window.showTextDocument(second)
        const stale = await api.capabilities.invoke('customizer.set', { target: snapshot.target, revision: snapshot.revision, values: { width: 50 } }, { actor: 'agent' })
        assert.equal(stale.ok, false)
        if (!stale.ok) assert.equal(stale.error.code, 'TARGET_CHANGED')
        assert.equal(api.customizer.getOverrides(second.uri.toString()).width, undefined)
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        api.customizer.clear() // Reset shared target for the following, independent GUI suite.
        await rm(root, { recursive: true, force: true })
    })
})
