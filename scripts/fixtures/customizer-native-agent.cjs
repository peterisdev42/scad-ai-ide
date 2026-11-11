const vscode = require('vscode')
const fs = require('node:fs/promises')
const path = require('node:path')

// Test-only observer. It records actual native Chat tool invocations without
// supplying tool calls, results, confirmations or synthetic model responses.
exports.run = async () => {
    const directory = process.env.SCAD_NATIVE_AGENT_DIRECTORY
    const traces = []
    const own = vscode.extensions.all.find(extension => extension.packageJSON.name === 'scad-ai-ide')
    const providerId = process.env.SCAD_NATIVE_AGENT_PROVIDER ?? 'Ollama.ollama'
    const vendor = process.env.SCAD_NATIVE_AGENT_VENDOR ?? 'ollama-models'
    const provider = vscode.extensions.getExtension(providerId)
    if (!own || !provider) throw new Error('The isolated native Agent host requires this extension and the selected installed provider')
    await provider.activate()
    if (process.env.SCAD_NATIVE_AGENT_SETUP_TOKEN === '1') {
        await fs.writeFile(path.join(directory, 'token-ui-requested'), 'Configure via provider password input, never an evidence file')
        await vscode.commands.executeCommand('omlx.setApiToken')
    }
    let nativeAgent = vscode.extensions.getExtension('GitHub.copilot-chat')
    let nativeAgentError
    try { await nativeAgent?.activate() } catch (error) { nativeAgentError = String(error) }
    const api = await own.activate()
    if (process.env.SCAD_AGENT_SCENARIO === 'preset') {
        const uri = vscode.Uri.file(path.join(directory, 'workspace/model.scad'))
        const preset = vscode.Uri.file(path.join(directory, 'workspace/model.json'))
        const bytes = JSON.stringify({ fileFormatVersion: '99', metadata: { sentinel: 'preserve exactly' }, parameterSets: { External: { label: 'abc' } } })
        await fs.writeFile(preset.fsPath, bytes)
        const document = await vscode.workspace.openTextDocument(uri)
        await vscode.window.showTextDocument(document)
        const state = await api.capabilities.invoke('customizer.state', {}, { actor: 'gui' })
        if (!state.ok) throw new Error('Preset setup state failed')
        const imported = await api.capabilities.invoke('customizer.importPresets', { target: state.data.target, revision: state.data.revision, uri: preset.toString() }, { actor: 'gui' })
        if (!imported.ok) throw new Error('Preset setup import failed')
        await fs.writeFile(path.join(directory, 'preset-setup.json'), JSON.stringify({ scope: 'Fixture setup before model dispatch; not a model tool call', before: bytes, imported }, null, 2))
    }
    const original = api.capabilities.invoke.bind(api.capabilities)
    api.capabilities.invoke = async (...args) => {
        const trace = { capability: args[0], input: args[1], started: new Date().toISOString() }
        traces.push(trace)
        try { trace.output = await original(...args); return trace.output }
        catch (error) { trace.error = String(error); throw error }
        finally { await fs.writeFile(path.join(directory, 'tool-traces.json'), JSON.stringify(traces, null, 2)) }
    }
    const models = await vscode.lm.selectChatModels({ vendor })
    await fs.writeFile(path.join(directory, 'ready.json'), JSON.stringify({
        vscode: vscode.version,
        extensionMode: own.extensionMode,
        extensionPath: own.extensionPath,
        bundleSha256: require('node:crypto').createHash('sha256').update(await fs.readFile(path.join(own.extensionPath, own.packageJSON.main))).digest('hex'),
        chatSettings: { saveBeforeSend: vscode.workspace.getConfiguration('chat').get('saveBeforeSend'), autoSave: vscode.workspace.getConfiguration('files').get('autoSave'), extensionUnification: vscode.workspace.getConfiguration('chat').get('extensionUnification.enabled'), disableAI: vscode.workspace.getConfiguration('chat').get('disableAIFeatures'), extensionTools: vscode.workspace.getConfiguration('chat').get('extensionTools.enabled') },
        nativeAgent: { present: !!nativeAgent, active: nativeAgent?.isActive, error: nativeAgentError },
        provider: { id: provider.id, version: provider.packageJSON.version },
        models: models.map(model => ({ id: model.id, name: model.name, vendor: model.vendor, toolCalling: model.capabilities?.toolCalling, maxInputTokens: model.maxInputTokens })),
    }, null, 2))
    let pending
    const read = async name => { try { return await fs.readFile(path.join(directory, name), 'utf8') } catch { return undefined } }
    while (!(await read('finish'))) {
        const raw = await read('request.json')
        if (raw && JSON.parse(raw).snapshot) {
            await fs.rm(path.join(directory, 'request.json'))
            const request = JSON.parse(raw)
            if (request.cancel) await vscode.commands.executeCommand('workbench.action.chat.cancel')
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(request.file))
            await fs.writeFile(path.join(directory, 'response.json'), JSON.stringify({ snapshot: true, cancelledForSnapshot: !!request.cancel, stopReason: request.stopReason, buffer: doc.getText(), dirty: doc.isDirty, operations: api.capabilities.operations.status(undefined, 0, 100) }, null, 2))
            continue
        }
        if (raw && !pending) {
            await fs.rm(path.join(directory, 'request.json'))
            const request = JSON.parse(raw)
            pending = (async () => {
                try {
                    if (request.inspect) {
                        await vscode.commands.executeCommand('extension.open', 'GitHub.copilot-chat')
                        await new Promise(resolve => setTimeout(resolve, 1500))
                        await fs.writeFile(path.join(directory, 'response.json'), JSON.stringify({ inspection: true, installedIds: vscode.extensions.all.map(extension => extension.id) }, null, 2))
                        return
                    }
                    const uri = vscode.Uri.file(request.file)
                    const document = await vscode.workspace.openTextDocument(uri)
                    await vscode.window.showTextDocument(document)
                    const edit = new vscode.WorkspaceEdit()
                    edit.insert(uri, new vscode.Position(0, 0), '// Unsaved Native Agent acceptance buffer\n')
                    await vscode.workspace.applyEdit(edit)
                    await fs.writeFile(path.join(directory, 'buffer-before.scad'), document.getText())
                    await vscode.commands.executeCommand('workbench.action.chat.newChat')
                    const result = await vscode.commands.executeCommand('workbench.action.chat.open', {
                        query: request.query, mode: 'agent', modelSelector: { vendor, id: request.model },
                        attachFiles: [uri], toolsInclude: request.toolsInclude, blockOnResponse: true,
                    })
                    await fs.writeFile(path.join(directory, 'response.json'), JSON.stringify({ result, buffer: document.getText(), dirty: document.isDirty, operations: api.capabilities.operations.status(undefined, 0, 100) }, null, 2))
                } catch (error) {
                    await fs.writeFile(path.join(directory, 'response.json'), JSON.stringify({ error: String(error), stack: error.stack }, null, 2))
                } finally { pending = undefined }
            })()
        }
        await new Promise(resolve => setTimeout(resolve, 100))
    }
    await vscode.commands.executeCommand('workbench.action.chat.cancel')
    // The UI controller preserves the isolated directory for inspection; source
    // buffers are never implicitly saved by this observer.
}
