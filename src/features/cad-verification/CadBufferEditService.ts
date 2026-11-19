import * as vscode from 'vscode'
import { createHash, randomUUID } from 'node:crypto'
import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { SOURCE_LIMIT } from '../../core/customizer/CustomizerSourceAnalyzer'
import type { SourceDocumentIdentity, SourceTextEdit } from '../../core/customizer/CustomizerSourceTypes'
import { copyBufferEditPreview, previewBufferEdit, requireBufferEditApproval, showBufferEditConfirmation, type BufferEditPreview, type ConfirmBufferEdit } from '../../platform/BufferEditConfirmation'
import { applyCustomizerBufferEdits, assertDocumentIdentity } from '../../platform/CustomizerDocumentTransaction'
import { assertWorkspacePath } from '../../platform/WorkspacePaths'

const planLifetimeMs = 120_000
const toolName = 'scad_ai_ide_model_editBuffer'

interface EditPlan {
    document: vscode.TextDocument
    identity: SourceDocumentIdentity
    edit: SourceTextEdit
    preview: BufferEditPreview
    diskHash: string
    expires: number
}

export class CadBufferEditService implements vscode.Disposable {
    private readonly plans = new Map<string, EditPlan>()
    private disposed = false

    constructor(private readonly now: () => number = Date.now, private readonly confirm: ConfirmBufferEdit = showBufferEditConfirmation) {}

    private guard(signal?: AbortSignal) {
        if (this.disposed) throw new CapabilityError('DISPOSED', 'Extension session ended.')
        if (!vscode.workspace.isTrusted) throw new CapabilityError('UNTRUSTED_WORKSPACE', 'Buffer edits require Workspace Trust.')
        if (signal?.aborted) throw new CapabilityError('CANCELLED', 'Buffer edit cancelled.')
    }

    private guardDocument(document: vscode.TextDocument, identity: SourceDocumentIdentity) {
        assertDocumentIdentity(document, identity)
        if (!vscode.workspace.getWorkspaceFolder(document.uri) || !document.isDirty) throw new CapabilityError('TARGET_CHANGED', 'Target must remain an open, unsaved workspace document.')
        if (vscode.workspace.getConfiguration('files', document.uri).get('autoSave', 'off') !== 'off') {
            throw new CapabilityError('AUTO_SAVE_ENABLED', 'Turn off Auto Save for this file before planning a buffer-only edit.')
        }
    }

    private async hashDisk(uri: vscode.Uri) {
        return createHash('sha256').update(await vscode.workspace.fs.readFile(uri)).digest('hex')
    }

    async apply(input: Record<string, unknown>, signal?: AbortSignal) {
        this.guard(signal)
        for (const [id, plan] of this.plans) if (plan.expires <= this.now()) this.plans.delete(id)
        if (input.mode === 'plan') {
            let uri: vscode.Uri
            try { uri = vscode.Uri.parse(String(input.uri), true) } catch { throw new CapabilityError('INVALID_URI', 'Supply an explicit workspace .scad file URI.') }
            if (!uri.path.toLowerCase().endsWith('.scad')) throw new CapabilityError('INVALID_URI', 'Target must be an OpenSCAD source file.')
            await assertWorkspacePath(uri)
            this.guard(signal)
            const document = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === uri.toString())
            if (!document) throw new CapabilityError('TARGET_CHANGED', 'Open the target SCAD document and analyze its unsaved buffer first.')
            const identity = { ...(input.identity as Omit<SourceDocumentIdentity, 'uri'>), uri: uri.toString() }
            this.guardDocument(document, identity)
            const source = document.getText()
            const { oldText, newText } = input
            if (typeof oldText !== 'string' || typeof newText !== 'string' || !oldText.length) {
                throw new CapabilityError('INVALID_INPUT', 'Supply a non-empty original and different replacement.')
            }
            const replacement = newText.replace(/\r\n|\r|\n/g, document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n')
            if (oldText === replacement) throw new CapabilityError('INVALID_INPUT', 'Replacement matches the original text.')
            if (Buffer.byteLength(source, 'utf8') > SOURCE_LIMIT) throw new CapabilityError('LIMIT_EXCEEDED', 'Source exceeds 1 MiB.')
            const start = source.indexOf(oldText)
            if (start < 0 || source.indexOf(oldText, start + 1) !== -1) throw new CapabilityError('TEXT_MATCH_NOT_UNIQUE', 'Original text must occur exactly once in the current buffer.')
            const diskHash = await this.hashDisk(uri)
            this.guard(signal)
            this.guardDocument(document, identity)
            if (this.plans.size >= 32) throw new CapabilityError('LIMIT_EXCEEDED', 'Too many pending buffer edits.')
            const edit = { start, end: start + oldText.length, text: replacement }
            const preview = previewBufferEdit(document, edit)
            const planId = randomUUID()
            this.plans.set(planId, { document, identity, edit, preview, diskHash, expires: this.now() + planLifetimeMs })
            return { planId, identity: { ...identity }, preview: [copyBufferEditPreview(preview)], expiresInSeconds: planLifetimeMs / 1000,
                continuation: { tool: toolName, input: { mode: 'commit', planId }, requiresReview: true } }
        }
        if (input.mode !== 'commit') throw new CapabilityError('INVALID_INPUT', 'Use plan or commit.')
        const id = String(input.planId)
        const plan = this.plans.get(id)
        this.plans.delete(id)
        if (!plan) throw new CapabilityError('PLAN_EXPIRED', 'Plan expired or was already consumed.')
        const { document, identity, edit, preview, diskHash, expires } = plan
        const guard = () => {
            this.guard(signal)
            if (expires <= this.now()) throw new CapabilityError('PLAN_EXPIRED', 'Plan expired during confirmation.')
            this.guardDocument(document, identity)
        }
        await assertWorkspacePath(document.uri)
        guard()
        await requireBufferEditApproval(this.confirm, document.uri, [preview], signal)
        await assertWorkspacePath(document.uri)
        guard()
        if (await this.hashDisk(document.uri) !== diskHash) throw new CapabilityError('STALE_SOURCE', 'File on disk changed while the edit was pending.', true)
        await assertWorkspacePath(document.uri)
        guard()
        const original = document.getText()
        const expected = original.slice(0, edit.start) + edit.text + original.slice(edit.end)
        const applied = await applyCustomizerBufferEdits(document, identity, [edit], guard)
        const diskUnchanged = await this.hashDisk(document.uri) === diskHash
        if (applied.actual !== expected || document.isClosed || document.version !== applied.identity.version || !document.isDirty || !diskUnchanged) {
            throw new CapabilityError('POSTCONDITION_FAILED', 'Edit was submitted, but the final buffer or disk state differed. Inspect the current document before retrying.')
        }
        return { applied: true, identity: applied.identity, dirty: true, savedToDisk: false, diskUnchanged }
    }

    dispose() {
        this.disposed = true
        this.plans.clear()
    }
}
