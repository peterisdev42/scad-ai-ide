import * as vscode from 'vscode'
import { findNodeAtLocation, parseTree } from 'jsonc-parser'
import { analyzePresetFile } from '../../core/customizer/CustomizerPresets'
import { sourceCoordinates } from '../../core/customizer/CustomizerSourceAnalyzer'
import type { CustomizerDomainService } from '../sidebar/CustomizerDomainService'

/** Only the explicitly bound parameter file is diagnosed. Never scans *.json. */
export function registerCustomizerPresetDiagnostics(context: vscode.ExtensionContext, domain: CustomizerDomainService) {
    const collection = vscode.languages.createDiagnosticCollection('scad-ai-ide-customizer-presets')
    let sequence = 0
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = async () => {
        const generation = ++sequence
        const path = domain.presets.state().path
        collection.clear()
        if (!path || disposed) return
        const uri = vscode.Uri.parse(path)
        try {
            const document = vscode.workspace.textDocuments.find(doc => !doc.isClosed && doc.uri.toString() === path)
            const source = document?.getText() ?? Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
            if (disposed || generation !== sequence || domain.presets.state().path !== path) return
            const result = analyzePresetFile(source, domain.service.parameters)
            const tree = parseTree(source)
            const coordinates = sourceCoordinates(source)
            collection.set(uri, result.diagnostics.map(issue => {
                const node = tree && findNodeAtLocation(tree, issue.path)
                const range = issue.range ?? coordinates({ start: node?.offset ?? 0, end: node ? node.offset + node.length : 0 })
                const diagnostic = new vscode.Diagnostic(new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character), `${issue.message}\n${issue.suggestedFix}`, issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : issue.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information)
                diagnostic.code = issue.ruleId
                diagnostic.source = 'OpenSCAD Preset'
                return diagnostic
            }))
        } catch {
            // Missing/unreadable files are reported by the binding controller;
            // do not manufacture a JSON syntax diagnostic at a fictitious range.
        }
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void update(), 200) }
    context.subscriptions.push(collection,
        domain.onDidChange(schedule),
        vscode.workspace.onDidChangeTextDocument(event => { if (event.document.uri.toString() === domain.presets.state().path) schedule() }),
        vscode.workspace.onDidOpenTextDocument(document => { if (document.uri.toString() === domain.presets.state().path) schedule() }),
        vscode.workspace.onDidCloseTextDocument(document => { if (document.uri.toString() === domain.presets.state().path) schedule() }),
        { dispose() { disposed = true; sequence++; clearTimeout(timer) } },
    )
    schedule()
}
