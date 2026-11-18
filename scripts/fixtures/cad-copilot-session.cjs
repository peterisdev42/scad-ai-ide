const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
exports.create = async (vscode, directory, model) => {
    const command = 'workbench.action.chat.newChat'
    assert.ok((await vscode.commands.getCommands(true)).includes(command), 'COPILOT_HARNESS_UNAVAILABLE: New Chat command absent')
    await vscode.commands.executeCommand(command)
    // Select without submitting a prompt, then inspect the resulting session.
    if (model) await vscode.commands.executeCommand('workbench.action.chat.open', { mode: 'agent', modelSelector: { vendor: 'agent-host-copilotcli', id: 'omlx/' + model } })
    let sessions = [],
        text = ''
    for (let i = 0; i < 30; i++) {
        await vscode.commands.executeCommand('workbench.action.chat.inspectChatModelReferences')
        const doc = vscode.window.activeTextEditor?.document
        text = doc?.getText() ?? ''
        assert.ok(text.startsWith('# Chat Model References'), 'COPILOT_HARNESS_UNAVAILABLE: cannot inspect real session identity')
        sessions = [...text.matchAll(/^- Session: (.+)$/gm)].map((m) => m[1].trim())
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
        if (sessions.some((s) => s.startsWith('agent-host-copilotcli:'))) break
        await new Promise((r) => setTimeout(r, 200))
    }
    const evidence = { requestedHarness: 'copilot', command, sessions, settings: { defaultToCopilot: vscode.workspace.getConfiguration('chat').get('defaultToCopilotHarness'), temporaryLocal: vscode.workspace.getConfiguration('chat').get('temporaryDefaultToLocalHarness') }, observedAt: new Date().toISOString() }
    await fs.writeFile(path.join(directory, 'harness-selection.json'), JSON.stringify(evidence, null, 2))
    assert.ok(
        sessions.some((s) => s.startsWith('agent-host-copilotcli:')),
        'COPILOT_HARNESS_UNAVAILABLE: actual Agent Host Copilot session absent; Local fallback forbidden',
    )
    return evidence
}
exports.exportSession = async (vscode, directory) => {
    const file = path.join(directory, 'copilot-chat-export.json')
    await vscode.commands.executeCommand('workbench.action.chat.export', vscode.Uri.file(file))
    return JSON.parse(await fs.readFile(file, 'utf8'))
}
