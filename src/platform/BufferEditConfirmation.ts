import * as vscode from 'vscode'
import { CapabilityError } from '../core/capabilities/CapabilityTypes'
import type { SourceTextEdit } from '../core/customizer/CustomizerSourceTypes'

export interface BufferEditPreview {
    range: { start: { line: number; character: number }; end: { line: number; character: number } }
    before: string
    after: string
}

export function copyBufferEditPreview(preview: BufferEditPreview): BufferEditPreview {
    return { ...preview, range: { start: { ...preview.range.start }, end: { ...preview.range.end } } }
}

export function previewBufferEdit(document: vscode.TextDocument, { start, end, text }: SourceTextEdit): BufferEditPreview {
    const position = (offset: number) => {
        const { line, character } = document.positionAt(offset)
        return { line, character }
    }
    return { range: { start: position(start), end: position(end) }, before: document.getText().slice(start, end), after: text }
}

export type ConfirmBufferEdit = (uri: vscode.Uri, preview: readonly BufferEditPreview[]) => Promise<boolean>

export const showBufferEditConfirmation: ConfirmBufferEdit = async (uri, preview) => {
    const detail = preview.map(({ range, before, after }) =>
        `Line ${range.start.line + 1}, column ${range.start.character + 1}\nBefore: ${JSON.stringify(before)}\nAfter: ${JSON.stringify(after)}`,
    ).join('\n\n')
    return await vscode.window.showWarningMessage(`Apply unsaved source edits to ${uri.fsPath}?`, { modal: true, detail }, 'Apply', 'Skip') === 'Apply'
}

export async function requireBufferEditApproval(
    confirm: ConfirmBufferEdit,
    uri: vscode.Uri,
    preview: readonly BufferEditPreview[],
    signal?: AbortSignal,
) {
    const cancelled = () => new CapabilityError('CANCELLED', 'Source edit cancelled.')
    if (signal?.aborted) throw cancelled()
    let onAbort: (() => void) | undefined
    try {
        const approved = await (signal ? Promise.race([
            new Promise<never>((_, reject) => {
                onAbort = () => reject(cancelled())
                signal.addEventListener('abort', onAbort, { once: true })
            }),
            confirm(uri, preview),
        ]) : confirm(uri, preview))
        if (!approved || signal?.aborted) throw cancelled()
    } finally {
        if (onAbort) signal?.removeEventListener('abort', onAbort)
    }
}
