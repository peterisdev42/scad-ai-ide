import * as vscode from 'vscode'
import { scanCustomizer, numericStep } from '../../core/customizer/CustomizerParser'
import { planCustomizerEdits } from '../../core/customizer/CustomizerSourceEditor'
import type { SourceEditIntent } from '../../core/customizer/CustomizerSourceTypes'

/** Every Quick Fix is a previewed, validated edit from the same semantic planner. */
export class CustomizerCodeActions implements vscode.CodeActionProvider {
    provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
        if (!vscode.workspace.isTrusted || !vscode.workspace.getConfiguration('scad-ai-ide.customizer', document.uri).get('sourceDiagnostics', true)) return []
        const source = document.getText()
        if (source.length > 1024 * 1024) return []
        const actions: vscode.CodeAction[] = []
        const offer = (title: string, intent: SourceEditIntent) => {
            try {
                const plan = planCustomizerEdits(source, [intent])
                if (!plan.edits.length) return
                const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix)
                action.edit = new vscode.WorkspaceEdit()
                for (const edit of plan.edits) action.edit.replace(document.uri, new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text)
                actions.push(action)
            } catch { /* Ambiguous, invalid or destructive edits are deliberately unavailable. */ }
        }
        for (const d of scanCustomizer(source).declarations) {
            if (document.positionAt(d.start).line > range.end.line || document.positionAt(d.end).line < range.start.line || !d.parameter) continue
            const hint = d.annotation ? source.slice(d.annotation.start + 2, d.annotation.end).trim() : ''
            const invalidStep = /^\[\s*([+-]?[\d.]+)\s*:\s*([+-]?[\d.]+)\s*:\s*([+-]?[\d.]+)\s*\]$/.exec(hint)
            if (invalidStep && Number(invalidStep[2]) <= 0) offer('Customizer: remove invalid explicit step', { kind: 'changeWidget', name: d.name, widget: 'slider', range: { min: Number(invalidStep[1]), max: Number(invalidStep[3]) } })
            const plain = /^range\s*:\s*([+-]?[\d.]+)\s*\.\.\s*([+-]?[\d.]+)(?:\s+step\s+([\d.]+))?$/i.exec(hint)
            if (plain) offer('Customizer: convert explicit range comment to slider hint', { kind: 'annotateExisting', name: d.name, widget: 'slider', range: { min: Number(plain[1]), max: Number(plain[2]), ...(plain[3] ? { step: Number(plain[3]) } : {}) } })
            if (!hint && typeof d.value === 'number') offer('Customizer: make numeric step explicit', { kind: 'annotateExisting', name: d.name, widget: 'spinbox', step: numericStep(d.parameter) })
            if (!d.group) offer('Customizer: place parameter in Global group', { kind: 'moveGroup', name: d.name, group: 'Global' })
        }
        return actions
    }
}
