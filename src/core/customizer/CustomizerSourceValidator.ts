import { utf8Length } from './CustomizerConstraints'
import { analyzeCustomizerSource, sourceCoordinates } from './CustomizerSourceAnalyzer'
import { scanCustomizer } from './CustomizerParser'
import type { CustomizerSourceAnalysis, SourceExpectation, CustomizerDiagnostic, SourceRange } from './CustomizerSourceTypes'

export function validateCustomizerSource(source: string, expectations: SourceExpectation[] = [], includeWarnings = true, analysis: CustomizerSourceAnalysis = analyzeCustomizerSource(source)) {
    const diagnostics: CustomizerDiagnostic[] = [...analysis.diagnostics]
    let matched = 0
    const expectationResults: Array<{ parameter: string; matched: boolean; issues: string[]; details: Array<{ code: string; message: string; range: SourceRange }>; range: SourceRange }> = []
    const declarations = scanCustomizer(source).declarations
    const effective = new Map(declarations.map((declaration) => [declaration.name, declaration]))
    const coordinates = sourceCoordinates(source)
    for (const expected of expectations) {
        const actual = analysis.parameters.find((p) => p.name === expected.name.normalize('NFC'))
        const hidden = expected.visible === false && effective.get(expected.name.normalize('NFC'))?.group === 'Hidden'
        const issues: string[] = []
        const details: Array<{ code: string; message: string; range: SourceRange }> = []
        const declaration = effective.get(expected.name.normalize('NFC'))
        const range = actual?.declarationRange ?? (declaration ? coordinates(declaration) : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } })
        const issue = (code: string, message: string) => { issues.push(message); details.push({ code, message, range }) }
        if (!actual && !hidden) issue(!analysis.complete ? 'UNVERIFIED_INCOMPLETE' : !declaration ? 'TARGET_MISSING' : declaration.value === undefined ? 'EXPECTED_LITERAL' : 'EXPECTED_VISIBLE', 'Parameter is missing or not visible')
        if (hidden) {
            const declaration = effective.get(expected.name.normalize('NFC'))!
            const type = Array.isArray(declaration.value) ? 'vector' : typeof declaration.value
            if (declaration.value === undefined) issue('EXPECTED_LITERAL', 'Hidden default is not a supported literal')
            if (expected.type && expected.type !== type) issue('EXPECTED_TYPE', 'Hidden default type differs')
            if (expected.defaultValue !== undefined && JSON.stringify(expected.defaultValue) !== JSON.stringify(declaration.value)) issue('EXPECTED_DEFAULT', 'Hidden default value differs')
            if (expected.group !== undefined && expected.group !== declaration.group) issue('EXPECTED_GROUP', 'Hidden group differs')
            if (['widget', 'range', 'choices', 'step', 'maxLength', 'description'].some((key) => expected[key as keyof SourceExpectation] !== undefined) || expected.requireDescription) issue('UNOBSERVABLE_CONTRACT', 'Hidden controls have no observable widget or description; validate visibility alone')
        }
        if (actual) {
            if (expected.visible === false) issue('EXPECTED_VISIBLE', 'Parameter is still visible')
            const type = Array.isArray(actual.defaultValue) ? 'vector' : typeof actual.defaultValue
            if (expected.type && type !== expected.type) issue('EXPECTED_TYPE', `Expected type ${expected.type}; actual ${type}`)
            if (expected.requireDescription && !actual.description.trim()) issue('EXPECTED_DESCRIPTION', 'Description is required')
            for (const field of ['widget', 'group', 'defaultValue', 'step', 'maxLength', 'description'] as const) {
                if (expected[field] !== undefined && JSON.stringify(expected[field]) !== JSON.stringify(actual[field])) issue(({ widget: 'EXPECTED_WIDGET', group: 'EXPECTED_GROUP', defaultValue: 'EXPECTED_DEFAULT', step: 'EXPECTED_RANGE', maxLength: 'EXPECTED_TEXT_LENGTH', description: 'EXPECTED_DESCRIPTION' } as const)[field], `Expected ${field} ${JSON.stringify(expected[field])}; actual ${JSON.stringify(actual[field])}`)
            }
            if (expected.range && (!actual.range || Object.entries(expected.range).some(([key, value]) => actual.range![key as keyof typeof actual.range] !== value))) issue('EXPECTED_RANGE', 'Range or step differs')
            if (expected.choices && (!actual.choices || actual.choices.length !== expected.choices.length || expected.choices.some((c) => !actual.choices!.some((a) => a.value === c.value && (c.label === undefined || c.label === a.label))))) issue('EXPECTED_CHOICES', 'Choice values or labels differ')
        }
        if (!issues.length) matched++
        expectationResults.push({ parameter: expected.name, matched: issues.length === 0, issues, details, range })
    }
    let truncated = false
    let bytes = 0
    const boundedItems = <T>(items: T[]) => items.filter((item) => {
        const size = utf8Length(JSON.stringify(item))
        if (size > 8192 || bytes + size > 65536) { truncated = true; return false }
        bytes += size
        return true
    })
    const bounded = boundedItems(diagnostics)
    const boundedExpectations = boundedItems(expectationResults)
    const complete = analysis.complete && !truncated
    const semanticPass = complete && matched === expectations.length && !diagnostics.some((d) => d.severity === 'error' || d.severity === 'warning')
    return { sourceStatus: { status: analysis.complete ? 'complete' as const : 'incomplete' as const, reasons: analysis.incompleteReasons }, contractStatus: expectations.length === 0 ? 'notRequested' as const : !complete ? 'unverified' as const : matched === expectations.length ? 'matched' as const : 'mismatch' as const, qualityStatus: diagnostics.some(d => d.severity === 'error') ? 'errors' as const : diagnostics.some(d => d.severity === 'warning') ? 'warnings' as const : 'clear' as const, semanticPass, checked: expectations.length, matched, expectationResults: boundedExpectations, omittedExpectations: expectationResults.length - boundedExpectations.length, diagnostics: includeWarnings ? bounded : bounded.filter((d) => d.severity === 'error'), omittedDiagnostics: diagnostics.length - bounded.length, runtimeCheck: { status: 'notRequested' as const }, guiCheck: { status: 'notRequested' as const }, complete }
}
