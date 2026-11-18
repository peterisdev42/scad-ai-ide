const vscode = require('vscode')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash, randomUUID } = require('node:crypto')
async function atomicText(file, content) {
    const temp = file + '.' + randomUUID() + '.tmp'
    await fs.writeFile(temp, content, { mode: 0o600 })
    await fs.rename(temp, file)
}

/** Observe a real native session. Decisions arrive only from its separately reviewed test controller. */
exports.run = async (context) => {
    const directory = path.dirname(__dirname)
    const config = JSON.parse(await fs.readFile(path.join(directory, 'native-config.json'), 'utf8'))
    const own = vscode.extensions.all.find((e) => e.packageJSON.name === 'scad-ai-ide')
    const provider = vscode.extensions.getExtension('techopolis.omlx-copilot-chat')
    assert.ok(own && provider)
    assert.equal(path.resolve(own.extensionPath), path.resolve(config.ideExtension))
    await atomicText(path.join(directory, 'observer-storage.json'), JSON.stringify({ storageUri: context.storageUri?.fsPath }))
    await provider.activate()
    const native = vscode.extensions.getExtension('GitHub.copilot-chat')
    await native?.activate()
    const api = await own.activate()
    for (let i = 0; i < 100 && !api.cad.availability().enabled; i++) await new Promise((r) => setTimeout(r, 100))
    const observation = await require('./cad-native-observation.cjs').attach(vscode, context, config, api, directory)
    const models = await vscode.lm.selectChatModels({ vendor: 'omlx' })
    await atomicText(
        path.join(directory, 'ready.json'),
        JSON.stringify(
            {
                vscode: vscode.version,
                extensionPath: own.extensionPath,
                extensionMode: own.extensionMode,
                bundleSha256: createHash('sha256')
                    .update(await fs.readFile(path.join(own.extensionPath, own.packageJSON.main)))
                    .digest('hex'),
                workspace: vscode.workspace.workspaceFolders.map((f) => f.uri.toString()),
                provider: { id: provider.id, version: provider.packageJSON.version },
                nativeAgent: { present: !!native, active: !!native?.isActive },
                chatSettings: { saveBeforeSend: vscode.workspace.getConfiguration('chat').get('saveBeforeSend'), autoSave: vscode.workspace.getConfiguration('files').get('autoSave') },
                tools: vscode.lm.tools.filter((t) => /read.*file|replaceString|get.?errors/i.test(t.name)).map((t) => ({ name: t.name, description: t.description?.slice(0, 512) })),
                models: models.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, maxInputTokens: m.maxInputTokens })),
            },
            null,
            2,
        ),
    )
    const uri = vscode.Uri.file(config.file)
    const snapshot = async () => {
        const doc = await vscode.workspace.openTextDocument(uri)
        return {
            snapshot: true,
            buffer: doc.getText(),
            dirty: doc.isDirty,
            disk: await fs.readFile(config.file, 'utf8'),
            manifestDiskHash: createHash('sha256')
                .update(await fs.readFile(config.manifest))
                .digest('hex'),
            manifestBufferHash: createHash('sha256')
                .update((await vscode.workspace.openTextDocument(vscode.Uri.file(config.manifest))).getText())
                .digest('hex'),
            bufferHash: createHash('sha256').update(doc.getText()).digest('hex'),
            diskHash: createHash('sha256')
                .update(await fs.readFile(config.file))
                .digest('hex'),
            problems: vscode.languages.getDiagnostics(uri).map((d) => ({ code: d.code, source: d.source, message: d.message, line: d.range.start.line })),
            operations: api.capabilities.operations.status(undefined, 0, 100),
        }
    }
    const read = async (name) => {
        try {
            return await fs.readFile(path.join(directory, name), 'utf8')
        } catch {
            return undefined
        }
    }
    let pending
    while (!(await read('finish'))) {
        const raw = await read('request.json')
        if (raw) {
            const request = JSON.parse(raw)
            await fs.rm(path.join(directory, 'request.json'))
            if (request.snapshot) {
                if (request.cancel) await vscode.commands.executeCommand('workbench.action.chat.cancel')
                await atomicText(path.join(directory, 'response.json'), JSON.stringify(await snapshot(), null, 2))
            } else if (request.reviewedApproval) {
                // This is a test-only native button action, never a product tool permission flag.
                const doc = await vscode.workspace.openTextDocument(uri)
                await observation.validate(request, doc)
                await vscode.commands.executeCommand('workbench.action.chat.acceptTool')
                await atomicText(path.join(directory, 'approval-ack.json'), JSON.stringify({ nativeAction: 'workbench.action.chat.acceptTool', toolId: request.toolId, oldString: request.oldString, newString: request.newString, authorization: request.authorization }, null, 2))
            } else if (!pending) {
                pending = (async () => {
                    try {
                        assert.equal(await fs.realpath(request.file), await fs.realpath(config.file))
                        assert.ok(vscode.workspace.getWorkspaceFolder(uri), 'The fixture must actually be in this window workspace')
                        const doc = await vscode.workspace.openTextDocument(uri)
                        await vscode.window.showTextDocument(doc)
                        if (config.dirtySetup !== false) {
                            const setup = new vscode.WorkspaceEdit()
                            setup.insert(uri, new vscode.Position(0, 0), '// Unsaved Native Agent acceptance buffer\n')
                            assert.equal(await vscode.workspace.applyEdit(setup), true)
                        }
                        await atomicText(path.join(directory, 'buffer-before.scad'), doc.getText())
                        await require('./cad-copilot-session.cjs').create(vscode, directory, request.model)
                        await observation.command('started', { model: request.model })
                        const result = await vscode.commands.executeCommand('workbench.action.chat.open', { query: request.query, mode: 'agent', modelSelector: { vendor: 'agent-host-copilotcli', id: 'omlx/' + request.model }, attachFiles: [uri, vscode.Uri.file(config.manifest), vscode.Uri.file(path.join(config.ideExtension, config.skill ?? 'skills/openscad-model-debugging/SKILL.md'))], toolsInclude: request.toolsInclude, blockOnResponse: true })
                        await require('./cad-copilot-session.cjs').exportSession(vscode, directory)
                        await observation.command(result?.type === 'confirmation' ? 'confirmation' : 'completed', { resultType: result?.type })
                        await atomicText(path.join(directory, 'response.json'), JSON.stringify({ result, ...(await snapshot()), snapshot: false }, null, 2))
                    } catch (error) {
                        await atomicText(path.join(directory, 'response.json'), JSON.stringify({ error: String(error), stack: error.stack }))
                    } finally {
                        pending = undefined
                    }
                })()
            }
        }
        await new Promise((r) => setTimeout(r, 100))
    }
    await observation.command('cleanup')
    await observation.flush()
    await vscode.commands.executeCommand('workbench.action.chat.cancel')
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())
    if (doc) {
        await vscode.window.showTextDocument(doc)
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
    }
    await vscode.commands.executeCommand('workbench.action.closeWindow')
}
