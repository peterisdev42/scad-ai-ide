const vscode = require('vscode')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
exports.run = async () => {
    const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')
    assert.ok(extension)
    assert.ok(extension.extensionPath.startsWith(process.env.SCAD_SMOKE_EXTENSIONS_DIR))
    const api = await extension.activate()
    const waitFor = async condition => {
        const deadline = Date.now() + 5000
        while (!(await condition())) {
            assert.ok(Date.now() < deadline, 'Installed Host observation timed out')
            await new Promise(resolve => setTimeout(resolve, 25))
        }
    }
    const names = extension.packageJSON.contributes.languageModelTools.map((tool) => tool.name)
    for (const name of names) assert.ok(vscode.lm.tools.some((tool) => tool.name === name), name)
    const availableChatModels = (await vscode.lm.selectChatModels()).length
    const result = await vscode.lm.invokeTool('scad_ai_ide_development_status', { input: {}, toolInvocationToken: undefined })
    const state = JSON.parse(result.content[0].value)
    assert.equal(state.ok, true)
    assert.equal(state.data.enabled, false)
    const denied = await api.capabilities.invoke('development.listCaches', {}, { actor: 'agent' })
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'DEVELOPMENT_ONLY')
    assert.equal(api.panels.getPanel('libraries'), undefined)
    assert.equal(api.panels.getPanel('runtime'), undefined)
    const folder = vscode.workspace.workspaceFolders?.[0]
    assert.ok(folder, 'Installed source smoke requires its isolated workspace')
    const sourceUri = vscode.Uri.joinPath(folder.uri, 'source-authoring.scad')
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from('width=40;\nmodule model() { cube([width,2,3]); }\n'))
    const sourceDocument = await vscode.workspace.openTextDocument(sourceUri)
    await vscode.window.showTextDocument(sourceDocument)
    const analysis = await vscode.lm.invokeTool('scad_ai_ide_customizer_sourceAnalyze', { input: { uri: sourceUri.toString() }, toolInvocationToken: undefined })
    const analyzed = JSON.parse(analysis.content[0].value)
    assert.equal(analyzed.ok, true)
    const unmetResult = await vscode.lm.invokeTool('scad_ai_ide_customizer_sourceValidate', { input: { uri: sourceUri.toString(), expectations: [{ name: 'width', widget: 'slider' }] }, toolInvocationToken: undefined })
    const unmet = JSON.parse(unmetResult.content[0].value)
    assert.equal(unmet.ok, true)
    assert.equal(unmet.data.semanticPass, false)
    assert.deepEqual(unmet.data.diagnostics, [])
    assert.equal(unmet.data.expectationResults[0].matched, false)
    const { version, sha256 } = analyzed.data.identity
    const planned = await api.capabilities.invoke('customizer.sourceApply', { mode: 'plan', uri: sourceUri.toString(), identity: { version, sha256 }, edits: [{ kind: 'changeWidget', name: 'width', widget: 'slider', range: { min: 10, max: 100, step: 5 } }] }, { actor: 'agent' })
    assert.equal(planned.ok, true, JSON.stringify(planned))
    assert.equal(planned.data.continuation.tool, 'scad_ai_ide_customizer_sourceApply')
    assert.ok(names.includes(planned.data.continuation.tool))
    assert.deepEqual(planned.data.continuation.input, { mode: 'commit', planId: planned.data.planId })
    assert.equal(planned.data.continuation.requiresReview, true)
    assert.equal(sourceDocument.isDirty, false, 'Plan continuation does not auto-execute')
    const committed = await api.capabilities.invoke('customizer.sourceApply', planned.data.continuation.input, { actor: 'agent' })
    assert.equal(committed.ok, true, JSON.stringify(committed))
    assert.equal(committed.data.semanticPass, true)
    assert.equal(committed.data.savedToDisk, false)
    assert.equal(sourceDocument.isDirty, true)
    const validation = await vscode.lm.invokeTool('scad_ai_ide_customizer_sourceValidate', { input: { uri: sourceUri.toString(), expectations: [{ name: 'width', widget: 'slider', range: { min: 10, max: 100, step: 5 } }] }, toolInvocationToken: undefined })
    const validated = JSON.parse(validation.content[0].value)
    assert.equal(validated.ok, true)
    assert.equal(validated.data.semanticPass, true)
    const appliedText = sourceDocument.getText()
    const diskText = Buffer.from(await vscode.workspace.fs.readFile(sourceUri)).toString()
    await vscode.commands.executeCommand('undo')
    await waitFor(() => sourceDocument.getText() === diskText)
    await vscode.commands.executeCommand('redo')
    await waitFor(() => sourceDocument.getText() === appliedText)
    const reused = await api.capabilities.invoke('customizer.sourceApply', planned.data.continuation.input, { actor: 'agent' })
    assert.equal(reused.ok, false)
    assert.equal(reused.error.code, 'PLAN_EXPIRED')
    assert.doesNotMatch(Buffer.from(await vscode.workspace.fs.readFile(sourceUri)).toString(), /\[10:5:100\]/)
    const sourceAuthoring = { analyzed, unmet, planned, committed, validated, singleUseRejected: true, unsavedSource: sourceDocument.getText(), diskUnchanged: true }
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
    await vscode.workspace.fs.delete(sourceUri)
    const overrideUri = vscode.Uri.joinPath(folder.uri, 'override.scad')
    const overrideSource = 'width=40;\nmodule m(){}\nwidth=50;\n'
    await vscode.workspace.fs.writeFile(overrideUri, Buffer.from(overrideSource))
    const overrideDocument = await vscode.workspace.openTextDocument(overrideUri)
    await vscode.window.showTextDocument(overrideDocument)
    const warnings = () => vscode.languages.getDiagnostics(overrideUri).filter(d => d.code === 'CUSTOMIZER_PARAMETER_OVERRIDDEN')
    await waitFor(() => warnings().length === 1)
    const warning = warnings()[0]
    assert.equal(warning.severity, vscode.DiagnosticSeverity.Warning)
    assert.equal(warning.range.start.line, 2)
    assert.equal(warning.relatedInformation[0].location.range.start.line, 0)
    const overrideAnalysis = await api.capabilities.invoke('customizer.sourceAnalyze', { uri: overrideUri.toString() }, { actor: 'agent' })
    assert.ok(overrideAnalysis.ok)
    assert.deepEqual(overrideAnalysis.data.parameters, [])
    const removal = new vscode.WorkspaceEdit()
    removal.delete(overrideUri, new vscode.Range(2, 0, 3, 0))
    assert.ok(await vscode.workspace.applyEdit(removal))
    await waitFor(() => warnings().length === 0)
    assert.equal(overrideDocument.isDirty, true)
    assert.equal(Buffer.from(await vscode.workspace.fs.readFile(overrideUri)).toString(), overrideSource)
    const adr12 = { warning: true, primaryLine: 2, relatedLine: 0, controlsLost: true, unsavedRepairClearsWarning: true, diskUnchanged: true }
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
    await vscode.workspace.fs.delete(overrideUri)
    const snapshotUri = vscode.Uri.joinPath(folder.uri, 'snapshot.scad')
    const snapshotFile = vscode.Uri.joinPath(folder.uri, 'snapshot.json')
    const snapshotSource = 'label="abcdef"; // 3\ncube(1);\n'
    await vscode.workspace.fs.writeFile(snapshotUri, Buffer.from(snapshotSource))
    const snapshotDocument = await vscode.workspace.openTextDocument(snapshotUri)
    await vscode.window.showTextDocument(snapshotDocument)
    const snapshotState = async () => {
        const result = await api.capabilities.invoke('customizer.state', {}, { actor: 'agent' })
        assert.ok(result.ok)
        return result.data
    }
    const snapshotAction = async (id, input) => {
        const state = await snapshotState()
        return api.capabilities.invoke(id, { target: state.target, revision: state.revision, ...input }, { actor: 'agent' })
    }
    const beforeSnapshot = await snapshotState()
    assert.equal(beforeSnapshot.target, snapshotUri.toString())
    const invalidSnapshot = await snapshotAction('customizer.createPreset', { name: 'Invalid' })
    assert.equal(invalidSnapshot.ok, false)
    assert.equal(invalidSnapshot.error.code, 'PRESET_INVALID_VALUE')
    assert.deepEqual(await snapshotState(), beforeSnapshot)
    await assert.rejects(async () => vscode.workspace.fs.stat(snapshotFile), error => error.code === 'FileNotFound')
    for (const [id, input] of [
        ['customizer.set', { values: { label: 'abc' } }],
        ['customizer.createPreset', { name: 'Valid' }],
        ['customizer.applyPreset', { name: '' }],
        ['customizer.applyPreset', { name: 'Valid' }],
    ]) {
        const result = await snapshotAction(id, input)
        assert.ok(result.ok, JSON.stringify(result))
    }
    assert.equal(api.customizer.getOverrides(snapshotUri.toString()).label, 'abc')
    assert.equal(snapshotDocument.getText(), snapshotSource)
    assert.equal(snapshotDocument.isDirty, false)
    assert.equal(Buffer.from(await vscode.workspace.fs.readFile(snapshotUri)).toString(), snapshotSource)
    const presetSnapshot = { invalidRejectedBeforeWrite: true, invalidErrorCode: invalidSnapshot.error.code, rejectedStateUnchanged: true, validSnapshotReplayed: true, sourceUnchanged: true, sourceDirty: false }
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    api.customizer.clear()
    await vscode.workspace.fs.delete(snapshotUri)
    await vscode.workspace.fs.delete(snapshotFile)
    await fs.writeFile(process.env.SCAD_SMOKE_RESULT, JSON.stringify({ vscode: vscode.version, extension: extension.id, toolCount: names.length, availableChatModels, productionDevDenied: true, sourceAuthoring, undoRedo: true, adr12, presetSnapshot, panelsRequired: false, instructions: extension.packageJSON.contributes.chatInstructions, skills: extension.packageJSON.contributes.chatSkills }, null, 2))
}
