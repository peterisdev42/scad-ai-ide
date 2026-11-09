import * as vscode from 'vscode'
import { analyzeCustomizerSource } from '../../core/customizer/CustomizerSourceAnalyzer'
import { CustomizerCodeActions } from './CustomizerCodeActions'

/** Independent of LSP, Runtime and Workspace Trust; no source is executed. */
export function registerCustomizerDiagnostics(context: vscode.ExtensionContext) {
    const collection = vscode.languages.createDiagnosticCollection('scad-ai-ide-customizer')
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const severity = { error: vscode.DiagnosticSeverity.Error, warning: vscode.DiagnosticSeverity.Warning, information: vscode.DiagnosticSeverity.Information, hint: vscode.DiagnosticSeverity.Hint }
    const update = (document: vscode.TextDocument) => {
        if (document.isClosed) return
        if (!vscode.workspace.getConfiguration('scad-ai-ide.customizer', document.uri).get('sourceDiagnostics', true)) { collection.delete(document.uri); return }
        const analysis = analyzeCustomizerSource(document.getText(), { includeCandidates: false, maxDiagnostics: 200 })
        collection.set(document.uri, analysis.diagnostics.map((d) => {
            const diagnostic = new vscode.Diagnostic(new vscode.Range(d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character), d.suggestedFix ? `${d.message}\n${d.suggestedFix}` : d.message, severity[d.severity])
            diagnostic.code = d.code
            diagnostic.source = 'OpenSCAD Customizer'
            return diagnostic
        }))
    }
    const schedule = (document: vscode.TextDocument) => {
        if (!document.uri.path.toLowerCase().endsWith('.scad')) return
        const key = document.uri.toString()
        clearTimeout(timers.get(key))
        timers.set(key, setTimeout(() => { timers.delete(key); update(document) }, 200))
    }
    context.subscriptions.push(collection,
        vscode.languages.registerCodeActionsProvider({ language: 'openscad' }, new CustomizerCodeActions(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite] }),
        vscode.workspace.onDidOpenTextDocument(schedule),
        vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)),
        vscode.workspace.onDidSaveTextDocument(schedule),
        vscode.workspace.onDidCloseTextDocument((document) => { const key = document.uri.toString(); clearTimeout(timers.get(key)); timers.delete(key); collection.delete(document.uri) }),
        vscode.workspace.onDidChangeConfiguration((event) => { if (event.affectsConfiguration('scad-ai-ide.customizer')) vscode.workspace.textDocuments.forEach(schedule) }),
        { dispose() { for (const timer of timers.values()) clearTimeout(timer); timers.clear() } },
    )
    vscode.workspace.textDocuments.forEach(schedule)
}
