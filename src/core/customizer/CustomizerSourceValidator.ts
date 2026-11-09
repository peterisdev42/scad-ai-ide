import { analyzeCustomizerSource, sourceCoordinates } from './CustomizerSourceAnalyzer'
import { scanCustomizer } from './CustomizerParser'
import type { CustomizerSourceAnalysis, SourceExpectation, CustomizerDiagnostic, SourceRange } from './CustomizerSourceTypes'

export function validateCustomizerSource(source: string, expectations: SourceExpectation[] = [], includeWarnings = true, analysis: CustomizerSourceAnalysis = analyzeCustomizerSource(source)) {
    const diagnostics: CustomizerDiagnostic[] = [...analysis.diagnostics]
    let matched = 0
    const expectationResults: Array<{ parameter: string; matched: boolean; issues: string[]; range: SourceRange }> = []
    const declarations = scanCustomizer(source).declarations
    const effective = new Map(declarations.map((declaration) => [declaration.name, declaration]))
    const coordinates = sourceCoordinates(source)
    for (const expected of expectations) {
        const actual = analysis.parameters.find((p) => p.name === expected.name)
        const hidden = expected.visible === false && effective.get(expected.name)?.group === 'Hidden'
        const issues: string[] = []
        if (!actual && !hidden) issues.push('Parameter is missing or not visible')
        if (hidden) {
            const declaration = effective.get(expected.name)!
            const type = Array.isArray(declaration.value) ? 'vector' : typeof declaration.value
            if (declaration.value === undefined) issues.push('Hidden default is not a supported literal')
            if (expected.type && expected.type !== type) issues.push('Hidden default type differs')
            if (expected.defaultValue !== undefined && JSON.stringify(expected.defaultValue) !== JSON.stringify(declaration.value)) issues.push('Hidden default value differs')
            if (expected.group !== undefined && expected.group !== declaration.group) issues.push('Hidden group differs')
            if (['widget', 'range', 'choices', 'step', 'maxLength', 'description'].some((key) => expected[key as keyof SourceExpectation] !== undefined) || expected.requireDescription) issues.push('Hidden controls have no observable widget or description; validate visibility alone')
        }
        if (actual) {
            if (expected.visible === false) issues.push('Parameter is still visible')
            const type = Array.isArray(actual.defaultValue) ? 'vector' : typeof actual.defaultValue
            if (expected.type && type !== expected.type) issues.push(`Expected type ${expected.type}; actual ${type}`)
            if (expected.requireDescription && !actual.description.trim()) issues.push('Description is required')
            for (const field of ['widget', 'group', 'defaultValue', 'step', 'maxLength', 'description'] as const) {
                if (expected[field] !== undefined && JSON.stringify(expected[field]) !== JSON.stringify(actual[field])) issues.push(`Expected ${field} ${JSON.stringify(expected[field])}; actual ${JSON.stringify(actual[field])}`)
            }
            if (expected.range && (!actual.range || Object.entries(expected.range).some(([key, value]) => actual.range![key as keyof typeof actual.range] !== value))) issues.push('Range or step differs')
            if (expected.choices && (!actual.choices || actual.choices.length !== expected.choices.length || expected.choices.some((c) => !actual.choices!.some((a) => a.value === c.value && (c.label === undefined || c.label === a.label))))) issues.push('Choice values or labels differ')
        }
        if (!issues.length) matched++
        expectationResults.push({ parameter: expected.name, matched: issues.length === 0, issues, range: actual?.declarationRange ?? (effective.has(expected.name) ? coordinates(effective.get(expected.name)!) : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }) })
    }
    let truncated = false
    let bytes = 0
    const boundedItems = <T>(items: T[]) => items.filter((item) => {
        const size = Buffer.byteLength(JSON.stringify(item), 'utf8')
        if (size > 8192 || bytes + size > 65536) { truncated = true; return false }
        bytes += size
        return true
    })
    const bounded = boundedItems(diagnostics)
    const boundedExpectations = boundedItems(expectationResults)
    const complete = analysis.complete && !truncated
    const semanticPass = complete && matched === expectations.length && !diagnostics.some((d) => d.severity === 'error' || d.severity === 'warning')
    return { semanticPass, checked: expectations.length, matched, expectationResults: boundedExpectations, omittedExpectations: expectationResults.length - boundedExpectations.length, diagnostics: includeWarnings ? bounded : bounded.filter((d) => d.severity === 'error'), omittedDiagnostics: diagnostics.length - bounded.length, runtimeCheck: { status: 'notRequested' as const }, guiCheck: { status: 'notRequested' as const }, complete }
}
