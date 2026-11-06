import * as vscode from 'vscode'
import { scanCustomizer, numericStep } from '../../core/customizer/CustomizerParser'
import { analyzeCustomizerSource } from '../../core/customizer/CustomizerSourceAnalyzer'
import { planCustomizerEdits } from '../../core/customizer/CustomizerSourceEditor'
import { planCustomizerFix } from '../../core/customizer/CustomizerFixPlanner'
import type { SourceEditIntent, SourceRange } from '../../core/customizer/CustomizerSourceTypes'
import type { CustomizerActionExecutor } from './CustomizerEditorActions'

const sameRange = (actual: vscode.Range, expected: SourceRange) => actual.start.line === expected.start.line && actual.start.character === expected.start.character && actual.end.line === expected.end.line && actual.end.character === expected.end.character

/** Problems supply identity, the rule planner supplies the patch, and an opaque
 * command submits it only after a fresh document/provider/identity check. */
export class CustomizerCodeActions implements vscode.CodeActionProvider {
    constructor(private readonly executor: CustomizerActionExecutor) {}
    provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context?: vscode.CodeActionContext, token?: vscode.CancellationToken): vscode.CodeAction[] {
        if (token?.isCancellationRequested || !this.executor.canEdit(document) || !vscode.workspace.getConfiguration('scad-ai-ide.customizer', document.uri).get('sourceDiagnostics', true)) return []
        const source = document.getText()
        const analysis = analyzeCustomizerSource(source, { maxDiagnostics: 200 })
        if (!analysis.complete) return []
        const actions: vscode.CodeAction[] = []
        if (!context?.only || context.only.contains(vscode.CodeActionKind.QuickFix)) {
            for (const diagnostic of analysis.diagnostics) {
                if (!diagnostic.parameter || diagnostic.fix.safety !== 'safe' || diagnostic.range.start.line > range.end.line || diagnostic.range.end.line < range.start.line) continue
                const reported = context?.diagnostics.find(item => item.source === 'OpenSCAD Customizer' && (typeof item.code === 'object' ? item.code.value : item.code) === diagnostic.code && sameRange(item.range, diagnostic.range))
                if (!reported) continue
                try {
                    const plan = planCustomizerFix(source, diagnostic.ruleId, diagnostic.parameter)
                    if (!plan.edits.length) continue
                    const title = diagnostic.ruleId === 'CUST-RANGE-02' ? 'Customizer: remove invalid explicit step' : `Customizer: ${diagnostic.fix.title}`
                    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix)
                    action.command = this.executor.prepare(document, plan, title)
                    action.diagnostics = [reported]
                    action.isPreferred = true
                    actions.push(action)
                } catch { /* Incomplete, ambiguous or unprovable fixes stay guidance-only. */ }
            }
        }
        if (context?.only && !context.only.contains(vscode.CodeActionKind.RefactorRewrite)) return actions
        const offer = (title: string, intent: SourceEditIntent) => {
            try {
                const plan = planCustomizerEdits(source, [intent])
                if (!plan.edits.length) return
                const action = new vscode.CodeAction(title, vscode.CodeActionKind.RefactorRewrite)
                action.command = this.executor.prepare(document, plan, title)
                actions.push(action)
            } catch { /* Refactors never replace ordinary comments or guess engineering limits. */ }
        }
        const scan = scanCustomizer(source)
        const visible = new Set(scan.parameters)
        for (const declaration of scan.declarations) {
            if (!declaration.parameter || !visible.has(declaration.parameter) || document.positionAt(declaration.start).line > range.end.line || document.positionAt(declaration.end).line < range.start.line) continue
            const hint = declaration.annotation ? source.slice(declaration.annotation.start + 2, declaration.annotation.end).trim() : ''
            // This optional prose conversion is a refactor, not a source warning.
            const plain = /^range\s*:\s*([+-]?[\d.]+)\s*\.\.\s*([+-]?[\d.]+)(?:\s+step\s+([\d.]+))?$/i.exec(hint)
            if (plain) offer('Customizer: convert explicit range comment to slider hint', { kind: 'annotateExisting', name: declaration.name, widget: 'slider', range: { min: Number(plain[1]), max: Number(plain[2]), ...(plain[3] ? { step: Number(plain[3]) } : {}) } })
            if (!hint && typeof declaration.value === 'number') offer('Customizer: make numeric step explicit', { kind: 'annotateExisting', name: declaration.name, widget: 'spinbox', step: numericStep(declaration.parameter) })
            if (!declaration.group) offer('Customizer: place parameter in Global group', { kind: 'moveGroup', name: declaration.name, group: 'Global' })
        }
        return actions
    }
}
