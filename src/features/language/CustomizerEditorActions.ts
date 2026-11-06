import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { applySourceEdits } from '../../core/customizer/CustomizerSourceEditor'
import { utf8Length } from '../../core/customizer/CustomizerConstraints'
import { SOURCE_LIMIT } from '../../core/customizer/CustomizerSourceAnalyzer'
import type { SourceDocumentIdentity, SourceTextEdit } from '../../core/customizer/CustomizerSourceTypes'
import { applyCustomizerBufferEdits, documentIdentity, textHash } from '../../platform/CustomizerDocumentTransaction'

export const CUSTOMIZER_EDITOR_ACTION = 'scad-ai-ide.customizer.applySourceAction'
interface EditorPlan { identity: SourceDocumentIdentity; edits: SourceTextEdit[]; expectedHash: string; expires: number }
export interface CustomizerActionExecutor {
    canEdit(document: vscode.TextDocument): boolean
    prepare(document: vscode.TextDocument, plan: { edits: SourceTextEdit[]; source: string }, title: string): vscode.Command
}

/** Editor actions are user-invoked static edits. They do not inherit Agent's
 * workspace/trust restriction, cannot run source, and never silently save it. */
export class CustomizerEditorActions implements CustomizerActionExecutor, vscode.Disposable {
    private readonly plans = new Map<string, EditorPlan>()
    private readonly closed: vscode.Disposable
    constructor(private readonly now: () => number = Date.now) {
        this.closed = vscode.workspace.onDidCloseTextDocument(document => {
            for (const [id, plan] of this.plans) if (plan.identity.uri === document.uri.toString()) this.plans.delete(id)
        })
    }
    canEdit(document: vscode.TextDocument) {
        return !document.isClosed && (document.uri.scheme === 'untitled' || vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) === true)
    }
    prepare(document: vscode.TextDocument, plan: { edits: SourceTextEdit[]; source: string }, title: string): vscode.Command {
        if (!this.canEdit(document)) throw new CapabilityError('READ_ONLY_DOCUMENT', 'This document provider is read-only.')
        if (utf8Length(document.getText()) > SOURCE_LIMIT || plan.edits.length > 50 || utf8Length(JSON.stringify(plan.edits)) > 32768) throw new CapabilityError('LIMIT_EXCEEDED', 'Editor fix exceeds the bounded source-edit limits.')
        for (const [id, pending] of this.plans) if (pending.expires <= this.now()) this.plans.delete(id)
        // Editor entries keep only patches + hashes (not full source snapshots).
        // Encoded patch payload is <=1 MiB, separate from the unchanged Agent pool;
        // JS object/UTF-16 and identity overhead is additional but bounded by 32 entries.
        if (this.plans.size >= 32) this.plans.delete(this.plans.keys().next().value!)
        const expected = applySourceEdits(document.getText(), plan.edits)
        if (expected !== plan.source) throw new CapabilityError('POSTCONDITION_FAILED', 'Editor plan does not reproduce its validated source.')
        const id = randomUUID()
        this.plans.set(id, { identity: documentIdentity(document), edits: plan.edits.map(edit => ({ ...edit })), expectedHash: textHash(expected), expires: this.now() + 120000 })
        return { title, command: CUSTOMIZER_EDITOR_ACTION, arguments: [id] }
    }
    async commit(id: string) {
        const plan = this.plans.get(id)
        this.plans.delete(id)
        if (!plan || plan.expires <= this.now()) throw new CapabilityError('PLAN_EXPIRED', 'Editor action expired or was already used. Request it again.')
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(plan.identity.uri))
        const result = await applyCustomizerBufferEdits(document, plan.identity, plan.edits, () => {
            if (!this.canEdit(document)) throw new CapabilityError('READ_ONLY_DOCUMENT', 'This document is closed or read-only.')
        })
        const verified = !result.closed && textHash(result.actual) === plan.expectedHash
        return { applied: true, verified, identity: result.identity, savedToDisk: false, ...(!verified ? { error: { code: 'POSTCONDITION_FAILED', message: 'The buffer differs from the validated fix. Inspect it and use Undo if needed.' } } : {}) }
    }
    dispose() { this.closed.dispose(); this.plans.clear() }
}
