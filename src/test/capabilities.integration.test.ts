import * as assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { activate } from '../extension'
import { createAiPanelState } from '../features/agents/CapabilityPresentation'
import resources from '../core/capabilities/resources.json'
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
        const runtimeResult = await vscode.lm.invokeTool('scad_ai_ide_runtime_state', { input: { limit: 1 }, toolInvocationToken: undefined })
        const runtimeOutput = JSON.parse((runtimeResult.content[0] as vscode.LanguageModelTextPart).value)
        assert.equal(runtimeOutput.ok, true)
        const actualRuntime = api.getActiveRuntime()
        assert.equal(runtimeOutput.data.state.activeRuntime?.version ?? null, actualRuntime?.version ?? null)
        assert.equal(runtimeOutput.data.state.activeRuntime?.command.executable ?? null, actualRuntime?.command.executable ?? null)
        assert.equal(runtimeOutput.data.state.discovery.scope, 'extensionHost')
        assert.ok(['ready', 'error', 'restricted'].includes(runtimeOutput.data.state.discovery.status))
        assert.equal(typeof runtimeOutput.data.state.runtimes.hasMore, 'boolean')
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
        assert.equal(snapshot.resources.filter((entry) => entry.kind === 'Skill').length, resources.filter((r) => r.kind === 'Skill').length)
        assert.equal(snapshot.resources.filter((entry) => entry.kind === 'Instruction').length, resources.filter((r) => r.kind === 'Instruction').length)
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
    test('source tools edit unsaved buffers with CAS and refresh GUI schema, diagnostics and Quick Fixes', async function () {
        const folder = vscode.workspace.workspaceFolders?.[0]
        if (!folder || !vscode.workspace.isTrusted) { this.skip(); return }
        const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')!
        const api = await extension.activate() as Awaited<ReturnType<typeof activate>>
        const uri = vscode.Uri.joinPath(folder.uri, `customizer-source-${Date.now()}.scad`)
        await vscode.workspace.fs.writeFile(uri, Buffer.from('width=40;\nmodule model() { cube([width,2,3]); }\n'))
        const document = await vscode.workspace.openTextDocument(uri)
        await vscode.window.showTextDocument(document)
        const waitFor = async (predicate: () => boolean) => {
            const deadline = Date.now() + 5000
            while (!predicate()) { if (Date.now() >= deadline) assert.fail('Timed out waiting for Customizer diagnostics'); await new Promise((resolve) => setTimeout(resolve, 25)) }
        }
        try {
            const source = api.customizerSource
            const initial = await source.analyze(uri.toString())
            const unsaved = new vscode.WorkspaceEdit()
            unsaved.insert(uri, new vscode.Position(0, 0), '// Unsaved width\n')
            await vscode.workspace.applyEdit(unsaved)
            await assert.rejects(source.apply({ mode: 'plan', uri: uri.toString(), identity: { version: initial.identity.version, sha256: initial.identity.sha256 }, edits: [{ kind: 'changeWidget', name: 'width', widget: 'slider', range: { min: 10, max: 100, step: 5 } }] }), (e: unknown) => (e as { code: string }).code === 'STALE_SOURCE')
            const current = await source.analyze(uri.toString())
            assert.equal(current.parameters[0].description, 'Unsaved width')
            const plan = await source.apply({ mode: 'plan', uri: uri.toString(), identity: { version: current.identity.version, sha256: current.identity.sha256 }, edits: [{ kind: 'changeWidget', name: 'width', widget: 'slider', range: { min: 10, max: 100, step: 5 } }] }) as { planId: string }
            const committed = await source.apply({ mode: 'commit', planId: plan.planId }) as { semanticPass: boolean }
            assert.equal(committed.semanticPass, true)
            assert.equal(document.isDirty, true)
            assert.equal((await source.validate(uri.toString(), [{ name: 'width', widget: 'slider' }])).semanticPass, true)
            const gui = await api.capabilities.invoke('customizer.state', {}, { actor: 'agent' })
            assert.equal(gui.ok, true)
            if (gui.ok) assert.equal((gui.data as { parameters: Array<{ range: { step: number } }> }).parameters[0].range.step, 5)
            const disk = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString()
            assert.doesNotMatch(disk, /Unsaved|\[10:5:100\]/)
            const invalid = new vscode.WorkspaceEdit()
            const text = document.getText(), start = text.indexOf('[10:5:100]')
            invalid.replace(uri, new vscode.Range(document.positionAt(start), document.positionAt(start + 10)), '[10:0:100]')
            await vscode.workspace.applyEdit(invalid)
            await waitFor(() => vscode.languages.getDiagnostics(uri).some((d) => d.code === 'CUSTOMIZER_INVALID_RANGE'))
            const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', uri, new vscode.Range(1, 0, 1, 100))
            const fix = actions?.find((a) => a.title === 'Customizer: remove invalid explicit step')
            assert.ok(fix?.edit)
            await vscode.workspace.applyEdit(fix.edit)
            await waitFor(() => !vscode.languages.getDiagnostics(uri).some((d) => d.code === 'CUSTOMIZER_INVALID_RANGE'))
            assert.equal((await source.analyze(uri.toString())).parameters[0].range?.step, undefined)
            const plan2read = await source.analyze(uri.toString())
            const plan2 = await source.apply({ mode: 'plan', uri: uri.toString(), identity: { version: plan2read.identity.version, sha256: plan2read.identity.sha256 }, edits: [{ kind: 'changeWidget', name: 'width', widget: 'slider', range: { min: 10, max: 100, step: 5 } }] }) as { planId: string }
            const other = new vscode.WorkspaceEdit(); other.insert(uri, new vscode.Position(0, 0), '// Concurrent edit\n')
            await vscode.workspace.applyEdit(other)
            await assert.rejects(source.apply({ mode: 'commit', planId: plan2.planId }), (e: unknown) => (e as { code: string }).code === 'STALE_SOURCE')
            assert.match(document.getText(), /Concurrent edit/)
            const setSource = async (text: string) => {
                const edit = new vscode.WorkspaceEdit()
                edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text)
                assert.equal(await vscode.workspace.applyEdit(edit), true)
            }
            const customizerProblems = () => vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'OpenSCAD Customizer')
            await setSource('width=10; // [1:1:200]\nwidth=30; // [1:0:200]\n')
            await waitFor(() => customizerProblems().some((d) => d.code === 'CUSTOMIZER_INVALID_RANGE'))
            assert.match(customizerProblems().find((d) => d.code === 'CUSTOMIZER_INVALID_RANGE')!.message, /positive step|remove the explicit step/)
            await setSource('width=0; // [1:0:200]\nheight=201; // [1:1:200]\nwidth=30; // [1:1:200]\nheight=40; // [1:1:200]\n')
            await waitFor(() => customizerProblems().length === 0)
            assert.equal((await source.validate(uri.toString(), [{ name: 'width', widget: 'slider', defaultValue: 30 }])).semanticPass, true)
            await setSource('width=10; // [1:1:200]\nwidth=10+20;\n')
            assert.equal((await source.analyze(uri.toString())).diagnostics.length, 0)
            await new Promise((resolve) => setTimeout(resolve, 300)) // Allow the diagnostic debounce to publish, including any unwanted usage messages.
            assert.deepEqual(customizerProblems(), [])
            const unmet = await source.validate(uri.toString(), [{ name: 'width', widget: 'slider' }])
            assert.equal(unmet.semanticPass, false)
            assert.deepEqual(unmet.diagnostics, [])
            assert.ok(unmet.expectationResults[0].issues.length > 0)
            await setSource('width=10; // [1:1:200]\nwidth=30; // [1:1:200]\n')
            await waitFor(() => customizerProblems().length === 0)
            assert.ok(customizerProblems().every((d) => d.severity !== vscode.DiagnosticSeverity.Error))
            await setSource('assembly_id=0; // [0:22\n')
            await waitFor(() => customizerProblems().some((d) => d.code === 'CUSTOMIZER_MALFORMED_HINT'))
            await setSource('assembly_id=0; // [0:22] IDs in Assembly.md; 0 shows the selected group\n')
            await waitFor(() => customizerProblems().length === 0)
            await new Promise((resolve) => setTimeout(resolve, 300))
            assert.deepEqual(customizerProblems(), [])
        } finally {
            await vscode.window.showTextDocument(document)
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
            await vscode.workspace.fs.delete(uri)
            api.customizer.clear()
        }
    })

})
