import * as vscode from 'vscode'
import { createHash } from 'node:crypto'

export interface PreviewProblemEntry { uri: vscode.Uri; diagnostic: vscode.Diagnostic }
export const OPEN_PREVIEW_PROBLEM_SOURCE = 'scad-ai-ide.preview.openProblemSource'

/** Workspace validation results outlive the Webview that requested them.
 * Closed files retain their last result, like compiler Problems, with a bounded
 * history. Buffer changes invalidate root and included-file results immediately. */
export class PreviewSourceProblems implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection('scad-ai-ide-preview-source')
    private readonly results = new Map<string, { source: vscode.Uri; stamp?: string; entries: PreviewProblemEntry[] }>()
    private readonly subscriptions: vscode.Disposable[]
    private disposed = false

    constructor() {
        this.subscriptions = [
            vscode.workspace.onDidChangeTextDocument(event => { if (event.contentChanges.length) this.invalidate(event.document.uri) }),
            vscode.workspace.onDidOpenTextDocument(document => {
                const result = this.results.get(document.uri.toString())
                if (result && result.stamp !== this.stamp(document.uri)) this.invalidate(document.uri)
            }),
            vscode.workspace.onDidDeleteFiles(event => event.files.forEach(uri => this.invalidate(uri))),
            vscode.workspace.onDidRenameFiles(event => event.files.forEach(file => this.invalidate(file.oldUri))),
        ]
    }

    stamp(uri: vscode.Uri) {
        const document = vscode.workspace.textDocuments.find(doc => !doc.isClosed && doc.uri.toString() === uri.toString())
        return document && createHash('sha256').update(document.getText()).digest('hex')
    }

    report(source: vscode.Uri, entries: PreviewProblemEntry[], stamp = this.stamp(source)) {
        if (this.disposed || stamp !== this.stamp(source)) return
        const key = source.toString()
        this.results.delete(key)
        this.results.set(key, { source, stamp, entries })
        while (this.results.size > 128) this.results.delete(this.results.keys().next().value!)
        this.publish()
    }

    clear(source: vscode.Uri) {
        if (this.disposed) return
        this.results.delete(source.toString())
        this.publish()
    }

    private invalidate(uri: vscode.Uri) {
        const key = uri.toString()
        for (const [owner, result] of this.results) if (owner === key || result.entries.some(entry => entry.uri.toString() === key)) this.results.delete(owner)
        this.publish()
    }

    first(source: vscode.Uri) { return this.results.get(source.toString())?.entries[0] }

    async open(source: vscode.Uri) {
        const entry = this.first(source)
        if (!entry) return false
        return this.openEntry(entry.uri.toString(), entry.diagnostic.message, entry.diagnostic.range.start.line)
    }

    private async openEntry(uri: string, message: string, line: number) {
        if (this.disposed) return false
        const result = [...this.results.values()].find(result => result.entries.some(item => item.uri.toString() === uri && item.diagnostic.message === message && item.diagnostic.range.start.line === line))
        if (!result) return false
        // Opening the model does not select an editor or run OpenSCAD. It also
        // lets onDidOpenTextDocument invalidate a result changed while closed.
        await vscode.workspace.openTextDocument(result.source)
        if (this.results.get(result.source.toString()) !== result || result.stamp !== this.stamp(result.source)) return false
        const entry = result.entries.find(item => item.uri.toString() === uri && item.diagnostic.message === message && item.diagnostic.range.start.line === line)!
        await vscode.commands.executeCommand('vscode.openWith', entry.uri, 'default', { selection: entry.diagnostic.range, preview: false })
        return true
    }

    registerNavigation(): vscode.Disposable {
        return vscode.Disposable.from(
            vscode.commands.registerCommand(OPEN_PREVIEW_PROBLEM_SOURCE, (uri: unknown, message: unknown, line: unknown) => typeof uri === 'string' && typeof message === 'string' && Number.isInteger(line) ? this.openEntry(uri, message, line as number) : false),
            vscode.languages.registerCodeActionsProvider([{ pattern: '**/*.[sS][cC][aA][dD]' }, { pattern: '**/*.[cC][sS][gG]' }], {
                provideCodeActions: (document, range, context) => {
                    const entries = [...this.results.values()].flatMap(result => result.entries)
                    return entries.filter(entry => entry.uri.toString() === document.uri.toString() && entry.diagnostic.range.intersection(range) && context.diagnostics.some(d => d.source === 'OpenSCAD Preview' && d.message === entry.diagnostic.message && d.range.isEqual(entry.diagnostic.range))).map(entry => {
                        const action = new vscode.CodeAction('Preview: open source at this error', vscode.CodeActionKind.QuickFix)
                        action.diagnostics = [entry.diagnostic]
                        action.command = { command: OPEN_PREVIEW_PROBLEM_SOURCE, title: action.title, arguments: [entry.uri.toString(), entry.diagnostic.message, entry.diagnostic.range.start.line] }
                        return action
                    })
                },
            }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
        )
    }

    private publish() {
        if (this.disposed) return
        const grouped = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>()
        for (const result of this.results.values()) for (const entry of result.entries) {
            const group = grouped.get(entry.uri.toString()) ?? { uri: entry.uri, diagnostics: [] }
            group.diagnostics.push(entry.diagnostic)
            grouped.set(entry.uri.toString(), group)
        }
        this.collection.clear()
        for (const { uri, diagnostics } of grouped.values()) this.collection.set(uri, diagnostics)
    }

    dispose() {
        if (this.disposed) return
        this.disposed = true
        this.subscriptions.forEach(subscription => subscription.dispose())
        this.results.clear()
        this.collection.dispose()
    }
}
