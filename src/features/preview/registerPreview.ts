import * as vscode from 'vscode'
import { RuntimeUnavailableError } from '../../core/runtime/errors'
import type { CustomizerService } from '../../core/customizer/CustomizerService'
import type { registerRuntime } from '../runtime/registerRuntime'
import { previewEditorViewType, registerShowPanelCommand } from './extension/commands/showPanel'
import { ScadSessionManager } from './extension/core/ScadSessionManager'
import { ScadClient } from './extension/services/ScadClient'
import { MeshPreviewEditorProvider } from './extension/views/MeshPreviewEditorProvider'
import { meshPreviewEditorViewType } from './extension/services/previewFile'
import { ScadPreviewEditorProvider } from './extension/views/ScadPreviewEditorProvider'
import { configureCsgWorker } from '../../core/csg/compile'

export function registerPreview(context: vscode.ExtensionContext, runtime: ReturnType<typeof registerRuntime>, customizer: CustomizerService) {
    configureCsgWorker(vscode.Uri.joinPath(context.extensionUri, 'dist', 'csg-worker.mjs').fsPath)
    const sessions = new ScadSessionManager(customizer)
    const runtimeIdentity = () => {
        const active = runtime.getActiveRuntime()
        return active ? JSON.stringify({ id: active.id, version: active.version, command: active.command }) : undefined
    }
    let previousRuntime = runtimeIdentity()
    let runtimeWasInstalling = false
    ScadClient.configure(async () => {
        await runtime.whenReady()
        const active = runtime.getActiveRuntime()
        if (!active) {
            throw new RuntimeUnavailableError()
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
        vscode.window.registerCustomEditorProvider(meshPreviewEditorViewType, new MeshPreviewEditorProvider(context), {
            webviewOptions: { enableFindWidget: true },
            supportsMultipleEditorsPerDocument: false,
        }),
        runtime.onDidChange(() => {
            const state = runtime.getState()
            runtimeWasInstalling ||= !!state.installing
            if (state.busy || state.selectingId || state.installing || state.deletingId) return
            const currentRuntime = runtimeIdentity()
            // Release loading, account updates and unchanged scans do not affect rendering.
            const shouldRefresh = currentRuntime !== previousRuntime || (runtimeWasInstalling && currentRuntime !== undefined)
            previousRuntime = currentRuntime
            runtimeWasInstalling = false
            if (shouldRefresh) sessions.refresh()
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('scad-ai-ide.preview')) {
                sessions.refresh()
            }
        }),
    )
    return sessions
}
