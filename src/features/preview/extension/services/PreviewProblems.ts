import { PreviewSourceProblems } from './PreviewSourceProblems'
import * as vscode from 'vscode'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { previewErrorDetails } from './renderDiagnostics'
import { EmptyModelError } from './previewEligibility'

/** View failures belong to this view; compiler results belong to the document store. */
export class PreviewProblems implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection()
    private readonly issues = new Map<'view', Array<{ uri: vscode.Uri; diagnostic: vscode.Diagnostic }>>()
    private disposed = false

    private renderStamp?: string
    constructor(private readonly document: vscode.Uri, private readonly sources: PreviewSourceProblems) { this.beginRender() }

    beginRender() { this.renderStamp = this.sources.stamp(this.document) }
    openSource() { return this.sources.open(this.document) }
    get hasSourceProblem() { return !!this.sources.first(this.document) }

    report(error: unknown, stage: 'render' | 'view') {
        if (this.disposed) return
        if (error instanceof Error && (error.message === 'Render cancelled' || error.name === 'AbortError')) return
        const empty = error instanceof EmptyModelError
        const issues = previewErrorDetails(error).map(detail => {
            const name = detail.file
            const uri = !name || ['-', '<stdin>', 'stdin'].includes(name) || name === basename(this.document.fsPath)
                ? this.document
                : vscode.Uri.file(isAbsolute(name) ? name : resolve(dirname(this.document.fsPath), name))
            const line = Math.max(0, (detail.line ?? 1) - 1)
            const diagnostic = new vscode.Diagnostic(new vscode.Range(line, 0, line, 0), detail.message, empty ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Error)
            diagnostic.source = 'OpenSCAD Preview'
            diagnostic.code = empty ? 'PREVIEW_EMPTY_MODEL' : stage === 'view' ? 'PREVIEW_VIEW_FAILED' : 'PREVIEW_RENDER_FAILED'
            if (uri.toString() !== this.document.toString()) diagnostic.relatedInformation = [new vscode.DiagnosticRelatedInformation(new vscode.Location(this.document, new vscode.Range(0, 0, 0, 0)), 'Reported while previewing this document.')]
            return { uri, diagnostic }
        })
        if (stage === 'render' && /\.(scad|csg)$/i.test(this.document.path)) { this.sources.report(this.document, issues, this.renderStamp); return }
        this.issues.set('view', issues)
        this.publish()
    }

    clear(stage: 'render' | 'view') {
        if (this.disposed) return
        if (stage === 'render' && /\.(scad|csg)$/i.test(this.document.path)) { this.sources.clear(this.document); return }
        this.issues.delete('view')
        this.publish()
    }

    private publish() {
        this.collection.clear()
        const grouped = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>()
        for (const issue of [...this.issues.values()].flat()) {
            const key = issue.uri.toString()
            const group = grouped.get(key) ?? { uri: issue.uri, diagnostics: [] }
            group.diagnostics.push(issue.diagnostic)
            grouped.set(key, group)
        }
        for (const { uri, diagnostics } of grouped.values()) this.collection.set(uri, diagnostics)
    }

    dispose() {
        this.disposed = true
        this.issues.clear()
        this.collection.dispose()
    }
}
