import * as vscode from 'vscode'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { previewErrorDetails } from './renderDiagnostics'
import { EmptyModelError } from './previewEligibility'

/** One view owns its diagnostics, including errors attributed to included files. */
export class PreviewProblems implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection()
    private readonly issues = new Map<'render' | 'view', Array<{ uri: vscode.Uri; diagnostic: vscode.Diagnostic }>>()
    private disposed = false

    constructor(private readonly document: vscode.Uri) {}

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
        this.issues.set(stage, issues)
        this.publish()
    }

    clear(stage: 'render' | 'view') {
        if (this.disposed) return
        this.issues.delete(stage)
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
