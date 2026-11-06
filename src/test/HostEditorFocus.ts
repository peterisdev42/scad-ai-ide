import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'

/** ActiveTextEditor does not prove native window/text focus. In desktop test runs
 * a background window can acknowledge Undo/type without editing the model. */
export async function focusTestEditor(document: vscode.TextDocument) {
    await vscode.window.showTextDocument(document, { preserveFocus: false })
    if (process.platform === 'darwin' && process.env.SCAD_TEST_FOCUS_HELPER) {
        const pid = process.env.VSCODE_PID
        assert.ok(pid && /^\d+$/.test(pid), 'Native test main PID is unavailable')
        assert.ok(process.env.SCAD_TEST_FOCUS_APP, 'Supply the exact cached test application bundle')
        const result = await promisify(execFile)(process.env.SCAD_TEST_FOCUS_HELPER, [pid, process.env.SCAD_TEST_FOCUS_APP], { timeout: 5000 })
        console.log(result.stdout.trim())
    }
    const commands = await vscode.commands.getCommands(true)
    if (commands.includes('workbench.action.focusWindow')) await vscode.commands.executeCommand('workbench.action.focusWindow')
    else if (commands.includes('workbench.action.focusMainWindow')) await vscode.commands.executeCommand('workbench.action.focusMainWindow')
    const deadline = Date.now() + 5000
    while (!vscode.window.state.focused) {
        assert.ok(Date.now() < deadline, 'Native test window did not gain focus')
        await new Promise(resolve => setTimeout(resolve, 25))
    }
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
    while (vscode.window.activeTextEditor?.document !== document) {
        assert.ok(Date.now() < deadline, 'Target editor did not gain focus')
        await new Promise(resolve => setTimeout(resolve, 25))
    }
}
