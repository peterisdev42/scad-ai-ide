import { CancellationToken, CustomDocumentOpenContext, CustomReadonlyEditorProvider, ExtensionContext, Uri, WebviewPanel } from 'vscode'
import { MeshPreviewDocument } from '../core/MeshPreviewDocument'
import { meshFormat } from '../services/previewFile'
import { ScadWebviewPanel } from './ScadWebviewPanel'

export class MeshPreviewEditorProvider implements CustomReadonlyEditorProvider<MeshPreviewDocument> {
    constructor(private readonly context: ExtensionContext) {}

    openCustomDocument(uri: Uri, _context: CustomDocumentOpenContext, token: CancellationToken): MeshPreviewDocument {
        const format = meshFormat(uri.path)
        if (!format || token.isCancellationRequested) throw new Error('Mesh preview cancelled or unsupported file type.')
        return new MeshPreviewDocument(uri, format)
    }

    resolveCustomEditor(document: MeshPreviewDocument, panel: WebviewPanel, token: CancellationToken): void {
        if (token.isCancellationRequested) return
        new ScadWebviewPanel(panel, this.context.extensionUri, document, this.context.workspaceState)
        void document.refreshRender()
    }
}
