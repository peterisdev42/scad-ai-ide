import { normalizeCliDiagnostics } from '../../../../core/cad/diagnostics'
import * as vscode from 'vscode'
import { createHash } from 'node:crypto'
import type { VerificationReport } from '../../../../core/cad/types'

export interface PreviewProblemEntry {
    uri: vscode.Uri
    diagnostic: vscode.Diagnostic
    issueId?: string
}
export const OPEN_PREVIEW_PROBLEM_SOURCE = 'scad-ai-ide.preview.openProblemSource'
interface ProblemResult {
    source: vscode.Uri
    stamp?: string
    entries: PreviewProblemEntry[]
    dependencies: string[]
    reportId?: string
    valid?: () => Promise<boolean>
}

/** The single document-level collection, shared by CLI/Agent/Preview owners. */
export class PreviewSourceProblems implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection('scad-ai-ide-preview-source')
    private readonly results = new Map<string, ProblemResult>()
    private readonly subscriptions: vscode.Disposable[]
    private disposed = false
    private sequence = 0
    private readonly pending = new Map<string, number>()

    constructor() {
        this.subscriptions = [
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.contentChanges.length) this.invalidate(event.document.uri)
            }),
            vscode.workspace.onDidOpenTextDocument((document) => {
                for (const result of this.results.values())
                    if (result.source.toString() === document.uri.toString() && result.stamp !== this.stamp(document.uri)) {
                        this.invalidate(document.uri)
                        break
                    }
            }),
            vscode.workspace.onDidDeleteFiles((event) => event.files.forEach((uri) => this.invalidate(uri))),
            vscode.workspace.onDidRenameFiles((event) => event.files.forEach((file) => this.invalidate(file.oldUri))),
        ]
        if (vscode.languages.onDidChangeDiagnostics) this.subscriptions.push(vscode.languages.onDidChangeDiagnostics(() => this.publish()))
    }
    stamp(uri: vscode.Uri) {
        const document = vscode.workspace.textDocuments.find((doc) => !doc.isClosed && doc.uri.toString() === uri.toString())
        return document && createHash('sha256').update(document.getText()).digest('hex')
    }
    private key(source: vscode.Uri, owner: string) {
        return `${source.toString()}\n${owner}`
    }
    report(source: vscode.Uri, entries: PreviewProblemEntry[], stamp = this.stamp(source), owner = 'preview') {
        if (this.disposed || stamp !== this.stamp(source)) return
        this.set(this.key(source, owner), { source, stamp, entries, dependencies: entries.map((e) => e.uri.toString()) })
    }
    private set(key: string, result: ProblemResult) {
        result.entries = result.entries.slice(0, 100)
        for (const entry of result.entries) entry.diagnostic.message = entry.diagnostic.message.slice(0, 2048)
        this.results.delete(key)
        this.results.set(key, result)
        while (this.results.size > 128) this.results.delete(this.results.keys().next().value!)
        this.publish()
    }
    async reportVerification(report: VerificationReport, valid: () => Promise<boolean>, owner = 'agent') {
        const source = vscode.Uri.parse(report.snapshot.document.uri)
        const key = this.key(source, owner),
            ticket = ++this.sequence
        this.pending.set(key, ticket)
        if (this.disposed || !(await valid()) || this.pending.get(key) !== ticket) return false
        const entries = report.issues.map((issue) => {
            const location = issue.location
            const uri = location ? vscode.Uri.parse(location.uri) : source
            const line = Math.max(0, location?.line ?? 0)
            const exact = location?.confidence === 'exact'
            const message = `${exact ? '' : 'Model-level issue; location unavailable. '}${issue.title}`
            const severity = issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : issue.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information
            const diagnostic = new vscode.Diagnostic(new vscode.Range(line, 0, line, 0), message.slice(0, 8192), severity)
            diagnostic.source = 'OpenSCAD CLI'
            diagnostic.code = issue.code
            diagnostic.relatedInformation = uri.toString() === source.toString() ? undefined : [new vscode.DiagnosticRelatedInformation(new vscode.Location(source, new vscode.Range(0, 0, 0, 0)), `Report ${report.reportId}; snapshot ${report.snapshot.id}`)]
            return { uri, diagnostic, issueId: issue.id }
        })
        this.pending.delete(key)
        this.set(key, { source, stamp: report.snapshot.document.sourceSha256, entries, reportId: report.reportId, dependencies: report.snapshot.dependencies.map((d) => d.uri), valid })
        return true
    }
    clear(source: vscode.Uri, owner = 'preview') {
        if (this.disposed) return
        const key = this.key(source, owner)
        this.results.delete(key)
        this.pending.delete(key)
        this.publish()
    }
    invalidate(uri: vscode.Uri) {
        const key = uri.toString()
        this.pending.clear()
        for (const [owner, result] of this.results) if (result.source.toString() === key || result.dependencies.includes(key) || result.entries.some((e) => e.uri.toString() === key)) this.results.delete(owner)
        this.publish()
    }
    invalidateAll() {
        this.pending.clear()
        this.results.clear()
        this.publish()
    }
    async revalidate() {
        for (const [key, result] of [...this.results]) {
            if (result.valid && !(await result.valid()) && this.results.get(key) === result) this.results.delete(key)
        }
        this.publish()
    }
    first(source: vscode.Uri) {
        return [...this.results.values()].find((r) => r.source.toString() === source.toString() && r.entries.length)?.entries[0]
    }
    async open(source: vscode.Uri) {
        const result = [...this.results].find(([, r]) => r.source.toString() === source.toString() && r.entries.length)
        return result ? this.openOwned(result[0], result[1].reportId ?? result[1].stamp ?? '', 0) : false
    }
    private async openOwned(key: string, revision: string, index: number) {
        if (this.disposed) return false
        const result = this.results.get(key)
        if (!result || (result.reportId ?? result.stamp ?? '') !== revision || !result.entries[index]) return false
        if (result.valid && !(await result.valid())) {
            this.results.delete(key)
            this.publish()
            return false
        }
        await vscode.workspace.openTextDocument(result.source)
        if (this.results.get(key) !== result || result.stamp !== this.stamp(result.source)) return false
        if (result.valid && !(await result.valid())) return false
        const entry = result.entries[index]
        await vscode.commands.executeCommand('vscode.openWith', entry.uri, 'default', { selection: entry.diagnostic.range, preview: false })
        return true
    }
    private async openLegacy(uri: string, message: string, line: number) {
        const matches = [...this.results].flatMap(([key, result]) => result.entries.flatMap((entry, index) => (entry.uri.toString() === uri && entry.diagnostic.message === message && entry.diagnostic.range.start.line === line ? [{ key, result, index }] : [])))
        // Old invocations carry no owner. Reject ambiguity instead of navigating another root.
        if (matches.length !== 1) return false
        const { key, result, index } = matches[0]
        return this.openOwned(key, result.reportId ?? result.stamp ?? '', index)
    }
    registerNavigation(): vscode.Disposable {
        return vscode.Disposable.from(
            vscode.commands.registerCommand(OPEN_PREVIEW_PROBLEM_SOURCE, (key: unknown, revision: unknown, index: unknown) => {
                if (typeof key !== 'string' || typeof revision !== 'string' || !Number.isInteger(index)) return false
                return this.results.has(key) ? this.openOwned(key, revision, index as number) : this.openLegacy(key, revision, index as number)
            }),
            vscode.languages.registerCodeActionsProvider(
                [{ pattern: '**/*.[sS][cC][aA][dD]' }, { pattern: '**/*.[cC][sS][gG]' }],
                {
                    provideCodeActions: (document, range, context) =>
                        [...this.results].flatMap(([key, result]) =>
                            result.entries.flatMap((entry, index) => {
                                if (entry.uri.toString() !== document.uri.toString() || !entry.diagnostic.range.intersection(range) || !context.diagnostics.some((d) => d.source === entry.diagnostic.source && d.message === entry.diagnostic.message && d.range.isEqual(entry.diagnostic.range))) return []
                                const action = new vscode.CodeAction('Preview: open source at this error', vscode.CodeActionKind.QuickFix)
                                action.diagnostics = [entry.diagnostic]
                                action.command = { command: OPEN_PREVIEW_PROBLEM_SOURCE, title: action.title, arguments: [key, result.reportId ?? result.stamp ?? '', index] }
                                return [action]
                            }),
                        ),
                },
                { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
            ),
        )
    }
    private publish() {
        if (this.disposed) return
        const grouped = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[]; seen: Set<string> }>()
        let count = 0
        for (const result of this.results.values())
            for (const entry of result.entries) {
                if (count >= 512) break
                const key = entry.uri.toString(),
                    d = entry.diagnostic
                const group = grouped.get(key) ?? { uri: entry.uri, diagnostics: [], seen: new Set<string>() }
                let semanticCode = d.code, semanticMessage = d.message
                if (d.source === 'OpenSCAD Preview' && d.code === 'PREVIEW_RENDER_FAILED') {
                    const normalized = normalizeCliDiagnostics(d.message, 0)
                    if (normalized.length === 1 && normalized[0].line === d.range.start.line && normalized[0].code !== 'SCAD_CLI_ERROR') {
                        semanticCode = normalized[0].code
                        semanticMessage = normalized[0].message.replace(/\s+in file\s+.+?,?\s*(?:,\s*)?line\s+\d+.*$/i, '').trim()
                    }
                }
                const fingerprint = JSON.stringify([semanticCode, d.range.start, d.range.end, semanticMessage, d.severity])
                if (group.seen.has(fingerprint)) continue
                // Only exact semantic/code/range matches are suppressed; evidence stays in its report.
                const duplicateLsp = d.source === 'OpenSCAD CLI' && vscode.languages.getDiagnostics?.(entry.uri).some((other) => other.source !== 'OpenSCAD CLI' && other.source !== 'OpenSCAD Preview' && other.code === d.code && other.severity === d.severity && other.message === d.message && other.range.isEqual(d.range))
                if (!duplicateLsp) {
                    group.seen.add(fingerprint)
                    group.diagnostics.push(d)
                    count++
                }
                grouped.set(key, group)
            }
        // Avoid a diagnostics-event feedback loop by writing only changed projections.
        const next = JSON.stringify([...grouped].map(([key, group]) => [key, group.diagnostics.map((d) => [d.message, d.code, d.severity, d.range])]))
        if (next === this.published) return
        this.published = next
        this.collection.clear()
        for (const { uri, diagnostics } of grouped.values()) this.collection.set(uri, diagnostics)
    }
    private published = ''
    dispose() {
        if (this.disposed) return
        this.disposed = true
        this.subscriptions.forEach((s) => s.dispose())
        this.pending.clear()
        this.results.clear()
        this.collection.dispose()
    }
}
