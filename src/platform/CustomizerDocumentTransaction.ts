import * as vscode from 'vscode'
import { createHash } from 'node:crypto'
import { CapabilityError } from '../core/capabilities/CapabilityTypes'
import type { SourceDocumentIdentity, SourceTextEdit } from '../core/customizer/CustomizerSourceTypes'

export const textHash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
export const documentIdentity = (document: vscode.TextDocument): SourceDocumentIdentity => ({ uri: document.uri.toString(), version: document.version, sha256: textHash(document.getText()) })

export function assertDocumentIdentity(document: vscode.TextDocument, expected: SourceDocumentIdentity) {
    const current = documentIdentity(document)
    if (document.isClosed || current.uri !== expected.uri) throw new CapabilityError('TARGET_CHANGED', 'Source target changed or closed.')
    if (current.version !== expected.version || current.sha256 !== expected.sha256) throw new CapabilityError('STALE_SOURCE', 'Source changed. Analyze and plan again.', true)
}

/** Shared transaction mechanics, not shared authorization. Each adapter supplies
 * its own target, trust, workspace and cancellation checks through guard. */
export async function applyCustomizerBufferEdits(document: vscode.TextDocument, identity: SourceDocumentIdentity, replacements: SourceTextEdit[], guard: () => void = () => {}) {
    const edit = new vscode.WorkspaceEdit()
    for (const replacement of replacements) edit.replace(document.uri, new vscode.Range(document.positionAt(replacement.start), document.positionAt(replacement.end)), replacement.text)
    guard()
    assertDocumentIdentity(document, identity)
    // No await between the final identity/authorization check and submission.
    const applied = replacements.length === 0 || await vscode.workspace.applyEdit(edit)
    if (!applied) throw new CapabilityError('POSTCONDITION_FAILED', 'WorkspaceEdit was rejected; no success is claimed.')
    return { actual: document.getText(), identity: documentIdentity(document), closed: document.isClosed }
}
