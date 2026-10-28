import { commands, window } from 'vscode'
import { RuntimeUnavailableError } from '../../../../core/runtime/errors'

/** Route setup failures to Runtime management and compiler failures to their output. */
export async function showRenderError(error: Error, showOutput: () => void): Promise<void> {
    const missingRuntime = error instanceof RuntimeUnavailableError
    const action = missingRuntime ? 'Install OpenSCAD CLI' : 'Show Output'
    const message = missingRuntime ? error.message : `OpenSCAD render failed: ${error.message.split('\n')[0]}`
    const choice = await window.showErrorMessage(message, action)
    if (choice !== action) return
    if (missingRuntime) {
        await commands.executeCommand('scad-ai.runtime.open', 'available')
    } else {
        showOutput()
    }
}
