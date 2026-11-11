import { ScadSession } from '../features/preview/extension/core/ScadSession'
import { ScadClient } from '../features/preview/extension/services/ScadClient'
import { ScadWebviewPanel } from '../features/preview/extension/views/ScadWebviewPanel'
import { PreviewSourceProblems } from '../features/preview/extension/services/PreviewSourceProblems'
import { PreviewProblems } from '../features/preview/extension/services/PreviewProblems'
import { EmptyModelError } from '../features/preview/extension/services/previewEligibility'
import { focusTestEditor } from './HostEditorFocus'
import * as assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { CustomizerPresets } from '../features/sidebar/CustomizerPresets'
import { CustomizerDomainService } from '../features/sidebar/CustomizerDomainService'
import { CustomizerService } from '../core/customizer/CustomizerService'
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
    test('Customizer lost-control Problems link both declarations and clear after an unsaved repair', async () => {
        const waitFor = async (check: () => boolean) => {
            const deadline = Date.now() + 10000
            while (!check()) {
                assert.ok(Date.now() < deadline, 'Expected Customizer diagnostics to update')
                await new Promise(resolve => setTimeout(resolve, 50))
            }
        }
        const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'scad-ai-ide')!
        await extension.activate()
        const root = await mkdtemp(path.join(os.tmpdir(), 'scad-overridden-host-'))
        const uri = vscode.Uri.file(path.join(root, 'model.scad'))
        const source = 'width=10; // [1:100]\nmodule model() {}\nwidth=20;'
        await writeFile(uri.fsPath, source)
        try {
            const document = await vscode.workspace.openTextDocument(uri)
            await vscode.window.showTextDocument(document)
            await waitFor(() => vscode.languages.getDiagnostics(uri).some(d => d.code === 'CUSTOMIZER_PARAMETER_OVERRIDDEN'))
            const diagnostic = vscode.languages.getDiagnostics(uri).find(d => d.code === 'CUSTOMIZER_PARAMETER_OVERRIDDEN')!
            assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Warning)
            assert.equal(diagnostic.range.start.line, 2)
            assert.equal(diagnostic.relatedInformation?.[0].location.uri.toString(), uri.toString())
            assert.equal(diagnostic.relatedInformation?.[0].location.range.start.line, 0)
            const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', uri, diagnostic.range)
            assert.ok(!actions?.some(a => a.kind?.contains(vscode.CodeActionKind.QuickFix) && a.diagnostics?.some(d => d.code === diagnostic.code)), 'No automatic duplicate deletion')
            // Replace the entire buffer to keep the repair independent of newline offsets.
            const repair = new vscode.WorkspaceEdit()
            repair.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), 'width=10; // [1:100]\nmodule model() {}')
            assert.equal(await vscode.workspace.applyEdit(repair), true)
            await waitFor(() => !vscode.languages.getDiagnostics(uri).some(d => d.code === 'CUSTOMIZER_PARAMETER_OVERRIDDEN'))
            assert.equal(document.isDirty, true)
            assert.equal(await readFile(uri.fsPath, 'utf8'), source)
        } finally {
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
            await rm(root, { recursive: true, force: true })
        }
    })
    test('Preview Problems are readable by the host diagnostics API, scoped and cleared on recovery or disposal', async () => {
        const uri = vscode.Uri.file(path.join(os.tmpdir(), 'preview-problems-test', 'model.scad'))
        const include = vscode.Uri.file(path.join(os.tmpdir(), 'preview-problems-test', 'lib.scad'))
        const sources = new PreviewSourceProblems()
        const otherSources = new PreviewSourceProblems()
        const reporter = new PreviewProblems(uri, sources)
        const other = new PreviewProblems(uri, otherSources)
        const read = (target = uri) => vscode.languages.getDiagnostics(target).filter(d => d.source === 'OpenSCAD Preview')
        try {
            reporter.report(new Error('ERROR: Parser error: syntax error in file model.scad, line 3'), 'render')
            assert.equal(read().length, 1)
            assert.equal(read()[0].severity, vscode.DiagnosticSeverity.Error)
            assert.equal(read()[0].range.start.line, 2)
            assert.equal(read()[0].code, 'PREVIEW_RENDER_FAILED')
            reporter.report(new Error('Render cancelled'), 'render')
            assert.equal(read().length, 1, 'Cancellation must not replace a real issue')
            reporter.clear('render')
            assert.equal(read().length, 0)
            reporter.report(new Error('ERROR: assertion failed in file lib.scad, line 7'), 'render')
            assert.equal(read(include)[0].range.start.line, 6)
            assert.equal(read(include)[0].relatedInformation?.[0].location.uri.toString(), uri.toString())
            reporter.report(new Error('WebGL initialization failed'), 'view')
            other.report(new Error('Another preview failed'), 'render')
            assert.equal(read().length, 2)
            reporter.clear('render')
            assert.equal(read(include).length, 0)
            assert.equal(read().length, 2, 'Compiler success must not clear graphics or other view errors')
            reporter.clear('view')
            assert.equal(read().length, 1)
            reporter.report(new EmptyModelError(), 'render')
            assert.equal(read().find(d => d.code === 'PREVIEW_EMPTY_MODEL')?.severity, vscode.DiagnosticSeverity.Information)
            reporter.dispose()
            sources.dispose()
            assert.equal(read().length, 1)
            other.dispose()
            otherSources.dispose()
            assert.equal(read().length, 0)
            reporter.report(new Error('Late completion'), 'render')
            assert.equal(read().length, 0)
        } finally { reporter.dispose(); other.dispose(); sources.dispose(); otherSources.dispose() }
    })
    test('native Preview failure reaches Problems through the actual session and clears after unsaved repair', async function () {
        this.timeout(30000)
        const executable = process.env.SCAD_TEST_OPENSCAD
        if (!executable) { this.skip(); return }
        const root = await mkdtemp(path.join(os.tmpdir(), 'scad-preview-problems-native-'))
        const uri = vscode.Uri.file(path.join(root, 'model.scad'))
        const source = 'cube([1,2,3];'
        await writeFile(uri.fsPath, source)
        const document = await vscode.workspace.openTextDocument(uri)
        const customizer = new CustomizerService()
        ScadClient.configure(async () => ({ executable, argsPrefix: [] }))
        const session = new ScadSession(document, customizer)
        const panel = vscode.window.createWebviewPanel('scad.preview.problems.test', 'Preview Problems test', { viewColumn: vscode.ViewColumn.Active, preserveFocus: true }, {})
        const sourceProblems = new PreviewSourceProblems()
        const view = new ScadWebviewPanel(panel, vscode.Uri.file(path.resolve('.')), session, { get: (_key: string, fallback: unknown) => fallback, update: async () => {}, keys: () => [] } as unknown as vscode.Memento, sourceProblems)
        const waitFor = async (check: () => boolean) => {
            const deadline = Date.now() + 15000
            while (!check()) { assert.ok(Date.now() < deadline, 'Native Preview result did not arrive'); await new Promise(resolve => setTimeout(resolve, 50)) }
        }
        let completed = false
        const completion = session.onRenderCompleted(() => { completed = true })
        try {
            session.refreshRender()
            await waitFor(() => vscode.languages.getDiagnostics(uri).some(d => d.code === 'PREVIEW_RENDER_FAILED'))
            const issue = vscode.languages.getDiagnostics(uri).find(d => d.code === 'PREVIEW_RENDER_FAILED')!
            assert.equal(issue.severity, vscode.DiagnosticSeverity.Error)
            assert.match(issue.message, /Parser error/i)
            const repair = new vscode.WorkspaceEdit()
            repair.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(source.length)), 'cube(2);')
            assert.equal(await vscode.workspace.applyEdit(repair), true)
            await waitFor(() => completed)
            assert.ok(!vscode.languages.getDiagnostics(uri).some(d => d.code === 'PREVIEW_RENDER_FAILED'))
            assert.equal(document.isDirty, true)
            assert.equal(await readFile(uri.fsPath, 'utf8'), source)
        } finally {
            completion.dispose(); view.dispose(); session.dispose(); sourceProblems.dispose(); ScadClient.dispose()
            await vscode.window.showTextDocument(document)
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
            await rm(root, { recursive: true, force: true })
        }
    })
    test('Preview-to-Text preserves production Problems and source actions force Text without changing associations', async function () {
        this.timeout(45000)
        const executable = process.env.SCAD_TEST_OPENSCAD
        if (!executable) { this.skip(); return }
        const directory = await mkdtemp(path.join(os.tmpdir(), 'preview-problems-navigation-'))
        const uri = vscode.Uri.file(path.join(directory, 'model.scad'))
        const config = vscode.workspace.getConfiguration('scad-ai-ide')
        const workbench = vscode.workspace.getConfiguration('workbench')
        const oldCommand = config.inspect('runtimeCommand')?.globalValue
        const oldMode = config.inspect('preview.renderMode')?.globalValue
        const oldAssociations = workbench.inspect('editorAssociations')?.globalValue
        const viewType = 'scad-ai-ide.preview.editor'
        const source = 'width=10;\ncube([1,2,3];'
        const waitFor = async (check: () => boolean) => {
            const deadline = Date.now() + 15000
            while (!check()) { assert.ok(Date.now() < deadline, 'Preview navigation result did not arrive'); await new Promise(resolve => setTimeout(resolve, 50)) }
        }
        const problems = () => vscode.languages.getDiagnostics(uri).filter(d => d.code === 'PREVIEW_RENDER_FAILED')
        const isCustom = () => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom
        try {
            await writeFile(uri.fsPath, source)
            await config.update('runtimeCommand', { executable, argsPrefix: [] }, vscode.ConfigurationTarget.Global)
            await config.update('preview.renderMode', 'render', vscode.ConfigurationTarget.Global)
            const associations = { ...(oldAssociations as object ?? {}), '*.scad': viewType }
            await workbench.update('editorAssociations', associations, vscode.ConfigurationTarget.Global)
            const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'scad-ai-ide')!
            const api = await extension.activate() as Awaited<ReturnType<typeof activate>>
            await api.refresh()
            await vscode.commands.executeCommand('vscode.openWith', uri, viewType)
            await waitFor(() => isCustom() && problems().length > 0)
            const diagnostic = problems()[0]
            await vscode.commands.executeCommand('vscode.open', uri, { selection: diagnostic.range })
            console.log('Problems-style resource open selected:', isCustom() ? 'Preview (editor association retained)' : 'Text')
            await vscode.commands.executeCommand('scad-ai-ide.showSource')
            await waitFor(() => vscode.window.activeTextEditor?.document.uri.toString() === uri.toString())
            await new Promise(resolve => setTimeout(resolve, 300))
            assert.ok(problems().length, 'Changing editor type must not clear the source failure')
            await vscode.commands.executeCommand('vscode.openWith', uri, viewType)
            await waitFor(isCustom)
            const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', uri, diagnostic.range)
            const navigation = actions?.find(action => action.title === 'Preview: open source at this error')
            assert.ok(navigation?.command, 'Problems must expose the explicit source action')
            await vscode.commands.executeCommand(navigation.command.command, ...navigation.command.arguments!)
            await waitFor(() => vscode.window.activeTextEditor?.document.uri.toString() === uri.toString())
            assert.equal(vscode.window.activeTextEditor!.selection.start.line, diagnostic.range.start.line)
            assert.equal(isCustom(), false)
            assert.ok(problems().length)
            assert.deepEqual(vscode.workspace.getConfiguration('workbench').get('editorAssociations'), associations)
            const document = vscode.window.activeTextEditor!.document
            const repair = new vscode.WorkspaceEdit()
            repair.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), 'cube(2);')
            assert.equal(await vscode.workspace.applyEdit(repair), true)
            await waitFor(() => problems().length === 0)
            assert.equal(await vscode.commands.executeCommand(navigation.command.command, ...navigation.command.arguments!), false, 'A stale source action must not jump to an obsolete diagnostic')
            assert.equal(document.isDirty, true)
            assert.equal(await readFile(uri.fsPath, 'utf8'), source)
            let completed = false
            const session = api.preview.getOrCreateSession(document)
            const completion = session.onRenderCompleted(() => { completed = true })
            try {
                await vscode.commands.executeCommand('vscode.openWith', uri, viewType)
                await waitFor(() => completed)
                assert.equal(problems().length, 0)
            } finally { completion.dispose() }
            await vscode.window.showTextDocument(document)
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
        } finally {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors')
            await config.update('runtimeCommand', oldCommand, vscode.ConfigurationTarget.Global)
            await config.update('preview.renderMode', oldMode, vscode.ConfigurationTarget.Global)
            await workbench.update('editorAssociations', oldAssociations, vscode.ConfigurationTarget.Global)
            await rm(directory, { recursive: true, force: true })
        }
    })
    test('Preview source store invalidates changed buffers and includes, rejects stale reports and bounds retained files', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'preview-source-store-'))
        const uri = vscode.Uri.file(path.join(root, 'model.scad'))
        const include = vscode.Uri.file(path.join(root, 'lib.scad'))
        const sources = new PreviewSourceProblems()
        try {
            await writeFile(uri.fsPath, 'cube(1);')
            await writeFile(include.fsPath, 'cube(2);')
            const document = await vscode.workspace.openTextDocument(uri)
            const dependency = await vscode.workspace.openTextDocument(include)
            const reporter = new PreviewProblems(uri, sources)
            reporter.report(new Error('ERROR: assertion failed in file lib.scad, line 1'), 'render')
            reporter.dispose()
            assert.ok(sources.first(uri), 'Disposing a view must retain its source result')
            const mesh = vscode.Uri.file(path.join(root, 'mesh.stl'))
            const meshView = new PreviewProblems(mesh, sources)
            meshView.report(new Error('Invalid STL'), 'render')
            assert.equal(sources.first(mesh), undefined, 'Binary-view failures must not enter source validation history')
            assert.ok(vscode.languages.getDiagnostics(mesh).length)
            meshView.dispose()
            assert.equal(vscode.languages.getDiagnostics(mesh).length, 0)
            const change = new vscode.WorkspaceEdit()
            change.insert(include, new vscode.Position(0, 0), '// changed\n')
            await vscode.workspace.applyEdit(change)
            assert.equal(sources.first(uri), undefined)
            const late = new PreviewProblems(uri, sources)
            late.beginRender()
            const edit = new vscode.WorkspaceEdit()
            edit.insert(uri, new vscode.Position(0, 0), '// changed\n')
            await vscode.workspace.applyEdit(edit)
            late.report(new Error('Old compile failed'), 'render')
            assert.equal(sources.first(uri), undefined, 'A completed old request must not republish stale diagnostics')
            late.dispose()
            for (let i = 0; i < 130; i++) {
                const file = vscode.Uri.joinPath(uri, '..', `file${i}.scad`)
                const view = new PreviewProblems(file, sources)
                view.report(new Error('failed'), 'render')
                view.dispose()
            }
            assert.equal(sources.first(vscode.Uri.joinPath(uri, '..', 'file0.scad')), undefined)
            assert.ok(sources.first(vscode.Uri.joinPath(uri, '..', 'file129.scad')))
            for (const doc of [document, dependency]) { await vscode.window.showTextDocument(doc); await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor') }
        } finally { sources.dispose(); await rm(root, { recursive: true, force: true }) }
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
    test('Preset Problems diagnose only the bound JSON and follow its unsaved buffer', async function () {
        this.timeout(15000)
        const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'scad-ai-ide')!
        const api = await extension.activate() as Awaited<ReturnType<typeof activate>>
        const root = await mkdtemp(path.join(os.tmpdir(), 'customizer-preset-problems-'))
        const source = vscode.Uri.file(path.join(root, 'model.scad'))
        const preset = vscode.Uri.file(path.join(root, 'model.json'))
        const unrelated = vscode.Uri.file(path.join(root, 'unrelated.json'))
        const original = JSON.stringify({ fileFormatVersion: '1', parameterSets: { A: { width: 'bad' } } })
        const wait = async (condition: () => boolean) => {
            const deadline = Date.now() + 5000
            while (!condition()) { assert.ok(Date.now() < deadline, 'Preset Problems did not settle'); await new Promise(resolve => setTimeout(resolve, 25)) }
        }
        const problems = (uri: vscode.Uri) => vscode.languages.getDiagnostics(uri).filter(d => d.source === 'OpenSCAD Preset')
        try {
            await writeFile(source.fsPath, 'width=10; // [0:100]\n')
            await writeFile(preset.fsPath, original)
            await writeFile(unrelated.fsPath, original)
            const document = await vscode.workspace.openTextDocument(source)
            await vscode.window.showTextDocument(document)
            await vscode.workspace.openTextDocument(unrelated)
            const result = await api.capabilities.invoke('customizer.state', {}, { actor: 'gui' })
            assert.ok(result.ok)
            const state = result.data as { target: string; revision: number }
            const imported = await api.capabilities.invoke('customizer.importPresets', { target: state.target, revision: state.revision, uri: preset.toString() }, { actor: 'gui' })
            // Pass only the contract's target/revision fields, not snapshot metadata.
            assert.ok(imported.ok, JSON.stringify(imported))
            await wait(() => problems(preset).some(d => d.code === 'PRESET-004'))
            assert.equal(problems(unrelated).length, 0)
            const json = await vscode.workspace.openTextDocument(preset)
            await vscode.window.showTextDocument(json)
            const warning = problems(preset).find(d => d.code === 'PRESET-004')!
            assert.equal(json.getText(warning.range), '"bad"')
            const edit = new vscode.WorkspaceEdit()
            edit.replace(preset, warning.range, '"25"')
            assert.ok(await vscode.workspace.applyEdit(edit))
            await wait(() => problems(preset).length === 0)
            assert.equal(json.isDirty, true)
            assert.equal(Buffer.from(await vscode.workspace.fs.readFile(preset)).toString('utf8'), original)
            assert.equal(api.customizer.getOverrides(source.toString()).width, undefined, 'Diagnosing JSON must not apply a set')
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
        } finally {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors')
            api.customizer.clear()
            await rm(root, { recursive: true, force: true })
        }
    })
    test('real preset file transactions preserve metadata, react to external edits and block unknown versions', async function () {
        this.timeout(20000)
        const folder = vscode.workspace.workspaceFolders?.[0]
        assert.ok(folder && vscode.workspace.isTrusted, 'Provide a trusted fixture workspace for real preset I/O')
        const root = await mkdtemp(path.join(folder.uri.fsPath, 'preset-io-'))
        const source = vscode.Uri.file(path.join(root, 'model.scad'))
        const preset = vscode.Uri.file(path.join(root, 'model.json'))
        const originalSource = 'width=10;\nheight=20;\ncube([width,height,1]);\n'
        const initial = { fileFormatVersion: '1', metadata: { retained: true }, parameterSets: { A: { width: '30' }, B: { height: '40' }, Historical: { old_key: 'preserve' } } }
        const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'scad-ai-ide')!
        const api = await extension.activate() as Awaited<ReturnType<typeof activate>>
        const read = async () => {
            const result = await api.capabilities.invoke('customizer.state', {}, { actor: 'agent' })
            assert.ok(result.ok)
            return result.data as { target: string; revision: number; presets: { readOnly: boolean } }
        }
        const invoke = async (id: string, input: object = {}) => {
            const state = await read()
            return api.capabilities.invoke(id, { target: state.target, revision: state.revision, ...input }, { actor: 'agent' })
        }
        const successful = async (id: string, input: object = {}) => {
            const result = await invoke(id, input)
            assert.ok(result.ok, JSON.stringify(result))
        }
        const wait = async (condition: () => boolean | Promise<boolean>) => {
            const until = Date.now() + 5000
            while (!(await condition())) { assert.ok(Date.now() < until, 'Preset file watcher did not settle'); await new Promise(resolve => setTimeout(resolve, 25)) }
        }
        try {
            await writeFile(source.fsPath, originalSource)
            await writeFile(preset.fsPath, JSON.stringify(initial))
            const document = await vscode.workspace.openTextDocument(source)
            await vscode.window.showTextDocument(document)
            await successful('customizer.importPresets', { uri: preset.toString() })
            await successful('customizer.applyPreset', { name: 'A' })
            assert.deepEqual(api.customizer.getOverrides(source.toString()), { width: 30 })
            await successful('customizer.applyPreset', { name: 'B' })
            assert.deepEqual(api.customizer.getOverrides(source.toString()), { height: 40 })
            await successful('customizer.applyPreset', { name: '' })
            assert.deepEqual(api.customizer.getOverrides(source.toString()), {})
            await successful('customizer.set', { values: { width: 35 } })
            await successful('customizer.createPreset', { name: 'Saved' })
            const data = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(preset)).toString('utf8'))
            assert.deepEqual(data.metadata, initial.metadata)
            assert.deepEqual(data.parameterSets.Historical, initial.parameterSets.Historical)
            assert.deepEqual(data.parameterSets.B, initial.parameterSets.B)
            assert.equal(data.parameterSets.Saved.width, '35')
            assert.equal((await vscode.workspace.fs.readDirectory(vscode.Uri.file(root))).some(([name]) => name.endsWith('.tmp')), false)
            data.parameterSets.Saved.width = '37'
            await writeFile(preset.fsPath, JSON.stringify(data))
            await wait(() => api.customizer.getOverrides(source.toString()).width === 37)
            data.fileFormatVersion = '99'
            data.parameterSets.Saved.width = '99'
            const future = JSON.stringify(data)
            await writeFile(preset.fsPath, future)
            await wait(async () => (await read()).presets.readOnly)
            const rejected = await invoke('customizer.applyPreset', { name: 'Saved' })
            assert.equal(rejected.ok, false)
            if (!rejected.ok) assert.equal(rejected.error.code, 'PRESET_UNVERIFIED_VERSION')
            assert.equal(api.customizer.getOverrides(source.toString()).width, 37)
            assert.equal(Buffer.from(await vscode.workspace.fs.readFile(preset)).toString('utf8'), future)
            assert.equal(document.getText(), originalSource)
            assert.equal(document.isDirty, false)
        } finally {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors')
            api.customizer.clear()
            await rm(root, { recursive: true, force: true })
        }
    })
    test('preset snapshots reject loss without writes and allow existing-file export and deletion', async function () {
        this.timeout(30000)
        const folder = vscode.workspace.workspaceFolders?.[0]
        assert.ok(folder && vscode.workspace.isTrusted, 'Provide a trusted fixture workspace')
        const root = await mkdtemp(path.join(folder.uri.fsPath, 'preset-snapshot-'))
        const api = await vscode.extensions.all.find(item => item.packageJSON.name === 'scad-ai-ide')!.activate() as Awaited<ReturnType<typeof activate>>
        const state = async () => {
            const result = await api.capabilities.invoke('customizer.state', {}, { actor: 'agent' })
            assert.ok(result.ok)
            return result.data as { target: string; revision: number }
        }
        const invoke = async (id: string, input: object = {}, actor: 'agent' | 'gui' = 'agent') => {
            const current = await state()
            return api.capabilities.invoke(id, { target: current.target, revision: current.revision, ...input }, { actor })
        }
        const success = async (id: string, input: object = {}) => { const result = await invoke(id, input); assert.ok(result.ok, JSON.stringify(result)) }
        try {
            for (const fixture of [
                { id: 'ascii', source: 'label="abcdef"; // 3\n', name: 'label', value: 'abc' },
                { id: 'utf8', source: 'label="Ω😀"; // 3\n', name: 'label', value: 'Ω' },
                { id: 'numeric', source: 'width=-5; // [100]\n', name: 'width', value: 5 },
                { id: 'ambiguous', source: 'mode=1; // [1:Numeric,"1":String,2:Two]\n', name: 'mode', value: 2 },
            ]) {
                const source = vscode.Uri.file(path.join(root, fixture.id + '.scad'))
                const preset = vscode.Uri.file(path.join(root, fixture.id + '.json'))
                const exported = vscode.Uri.file(path.join(root, fixture.id + '-export.json'))
                const original = fixture.source + 'cube(1);\n'
                await writeFile(source.fsPath, original)
                const document = await vscode.workspace.openTextDocument(source)
                await vscode.window.showTextDocument(document)
                const deadline = Date.now() + 5000
                while ((await state()).target !== source.toString()) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 25)) }
                if (fixture.id === 'ambiguous') await success('customizer.set', { values: { mode: '1' } })
                const reject = async (id: string, input: object, actor: 'agent' | 'gui') => {
                    const before = await state()
                    const overrides = structuredClone(api.customizer.getOverrides(source.toString()))
                    const result = await invoke(id, input, actor)
                    assert.equal(result.ok, false, JSON.stringify(result))
                    if (!result.ok) assert.equal(result.error.code, 'PRESET_INVALID_VALUE')
                    assert.deepEqual(await state(), before, 'Rejecting must preserve revision, active and baseline state')
                    assert.deepEqual(api.customizer.getOverrides(source.toString()), overrides)
                    assert.equal(document.getText(), original)
                    assert.equal(document.isDirty, false)
                }
                await reject('customizer.createPreset', { name: 'Bad' }, 'agent')
                await reject('customizer.savePreset', {}, 'gui')
                await reject('customizer.exportPresets', { uri: exported.toString() }, 'agent')
                for (const uri of [preset, exported]) await assert.rejects(async () => vscode.workspace.fs.stat(uri), (error: unknown) => error instanceof vscode.FileSystemError && error.code === 'FileNotFound')
                const existing = { fileFormatVersion: '1', metadata: { keep: true }, parameterSets: { A: { [fixture.name]: String(fixture.value) }, Historical: { old_key: 'retain' } } }
                const bytes = JSON.stringify(existing)
                await writeFile(preset.fsPath, bytes)
                await success('customizer.importPresets', { uri: preset.toString() })
                await reject('customizer.createPreset', { name: 'Bad' }, 'gui')
                await reject('customizer.savePreset', { name: 'A' }, 'agent')
                assert.equal(await readFile(preset.fsPath, 'utf8'), bytes)
                await success('customizer.exportPresets', { uri: exported.toString() })
                assert.deepEqual(JSON.parse(await readFile(exported.fsPath, 'utf8')), existing)
                // Real storage deletion; the domain's separate confirmation is
                // not bypassed or automatically approved through an Agent call.
                const deletion = new CustomizerPresets(api.customizer, () => {})
                const beforeDisposal = structuredClone(api.customizer.getOverrides(source.toString()))
                try {
                    deletion.bind(source.toString())
                    await deletion.execute('import', undefined, preset)
                    await deletion.execute('delete', 'Historical')
                    const saved = JSON.parse(await readFile(preset.fsPath, 'utf8'))
                    assert.deepEqual(saved.metadata, existing.metadata)
                    assert.deepEqual(saved.parameterSets, { A: existing.parameterSets.A })
                } finally { deletion.dispose() }
                await assert.rejects(deletion.execute('select'), (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'TARGET_CHANGED')
                deletion.bind(source.toString())
                assert.deepEqual(deletion.parameterSets(), {})
                assert.deepEqual(api.customizer.getOverrides(source.toString()), beforeDisposal)
                await success('customizer.set', { values: { [fixture.name]: fixture.value } })
                await success('customizer.createPreset', { name: 'Valid' })
                await success('customizer.applyPreset', { name: '' })
                await success('customizer.applyPreset', { name: 'Valid' })
                assert.equal(api.customizer.getOverrides(source.toString())[fixture.name], fixture.value)
                assert.equal(document.getText(), original)
                assert.equal(document.isDirty, false)
                assert.equal(await readFile(source.fsPath, 'utf8'), original)
            }
            const isolatedService = new CustomizerService()
            const oldDomain = new CustomizerDomainService(isolatedService)
            const opened = oldDomain.snapshot()
            assert.ok(opened.target)
            oldDomain.setValues(opened.target, opened.revision, { mode: 2 })
            const oldIdentity = oldDomain.snapshot()
            oldDomain.dispose()
            isolatedService.set('mode', '1')
            const liveValues = structuredClone(isolatedService.getOverrides(opened.target))
            const inactive = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'TARGET_CHANGED'
            assert.throws(() => oldDomain.setValues(opened.target!, oldIdentity.revision, { mode: 2 }), inactive)
            assert.throws(() => oldDomain.reset(opened.target!, oldIdentity.revision), inactive)
            await assert.rejects(oldDomain.preset(opened.target, oldIdentity.revision, 'select'), inactive)
            oldDomain.snapshot()
            assert.deepEqual(isolatedService.getOverrides(opened.target), liveValues)
            assert.equal((await vscode.workspace.fs.readDirectory(vscode.Uri.file(root))).some(([name]) => name.endsWith('.tmp')), false)
        } finally {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors')
            api.customizer.clear()
            await rm(root, { recursive: true, force: true })
        }
    })
    test('source plan continuation commits three targets through the strict dispatcher and preserves cancellation, one-shot and source CAS', async function () {
        const folder = vscode.workspace.workspaceFolders?.[0]
        if (!folder || !vscode.workspace.isTrusted) { this.skip(); return }
        const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'scad-ai-ide')!
        const api = await extension.activate() as Awaited<ReturnType<typeof activate>>
        const uri = vscode.Uri.joinPath(folder.uri, `customizer-continuation-${Date.now()}.scad`)
        const original = 'width=40;\nshape="round";\ninternalOffset=0.01;\nmodule model() { cube([width,2,3]); }\nmodel();\n'
        await vscode.workspace.fs.writeFile(uri, Buffer.from(original))
        const document = await vscode.workspace.openTextDocument(uri)
        await vscode.window.showTextDocument(document)
        try {
            const analyzed = await api.customizerSource.analyze(uri.toString())
            const planResult = await api.capabilities.invoke('customizer.sourceApply', { mode: 'plan', uri: uri.toString(), identity: { version: analyzed.identity.version, sha256: analyzed.identity.sha256 }, edits: [
                { kind: 'annotateExisting', name: 'width', widget: 'slider', range: { min: 10, max: 100, step: 5 }, group: 'Dimensions', description: 'Width in millimeters' },
                { kind: 'changeWidget', name: 'shape', widget: 'dropdown', choices: [{ value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }], group: 'Appearance' },
                { kind: 'hideParameter', name: 'internalOffset' },
            ] }, { actor: 'agent' })
            assert.equal(planResult.ok, true)
            if (!planResult.ok) return
            const plan = planResult.data as { planId: string; continuation: { tool: string; input: { mode: 'commit'; planId: string }; requiresReview: boolean } }
            assert.equal(plan.continuation.tool, capabilityCatalog.find(definition => definition.id === 'customizer.sourceApply')!.toolName)
            assert.ok(vscode.lm.tools.some(tool => tool.name === plan.continuation.tool))
            assert.deepEqual(plan.continuation.input, { mode: 'commit', planId: plan.planId })
            assert.equal(plan.continuation.requiresReview, true)
            assert.equal(document.getText(), original, 'Returning continuation cannot execute it')
            const cancel = new AbortController(); cancel.abort()
            const cancelled = await api.capabilities.invoke('customizer.sourceApply', plan.continuation.input, { actor: 'agent', signal: cancel.signal })
            assert.equal(cancelled.ok, false)
            if (!cancelled.ok) assert.equal(cancelled.error.code, 'CANCELLED')
            const forged = await api.capabilities.invoke('customizer.sourceApply', { ...plan.continuation.input, requiresReview: false }, { actor: 'agent' })
            assert.equal(forged.ok, false)
            if (!forged.ok) assert.equal(forged.error.code, 'INVALID_INPUT')
            assert.equal(document.getText(), original)
            const committed = await api.capabilities.invoke('customizer.sourceApply', plan.continuation.input, { actor: 'agent' })
            assert.equal(committed.ok, true)
            if (committed.ok) assert.equal((committed.data as { semanticPass: boolean }).semanticPass, true)
            const validation = await api.customizerSource.validate(uri.toString(), [
                { name: 'width', widget: 'slider', range: { min: 10, max: 100, step: 5 }, group: 'Dimensions', description: 'Width in millimeters' },
                { name: 'shape', widget: 'dropdown', group: 'Appearance', choices: [{ value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }] },
                { name: 'internalOffset', visible: false },
            ])
            assert.equal(validation.semanticPass, true)
            assert.equal(validation.matched, 3)
            assert.equal(document.isDirty, true)
            assert.equal(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(), original)
            assert.equal(document.getText().slice(document.getText().indexOf('module model()')), original.slice(original.indexOf('module model()')))
            const replay = await api.capabilities.invoke('customizer.sourceApply', plan.continuation.input, { actor: 'agent' })
            assert.equal(replay.ok, false)
            if (!replay.ok) assert.equal(replay.error.code, 'PLAN_EXPIRED')
            const fresh = await api.customizerSource.analyze(uri.toString())
            const another = await api.customizerSource.apply({ mode: 'plan', uri: uri.toString(), identity: { version: fresh.identity.version, sha256: fresh.identity.sha256 }, edits: [{ kind: 'changeWidget', name: 'width', widget: 'slider', range: { min: 10, max: 200, step: 5 } }] }) as { continuation: { input: { mode: 'commit'; planId: string } } }
            const concurrent = new vscode.WorkspaceEdit(); concurrent.insert(uri, new vscode.Position(0, 0), '// Concurrent continuation edit\n')
            assert.equal(await vscode.workspace.applyEdit(concurrent), true)
            const changedBuffer = document.getText()
            const stale = await api.capabilities.invoke('customizer.sourceApply', another.continuation.input, { actor: 'agent' })
            assert.equal(stale.ok, false)
            if (!stale.ok) assert.equal(stale.error.code, 'STALE_SOURCE')
            assert.equal(document.getText(), changedBuffer)
            assert.equal(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(), original)
        } finally {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors')
            await vscode.workspace.fs.delete(uri)
        }
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
            while (!predicate()) { if (Date.now() >= deadline) assert.fail(`Timed out waiting for Customizer state: ${JSON.stringify({ text: document.getText(), active: vscode.window.activeTextEditor?.document.uri.toString(), tabs: vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => tab.label)) })}`); await new Promise((resolve) => setTimeout(resolve, 25)) }
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
            assert.ok(fix?.command)
            assert.equal(fix.edit, undefined, 'Quick Fixes must not carry stale WorkspaceEdit snapshots')
            const fixed = await vscode.commands.executeCommand<{ applied: boolean; verified: boolean }>(fix.command.command, ...fix.command.arguments!)
            assert.equal(fixed?.applied, true)
            assert.equal(fixed.verified, true)
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

    test('Customizer Problems obey configuration, save and close lifecycle in the real Host', async function () {
        const folder = vscode.workspace.workspaceFolders?.[0]
        if (!folder || !vscode.workspace.isTrusted) { this.skip(); return }
        const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'scad-ai-ide')!
        await extension.activate()
        const uri = vscode.Uri.joinPath(folder.uri, `customizer-lifecycle-${Date.now()}.scad`)
        const config = vscode.workspace.getConfiguration('scad-ai-ide.customizer', uri)
        const previous = config.inspect<boolean>('sourceDiagnostics')?.workspaceValue
        const problems = () => vscode.languages.getDiagnostics(uri).filter(d => d.source === 'OpenSCAD Customizer')
        const waitFor = async (check: () => boolean) => {
            const deadline = Date.now() + 5000
            while (!check()) {
                assert.ok(Date.now() < deadline, `Customizer Problems lifecycle did not settle: ${JSON.stringify({ closed: document.isClosed, problems: problems().map(d => d.code), active: vscode.window.activeTextEditor?.document.uri.toString(), tabs: vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => ({ label: tab.label, input: tab.input }))) })}`)
                await new Promise(resolve => setTimeout(resolve, 25))
            }
        }
        await vscode.workspace.fs.writeFile(uri, Buffer.from('width=40; // [10:0:100]\n'))
        const document = await vscode.workspace.openTextDocument(uri)
        let closingDocument: vscode.TextDocument | undefined
        await vscode.window.showTextDocument(document)
        try {
            await config.update('sourceDiagnostics', true, vscode.ConfigurationTarget.Workspace)
            await waitFor(() => problems().length === 1)
            await config.update('sourceDiagnostics', false, vscode.ConfigurationTarget.Workspace)
            await waitFor(() => problems().length === 0)
            await config.update('sourceDiagnostics', true, vscode.ConfigurationTarget.Workspace)
            await waitFor(() => problems().length === 1)
            const edit = new vscode.WorkspaceEdit()
            edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), 'width=40; // [10:100]\n')
            assert.equal(await vscode.workspace.applyEdit(edit), true)
            assert.equal(await document.save(), true)
            await waitFor(() => problems().length === 0)
            const invalid = new vscode.WorkspaceEdit()
            invalid.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), 'width=40; // [10:0:100]\n')
            assert.equal(await vscode.workspace.applyEdit(invalid), true)
            await waitFor(() => problems().length === 1)
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
            await waitFor(() => !vscode.window.activeTextEditor && problems().length === 0)
            // A saved file's model may remain cached after its last tab closes.
            // Discard an untitled .scad buffer to observe an actual document close.
            const closingUri = vscode.Uri.parse(`untitled:/customizer-close-${Date.now()}.scad`)
            closingDocument = await vscode.workspace.openTextDocument(closingUri)
            await vscode.window.showTextDocument(closingDocument)
            const create = new vscode.WorkspaceEdit()
            create.insert(closingUri, new vscode.Position(0, 0), 'width=40; // [10:0:100]\n')
            assert.equal(await vscode.workspace.applyEdit(create), true)
            const closingProblems = () => vscode.languages.getDiagnostics(closingUri).filter(d => d.source === 'OpenSCAD Customizer')
            await waitFor(() => closingProblems().length === 1)
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
            await waitFor(() => closingDocument!.isClosed && closingProblems().length === 0)
            await new Promise(resolve => setTimeout(resolve, 300))
            assert.deepEqual(closingProblems(), [], 'Pending debounce must not republish a closed document')
        } finally {
            if (closingDocument && !closingDocument.isClosed) {
                await vscode.window.showTextDocument(closingDocument)
                await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
            }
            if (!document.isClosed) {
                await vscode.window.showTextDocument(document)
                await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
            }
            await config.update('sourceDiagnostics', previous, vscode.ConfigurationTarget.Workspace)
            await vscode.workspace.fs.delete(uri)
            const api = await extension.activate() as Awaited<ReturnType<typeof activate>>
            api.customizer.clear()
        }
    })

    test('editor fixes use fresh commands outside the workspace and in untitled buffers, and reject readonly providers', async () => {
        const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'scad-ai-ide')!
        const api = await extension.activate() as Awaited<ReturnType<typeof activate>>
        const root = await mkdtemp(path.join(os.tmpdir(), 'customizer-editor-boundaries-'))
        const uri = vscode.Uri.file(path.join(root, 'outside.scad'))
        const original = 'width=40; // [10:0:100]\n'
        await writeFile(uri.fsPath, original)
        const document = await vscode.workspace.openTextDocument(uri)
        const pending: vscode.TextDocument[] = [document]
        const events = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
        const readonly = vscode.workspace.registerFileSystemProvider('customizer-readonly-test', {
            onDidChangeFile: events.event,
            watch: () => ({ dispose() {} }),
            stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: original.length, permissions: vscode.FilePermission.Readonly }),
            readFile: () => Buffer.from(original), readDirectory: () => [],
            writeFile: () => { throw vscode.FileSystemError.NoPermissions() },
            delete: () => { throw vscode.FileSystemError.NoPermissions() },
            rename: () => { throw vscode.FileSystemError.NoPermissions() },
            createDirectory: () => { throw vscode.FileSystemError.NoPermissions() },
        }, { isReadonly: true })
        const waitFor = async (check: () => boolean) => {
            const deadline = Date.now() + 5000
            while (!check()) { assert.ok(Date.now() < deadline, `Editor action state did not settle: ${JSON.stringify({ text: document.getText(), active: vscode.window.activeTextEditor?.document.uri.toString() })}`); await new Promise(resolve => setTimeout(resolve, 25)) }
        }
        const findFix = async (target: vscode.TextDocument) => {
            await waitFor(() => vscode.languages.getDiagnostics(target.uri).some(d => d.code === 'CUSTOMIZER_INVALID_RANGE'))
            const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', target.uri, new vscode.Range(0, 0, target.lineCount, 0))
            return actions?.find(action => action.title === 'Customizer: remove invalid explicit step')
        }
        try {
            await vscode.window.showTextDocument(document)
            await assert.rejects(api.customizerSource.analyze(uri.toString()), (error: unknown) => (error as { code: string }).code === 'OUTSIDE_WORKSPACE')
            const stale = await findFix(document)
            assert.ok(stale?.command)
            const edit = new vscode.WorkspaceEdit()
            edit.insert(uri, new vscode.Position(0, 0), '// Concurrent user edit\n')
            assert.equal(await vscode.workspace.applyEdit(edit), true)
            const rejected = await vscode.commands.executeCommand<{ applied: boolean; error: { code: string } }>(stale.command.command, ...stale.command.arguments!)
            assert.equal(rejected?.applied, false)
            assert.equal(rejected.error.code, 'STALE_SOURCE')
            assert.match(document.getText(), /Concurrent user edit/)
            assert.match(document.getText(), /10:0:100/)
            await waitFor(() => vscode.languages.getDiagnostics(uri).some(d => d.code === 'CUSTOMIZER_INVALID_RANGE' && d.range.start.line === 1))
            const fresh = await findFix(document)
            assert.ok(fresh?.command)
            const result = await vscode.commands.executeCommand<{ applied: boolean; verified: boolean }>(fresh.command.command, ...fresh.command.arguments!)
            assert.equal(result?.verified, true)
            assert.equal(document.getText(), '// Concurrent user edit\nwidth=40; // [10:100]\n')
            assert.equal(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(), original)
            const untitled = await vscode.workspace.openTextDocument(vscode.Uri.parse(`untitled:/customizer-editor-${Date.now()}.scad`))
            pending.push(untitled)
            await vscode.window.showTextDocument(untitled)
            const insert = new vscode.WorkspaceEdit()
            insert.insert(untitled.uri, new vscode.Position(0, 0), original)
            assert.equal(await vscode.workspace.applyEdit(insert), true)
            const unsavedFix = await findFix(untitled)
            assert.ok(unsavedFix?.command)
            const unsavedResult = await vscode.commands.executeCommand<{ verified: boolean; savedToDisk: boolean }>(unsavedFix.command.command, ...unsavedFix.command.arguments!)
            assert.equal(unsavedResult?.verified, true)
            assert.equal(unsavedResult.savedToDisk, false)
            assert.equal(untitled.getText(), 'width=40; // [10:100]\n')
            assert.equal(untitled.isDirty, true)
            const readOnly = await vscode.workspace.openTextDocument(vscode.Uri.parse('customizer-readonly-test:/model.scad'))
            pending.push(readOnly)
            await vscode.window.showTextDocument(readOnly)
            assert.equal(vscode.workspace.fs.isWritableFileSystem(readOnly.uri.scheme), false)
            assert.equal(await findFix(readOnly), undefined)
            assert.equal(readOnly.getText(), original)
        } finally {
            for (const target of pending.reverse()) if (!target.isClosed) {
                await vscode.window.showTextDocument(target)
                await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
            }
            readonly.dispose(); events.dispose(); api.customizer.clear()
            await rm(root, { recursive: true, force: true })
        }
    })

    for (const actor of ['agent', 'editor'] as const) {
        test(`${actor} source transaction preserves the earlier unsaved buffer through native Undo and Redo`, async function () {
            const folder = vscode.workspace.workspaceFolders?.[0]
            if (!folder || (actor === 'agent' && !vscode.workspace.isTrusted)) { this.skip(); return }
            const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'scad-ai-ide')!
            const api = await extension.activate() as Awaited<ReturnType<typeof activate>>
            const uri = vscode.Uri.joinPath(folder.uri, `customizer-undo-${actor}-${Date.now()}.scad`)
            const original = actor === 'agent' ? 'width=40;\n' : 'width=40; // [10:0:100]\n'
            await vscode.workspace.fs.writeFile(uri, Buffer.from(original))
            const document = await vscode.workspace.openTextDocument(uri)
            let phase = 'initial'
            const inputTrace: unknown[] = []
            const trace = vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document === document) inputTrace.push({ phase, version: document.version, reason: event.reason, changes: event.contentChanges.map(change => ({ offset: change.rangeOffset, length: change.rangeLength, text: change.text })), buffer: document.getText() })
            })
            const waitFor = async (check: () => boolean) => {
                const deadline = Date.now() + 5000
                while (!check()) { assert.ok(Date.now() < deadline, `Undo/Redo did not establish its exact buffer: ${JSON.stringify({ phase, buffer: document.getText(), inputTrace })}`); await new Promise(resolve => setTimeout(resolve, 25)) }
            }
            try {
                await vscode.window.showTextDocument(document)
                const earlier = new vscode.WorkspaceEdit()
                earlier.insert(uri, new vscode.Position(0, 0), '// Earlier unsaved user change\n')
                assert.equal(await vscode.workspace.applyEdit(earlier), true)
                const before = document.getText()
                phase = 'applying source transaction'
                if (actor === 'agent') {
                    const { identity } = await api.customizerSource.analyze(uri.toString())
                    const plan = await api.customizerSource.apply({ mode: 'plan', uri: uri.toString(), identity, edits: [{ kind: 'changeWidget', name: 'width', widget: 'slider', range: { min: 10, max: 100 } }] }) as { planId: string }
                    const applied = await api.customizerSource.apply({ mode: 'commit', planId: plan.planId }) as { semanticPass: boolean }
                    assert.equal(applied.semanticPass, true)
                } else {
                    await waitFor(() => vscode.languages.getDiagnostics(uri).some(d => d.code === 'CUSTOMIZER_INVALID_RANGE' && d.range.start.line === 1))
                    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', uri, new vscode.Range(0, 0, 2, 0))
                    const action = actions?.find(item => item.title === 'Customizer: remove invalid explicit step')
                    assert.ok(action?.command)
                    const applied = await vscode.commands.executeCommand<{ verified: boolean }>(action.command.command, ...action.command.arguments!)
                    assert.equal(applied?.verified, true)
                }
                const after = document.getText()
                phase = 'before native focus'
                assert.notEqual(after, before)
                assert.equal(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(), original)
                // Do not mark UI Undo as passed from WorkspaceEdit alone. Fail the
                // environment prerequisite explicitly if the native window is unfocusable.
                await focusTestEditor(document)
                phase = 'native undo'
                await vscode.commands.executeCommand('undo')
                await waitFor(() => document.getText() === before)
                assert.equal(document.isDirty, true)
                phase = 'native redo'
                await vscode.commands.executeCommand('redo')
                await waitFor(() => document.getText() === after)
            } finally {
                trace.dispose()
                if (!document.isClosed) {
                    await vscode.window.showTextDocument(document)
                    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
                }
                await vscode.workspace.fs.delete(uri)
                api.customizer.clear()
            }
        })
    }

})
