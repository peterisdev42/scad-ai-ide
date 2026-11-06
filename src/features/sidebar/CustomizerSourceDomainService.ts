import * as vscode from 'vscode'
import { createHash, randomUUID } from 'node:crypto'
import { assertWorkspacePath } from '../../platform/WorkspacePaths'
import { CapabilityError, type CapabilityContext } from '../../core/capabilities/CapabilityTypes'
import { analyzeCustomizerSource, SOURCE_LIMIT } from '../../core/customizer/CustomizerSourceAnalyzer'
import { planCustomizerEdits } from '../../core/customizer/CustomizerSourceEditor'
import { validateCustomizerSource } from '../../core/customizer/CustomizerSourceValidator'
import type { SourceDocumentIdentity, SourceEditIntent, SourceExpectation } from '../../core/customizer/CustomizerSourceTypes'

export const sourceIdentity = (document: vscode.TextDocument): SourceDocumentIdentity => ({ uri: document.uri.toString(), version: document.version, sha256: createHash('sha256').update(document.getText(), 'utf8').digest('hex') })
type Plan = ReturnType<typeof planCustomizerEdits> & { identity: SourceDocumentIdentity; expires: number }

/** Explicit buffer access, workspace boundaries and single-use source CAS, independent of Overrides. */
export class CustomizerSourceDomainService implements vscode.Disposable {
    constructor(private readonly now: () => number = Date.now) {}
    private readonly cache = new Map<string, { key: string; analysis: ReturnType<typeof analyzeCustomizerSource> }>()
    private readonly changed = vscode.workspace.onDidChangeTextDocument((event) => this.cache.delete(event.document.uri.toString()))
    private readonly plans = new Map<string, Plan>()
    private readonly closed = vscode.workspace.onDidCloseTextDocument((document) => {
        this.cache.delete(document.uri.toString())
        for (const [id, plan] of this.plans) { if (plan.identity.uri === document.uri.toString()) this.plans.delete(id) }
    })
    private async document(target: string) {
        let uri: vscode.Uri
        try { uri = vscode.Uri.parse(target, true) } catch { throw new CapabilityError('INVALID_URI', 'Supply an explicit workspace .scad file URI.') }
        if (!uri.path.toLowerCase().endsWith('.scad') || uri.scheme !== 'file' || uri.query || uri.fragment || uri.authority) throw new CapabilityError('INVALID_URI', 'Use a .scad file URI on the extension host; virtual documents are unsupported.')
        try { await assertWorkspacePath(uri) } catch (error) {
            throw new CapabilityError('OUTSIDE_WORKSPACE', `Source target is unavailable or outside the canonical workspace: ${(error as Error).message}`)
        }
        // Reject lexical aliases even when canonical resolution enters the workspace.
        if (!vscode.workspace.getWorkspaceFolder(uri)) throw new CapabilityError('OUTSIDE_WORKSPACE', 'URI must belong to a workspace folder.')
        const document = await vscode.workspace.openTextDocument(uri)
        if (document.isClosed) throw new CapabilityError('TARGET_CHANGED', 'Source document closed.')
        if (Buffer.byteLength(document.getText(), 'utf8') > SOURCE_LIMIT) throw new CapabilityError('LIMIT_EXCEEDED', 'Source exceeds 1 MiB.')
        return document
    }
    private trust() { if (!vscode.workspace.isTrusted) throw new CapabilityError('UNTRUSTED_WORKSPACE', 'Source editing requires Workspace Trust.') }
    private cancel(context?: CapabilityContext) { if (context?.signal?.aborted) throw new CapabilityError('CANCELLED', 'Source operation cancelled.') }
    private check(document: vscode.TextDocument, identity: SourceDocumentIdentity) {
        const current = sourceIdentity(document)
        if (document.isClosed || current.uri !== identity.uri) throw new CapabilityError('TARGET_CHANGED', 'Source target changed or closed.')
        if (current.version !== identity.version || current.sha256 !== identity.sha256) throw new CapabilityError('STALE_SOURCE', 'Source changed. Analyze and plan again.', true)
    }
    async analyze(uri: string, options: { includeCandidates?: boolean; maxDiagnostics?: number } = {}) {
        const document = await this.document(uri)
        const identity = sourceIdentity(document)
        const key = `${identity.version}:${identity.sha256}:${options.includeCandidates !== false}:${options.maxDiagnostics ?? 100}`
        let cached = this.cache.get(identity.uri)
        if (cached?.key !== key) {
            cached = { key, analysis: analyzeCustomizerSource(document.getText(), options) }
            if (this.cache.size >= 16) this.cache.delete(this.cache.keys().next().value!)
            this.cache.set(identity.uri, cached)
        }
        return { identity, ...JSON.parse(JSON.stringify(cached.analysis)) as typeof cached.analysis }
    }
    async validate(uri: string, expectations: SourceExpectation[] = [], includeWarnings = true) {
        const document = await this.document(uri)
        return { identity: sourceIdentity(document), ...validateCustomizerSource(document.getText(), expectations, includeWarnings) }
    }
    async apply(input: Record<string, unknown>, context?: CapabilityContext) {
        this.trust(); this.cancel(context)
        for (const [id, plan] of this.plans) { if (plan.expires <= this.now()) this.plans.delete(id) }
        if (input.mode === 'plan') {
            const document = await this.document(String(input.uri))
            this.trust(); this.cancel(context)
            const identity = sourceIdentity(document)
            this.check(document, { uri: String(input.uri), ...input.identity as Omit<SourceDocumentIdentity, 'uri'> })
            if (this.plans.size >= 32) throw new CapabilityError('LIMIT_EXCEEDED', 'Too many pending plans; wait for expiry.')
            const planned = planCustomizerEdits(document.getText(), input.edits as SourceEditIntent[])
            const preview = planned.edits.map((edit) => ({ range: { start: document.positionAt(edit.start), end: document.positionAt(edit.end) }, before: document.getText().slice(edit.start, edit.end), after: edit.text }))
            if (Buffer.byteLength(JSON.stringify(preview), 'utf8') > 32768) throw new CapabilityError('LIMIT_EXCEEDED', 'Plan preview exceeds 32 KiB; use a smaller batch.')
            const planId = randomUUID()
            this.plans.set(planId, { ...planned, identity, expires: this.now() + 120000 })
            return { planId, identity, summary: `Update Customizer source: ${planned.changedParameters.join(', ')}`, preview, validation: { ...planned.validation, pass: planned.validation.semanticPass }, expiresInSeconds: 120 }
        }
        if (input.mode !== 'commit') throw new CapabilityError('INVALID_INPUT', 'Use plan or commit.')
        const plan = this.plans.get(String(input.planId))
        this.plans.delete(String(input.planId))
        if (!plan || plan.expires <= this.now()) throw new CapabilityError('PLAN_EXPIRED', 'Plan expired or already consumed. Analyze and plan again.')
        const document = await this.document(plan.identity.uri)
        this.trust(); this.cancel(context); this.check(document, plan.identity)
        const edit = new vscode.WorkspaceEdit()
        for (const replacement of plan.edits) edit.replace(document.uri, new vscode.Range(document.positionAt(replacement.start), document.positionAt(replacement.end)), replacement.text)
        // No await between the final CAS and submitting the WorkspaceEdit. VS Code also
        // tracks document versions when forwarding WorkspaceEdit to the main thread.
        const applied = plan.edits.length === 0 || await vscode.workspace.applyEdit(edit)
        if (!applied) throw new CapabilityError('POSTCONDITION_FAILED', 'WorkspaceEdit was rejected; no success is claimed.')
        const actual = document.getText()
        const validated = validateCustomizerSource(actual, plan.expectations)
        const postValidation = { ...validated, pass: validated.semanticPass }
        return { applied: true, identity: sourceIdentity(document), changedParameters: plan.changedParameters, postValidation, semanticPass: postValidation.semanticPass && actual === plan.source && !document.isClosed, ...(!postValidation.semanticPass || actual !== plan.source || document.isClosed ? { error: { code: 'POSTCONDITION_FAILED', message: 'Buffer differs from the planned result. Inspect current source and use Undo if needed.' } } : {}), savedToDisk: false }
    }
    dispose() { this.plans.clear(); this.cache.clear(); this.closed.dispose(); this.changed.dispose() }
}
