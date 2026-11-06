import { CapabilityError } from '../capabilities/CapabilityTypes'
import { analyzeCustomizerSource } from './CustomizerSourceAnalyzer'
import { scanCustomizer } from './CustomizerParser'
import { applySourceEdits } from './CustomizerSourceEditor'
import { safeHintReplacement, type CustomizerRuleId } from './CustomizerRules'
import { validateCustomizerSource } from './CustomizerSourceValidator'
import type { SourceTextEdit } from './CustomizerSourceTypes'

/** A deterministic fix changes only the proven annotation. Host adapters supply
 * independent authorization, document identity and commit/Undo handling. */
export function planCustomizerFix(source: string, ruleId: CustomizerRuleId, name: string) {
    const before = analyzeCustomizerSource(source, { maxDiagnostics: 200 })
    if (!before.complete) throw new CapabilityError('SOURCE_UNSUPPORTED', 'Source analysis is incomplete; no automatic fix is planned.')
    const parameter = name.normalize('NFC')
    const diagnostic = before.diagnostics.find(item => item.ruleId === ruleId && item.parameter === parameter)
    const original = scanCustomizer(source)
    const declaration = [...original.declarations].reverse().find(item => item.name === parameter)
    if (!diagnostic || !declaration?.annotation) return { edits: [] as SourceTextEdit[], source, changedParameters: [] as string[], validation: validateCustomizerSource(source) }
    const span = declaration.annotation
    const hint = source.slice(span.start + 2, span.end).trim()
    const replacement = safeHintReplacement(ruleId, hint)
    if (replacement === undefined) throw new CapabilityError('NEEDS_MANUAL_REVIEW', diagnostic.suggestedFix ?? 'This annotation needs review.')
    const edits = [{ start: span.start, end: span.end, text: replacement ? '// ' + replacement : '' }]
    const result = applySourceEdits(source, edits)
    const after = analyzeCustomizerSource(result, { maxDiagnostics: 200 })
    const final = scanCustomizer(result)
    const target = final.declarations.find(item => item.name === parameter && item.start === declaration.start)
    const nonTargets = (scan: typeof original) => scan.declarations.filter(item => item.name !== parameter).map(item => ({ name: item.name, value: item.value, group: item.group, parameter: item.parameter, beforeFirstBrace: item.beforeFirstBrace }))
    const key = (item: typeof diagnostic) => `${item.parameter}:${item.ruleId}:${item.message}`
    const previousIssues = new Set(before.diagnostics.filter(item => item !== diagnostic).map(key))
    if (!after.complete || after.diagnostics.some(item => item.ruleId === ruleId && item.parameter === parameter) || after.diagnostics.some(item => !previousIssues.has(key(item))) || !target || JSON.stringify(target.value) !== JSON.stringify(declaration.value) || target.group !== declaration.group || JSON.stringify(nonTargets(original)) !== JSON.stringify(nonTargets(final))) {
        throw new CapabilityError('POSTCONDITION_FAILED', 'The local fix could not be proven safe; review the annotation manually.')
    }
    return { edits, source: result, changedParameters: [parameter], validation: validateCustomizerSource(result) }
}
