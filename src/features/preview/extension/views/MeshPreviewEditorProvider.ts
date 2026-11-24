import type { PreviewSourceProblems } from '../services/PreviewSourceProblems'
import { CancellationToken, CustomDocumentOpenContext, CustomReadonlyEditorProvider, Event, ExtensionContext, Uri, WebviewPanel } from 'vscode'
import { MeshPreviewDocument } from '../core/MeshPreviewDocument'
import { meshFormat } from '../services/previewFile'
import { ScadClient } from '../services/ScadClient'
import { ModelFormat } from '../../shared/types/ModelFormat'
import { ScadWebviewPanel } from './ScadWebviewPanel'

export class MeshPreviewEditorProvider implements CustomReadonlyEditorProvider<MeshPreviewDocument> {
    constructor(private readonly context: ExtensionContext, private readonly sourceProblems: PreviewSourceProblems, private readonly onRuntimeChanged: Event<void>) {}

    openCustomDocument(uri: Uri, _context: CustomDocumentOpenContext, token: CancellationToken): MeshPreviewDocument {
        const format = meshFormat(uri.path)
        if (!format || token.isCancellationRequested) throw new Error('Mesh preview cancelled or unsupported file type.')
        return new MeshPreviewDocument(uri, format, format === ModelFormat.Nef3 ? (signal) => ScadClient.renderNef3(uri.fsPath, signal) : undefined)
    }

    resolveCustomEditor(document: MeshPreviewDocument, panel: WebviewPanel, token: CancellationToken): void {
        if (token.isCancellationRequested) return
        new ScadWebviewPanel(panel, this.context.extensionUri, document, this.context.workspaceState, this.sourceProblems)
        if (document.sourceFormat === ModelFormat.Nef3) {
            const subscription = this.onRuntimeChanged(() => void document.refreshRender())
            panel.onDidDispose(() => subscription.dispose())
        }
        void document.refreshRender()
    }
}
