import { PreviewSourceProblems } from './extension/services/PreviewSourceProblems'
import type { CustomizerDomainService } from '../sidebar/CustomizerDomainService'
import { libraryEnvironment } from '../../platform/libraries/LibraryEnvironment'
import * as vscode from 'vscode'
import type { CustomizerService } from '../../core/customizer/CustomizerService'
import type { registerRuntime } from '../runtime/registerRuntime'
import { previewEditorViewType, registerShowPanelCommand } from './extension/commands/showPanel'
import { ScadSessionManager } from './extension/core/ScadSessionManager'
import { MeshPreviewEditorProvider } from './extension/views/MeshPreviewEditorProvider'
import { csgPreviewEditorViewType, drawingPreviewEditorViewType, meshPreviewEditorViewType } from './extension/services/previewFile'
import { ScadPreviewEditorProvider } from './extension/views/ScadPreviewEditorProvider'
import { DrawingPreviewEditorProvider } from './extension/views/DrawingPreviewEditorProvider'
import { configureMeshTopologyWorker } from '../../core/formats/meshTopology'
import { registerPreviewExporter } from './extension/services/PreviewExporter'

export function registerPreview(context: vscode.ExtensionContext, runtime: ReturnType<typeof registerRuntime>, customizer: CustomizerService, domain?: CustomizerDomainService, sharedProblems?: PreviewSourceProblems) {
    registerPreviewExporter(context)
    configureMeshTopologyWorker(vscode.Uri.joinPath(context.extensionUri, 'dist', 'mesh-topology-worker.mjs').fsPath)
    const sourceProblems = sharedProblems ?? new PreviewSourceProblems()
    if (!sharedProblems) context.subscriptions.push(sourceProblems, sourceProblems.registerNavigation())
    const sessions = new ScadSessionManager(customizer, domain)
    const runtimeChanged = new vscode.EventEmitter<void>()
    const scadEditor = new ScadPreviewEditorProvider(context, sessions, sourceProblems)
    const editorOptions = { webviewOptions: { enableFindWidget: true }, supportsMultipleEditorsPerDocument: false }
    const runtimeIdentity = () => {
        const active = runtime.getActiveRuntime()
        return active ? JSON.stringify({ id: active.id, version: active.version, command: active.command }) : undefined
    }
    let previousRuntime = runtimeIdentity()
    let runtimeWasInstalling = false
    context.subscriptions.push(
        sessions,
        runtimeChanged,
        libraryEnvironment.onDidChange(() => sessions.refresh()),
        registerShowPanelCommand(),
        vscode.window.registerCustomEditorProvider(previewEditorViewType, scadEditor, editorOptions),
        vscode.window.registerCustomEditorProvider(csgPreviewEditorViewType, scadEditor, editorOptions),
        vscode.window.registerCustomEditorProvider(meshPreviewEditorViewType, new MeshPreviewEditorProvider(context, sourceProblems, runtimeChanged.event), editorOptions),
        vscode.window.registerCustomEditorProvider(drawingPreviewEditorViewType, new DrawingPreviewEditorProvider(context.extensionUri), editorOptions),
        runtime.onDidChange(() => {
            const state = runtime.getState()
            runtimeWasInstalling ||= !!state.installing
            if (state.busy || state.selectingId || state.installing || state.deletingId) return
            const currentRuntime = runtimeIdentity()
            // Release loading, account updates and unchanged scans do not affect rendering.
            const shouldRefresh = currentRuntime !== previousRuntime || (runtimeWasInstalling && currentRuntime !== undefined)
            previousRuntime = currentRuntime
            runtimeWasInstalling = false
            if (shouldRefresh) {
                sessions.refresh()
                runtimeChanged.fire()
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
