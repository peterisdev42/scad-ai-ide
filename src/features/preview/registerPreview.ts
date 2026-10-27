import * as vscode from 'vscode'
import type { CustomizerService } from '../../core/customizer/CustomizerService'
import type { registerRuntime } from '../runtime/registerRuntime'
import { previewEditorViewType, registerShowPanelCommand } from './extension/commands/showPanel'
import { ScadSessionManager } from './extension/core/ScadSessionManager'
import { ScadClient } from './extension/services/ScadClient'
import { ScadPreviewEditorProvider } from './extension/views/ScadPreviewEditorProvider'

export function registerPreview(context: vscode.ExtensionContext, runtime: ReturnType<typeof registerRuntime>, customizer: CustomizerService) {
    const sessions = new ScadSessionManager(customizer)
    ScadClient.configure(async () => {
        await runtime.whenReady()
        const active = runtime.getActiveRuntime()
        if (!active) {
            throw new Error('No OpenSCAD runtime available. Run SCAD AI IDE: Select OpenSCAD Runtime.')
        }
        return active.command
    })
    context.subscriptions.push(
        ScadClient.outputChannel,
        { dispose: () => ScadClient.dispose() },
        sessions,
        registerShowPanelCommand(),
        vscode.window.registerCustomEditorProvider(previewEditorViewType, new ScadPreviewEditorProvider(context, sessions), {
            webviewOptions: { enableFindWidget: true },
            supportsMultipleEditorsPerDocument: false,
        }),
        runtime.onDidChange(() => {
            const state = runtime.getState()
            if (!state.busy && !state.selectingId && !state.installing) {
                sessions.refresh()
            }
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('scad-ai-ide.preview')) {
                sessions.refresh()
            }
        }),
    )
    return sessions
}
