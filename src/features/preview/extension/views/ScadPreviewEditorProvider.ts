import { CancellationToken, CustomTextEditorProvider, ExtensionContext, TextDocument, WebviewPanel } from 'vscode'
import { ScadSessionManager } from '../core/ScadSessionManager'
import { ScadWebviewPanel } from './ScadWebviewPanel'

/** The workbench owns this panel and replaces the source tab with it. */
export class ScadPreviewEditorProvider implements CustomTextEditorProvider {
    constructor(
        private readonly context: ExtensionContext,
        private readonly sessionManager: ScadSessionManager,
    ) {}

    resolveCustomTextEditor(document: TextDocument, panel: WebviewPanel, token: CancellationToken): void {
        if (token.isCancellationRequested) return
        const session = this.sessionManager.getOrCreateSession(document)
        new ScadWebviewPanel(panel, this.context.extensionUri, session, this.context.workspaceState)
        panel.onDidDispose(() => this.sessionManager.removeSession(document.uri))
    }
}
