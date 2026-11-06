import { scanCustomizer, type Parameter, type SourceSpan, type ScannedDeclaration } from './CustomizerParser'
import type { CustomizerDiagnostic, CustomizerSourceAnalysis, CustomizerWidget, SourceRange } from './CustomizerSourceTypes'

export const SOURCE_LIMIT = 1024 * 1024
/** Offsets and columns both use UTF-16, as TextDocument does. */
export function sourceCoordinates(source: string) {
    const starts = [0]
    for (let i = 0; i < source.length; i++) { if (source[i] === '\n') starts.push(i + 1) }
    const position = (offset: number) => {
        let low = 0, high = starts.length
        while (low + 1 < high) { const mid = (low + high) >>> 1; if (starts[mid] <= offset) low = mid; else high = mid }
        return { line: low, character: offset - starts[low] }
    }
    return (span: SourceSpan): SourceRange => ({ start: position(span.start), end: position(span.end) })
}
export function widgetFor(parameter: Parameter): CustomizerWidget {
    if (parameter.choices) return 'dropdown'
    if (Array.isArray(parameter.defaultValue)) return 'vector'
    if (parameter.range) return 'slider'
    return typeof parameter.defaultValue === 'boolean' ? 'checkbox' : typeof parameter.defaultValue === 'string' ? 'textbox' : 'spinbox'
}

export function analyzeCustomizerSource(source: string, options: { maxDiagnostics?: number; includeCandidates?: boolean } = {}): CustomizerSourceAnalysis {
    const empty: CustomizerSourceAnalysis = { parameters: [], candidates: [], diagnostics: [], complete: false, omitted: { parameters: 0, diagnostics: 0, candidates: 0 } }
    if (source.length > SOURCE_LIMIT || Buffer.byteLength(source, 'utf8') > SOURCE_LIMIT) return empty
    const scan = scanCustomizer(source)
    const coordinates = sourceCoordinates(source)
    const diagnostics: CustomizerDiagnostic[] = []
    const explicitHint = (text: string) => text.startsWith('[') || /^[+-]?(?:0x[0-9a-f]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i.test(text)
    const lastDeclarations = new Map<string, ScannedDeclaration>()
    const annotatedDeclarations = new Map<string, ScannedDeclaration>()
    for (const declaration of scan.declarations) {
        lastDeclarations.set(declaration.name, declaration)
        if (declaration.parameter && explicitHint(declaration.parameter.hint?.trim() ?? '')) annotatedDeclarations.set(declaration.name, declaration)
    }
    const byParameter = new Map(scan.declarations.filter((d) => d.parameter).map((d) => [d.parameter!, d]))
    const visible = new Set(scan.parameters)
    const parameters = scan.parameters.map((p) => {
        const d = byParameter.get(p)!
        return { ...p, widget: widgetFor(p), declarationRange: coordinates(d), annotationRange: d.annotation && coordinates(d.annotation), descriptionRange: d.description && coordinates(d.description) }
    })
    for (const d of scan.declarations) {
        // Reassignment is legal SCAD. Diagnose only the declaration the GUI uses;
        // stale defaults/hints on superseded declarations cannot be fixed here.
        if (lastDeclarations.get(d.name) !== d || !d.beforeFirstBrace || d.group === 'Hidden') continue
        const p = d.parameter
        const hint = d.annotation ? source.slice(d.annotation.start + 2, d.annotation.end).trim() : ''
        const intent = explicitHint(hint)
        const add = (code: string, message: string, severity: CustomizerDiagnostic['severity'] = 'warning') => diagnostics.push({ code: `CUSTOMIZER_${code}`, severity, parameter: d.name, message, range: coordinates(d.annotation ?? d) })
        const earlier = annotatedDeclarations.get(d.name)
        if (!intent && d.value === undefined && earlier && earlier !== d) {
            const earlierLine = coordinates(earlier).start.line + 1
            diagnostics.push({ code: 'CUSTOMIZER_DUPLICATE_ASSIGNMENT', severity: 'information', parameter: d.name, range: coordinates(d), message: `Customizer does not expose '${d.name}': this final assignment is not a supported literal and supersedes the annotated declaration on line ${earlierLine}. Keep a literal parameter and use a separate variable for computed values if a control is intended.` })
        }
        if (!intent) continue
        if (d.value === undefined) { add('UNSUPPORTED_DEFAULT', 'Customizer requires a literal default; expressions are never evaluated.', 'information'); continue }
        if (!p) continue
        if (hint.startsWith('[') && !hint.endsWith(']')) add('MALFORMED_HINT', 'Close the Customizer hint with ].')
        else if (/^\[/.test(hint) && !p.range && !p.choices) add('INVALID_RANGE', 'Unsupported hint or invalid range: use min <= max and a positive step.')
        else if (!hint.startsWith('[') && p.step === undefined && p.maxLength === undefined) add('MALFORMED_HINT', 'Use a positive numeric step or a nonnegative integer text length.')
        if (p.maxLength !== undefined && typeof p.defaultValue === 'string' && p.defaultValue.length > p.maxLength) add('DEFAULT_OUT_OF_RANGE', 'Default text exceeds its declared maximum length.')
        if (p.range) {
            const values = Array.isArray(p.defaultValue) ? p.defaultValue : [p.defaultValue as number]
            if (values.some((v) => v < p.range!.min || v > p.range!.max)) add('DEFAULT_OUT_OF_RANGE', 'Default value is outside the declared range.')
            else if (p.range.step && values.some((v) => Math.abs((v - p.range!.min) / p.range!.step! - Math.round((v - p.range!.min) / p.range!.step!)) > 1e-7)) add('DEFAULT_OFF_STEP', 'Default value is off the explicit step grid.')
        }
        if (p.choices) {
            // Preserve the legacy GUI's inserted default but validate the actual hint choices.
            const actual = d.declaredChoices
            if (!actual?.some((c) => c.value === p.defaultValue) || actual.some((c) => typeof c.value !== typeof p.defaultValue) || new Set(actual.map((c) => c.value)).size !== actual.length) add('INVALID_CHOICES', 'Choices must be unique, match the default type and include the default value.')
        }
    }
    const candidates = options.includeCandidates === false ? [] : scan.declarations.filter((d) => !d.parameter || !visible.has(d.parameter)).map((d) => ({ name: d.name, range: coordinates(d), reason: d.group === 'Hidden' ? 'hidden' : !d.beforeFirstBrace ? 'afterFirstBrace' : d.value === undefined ? 'unsupportedDefault' : 'superseded', confidence: 'certain' as const }))
    const max = Math.max(0, Math.min(200, options.maxDiagnostics ?? 100))
    const bounded = <T>(items: T[], limit: number) => {
        const output: T[] = []
        let bytes = 0
        for (const item of items) {
            const size = Buffer.byteLength(JSON.stringify(item), 'utf8')
            if (output.length >= limit || size > 8192 || bytes + size > 65536) break
            output.push(item); bytes += size
        }
        return output
    }
    const safeParameters = bounded(parameters, 500)
    const safeDiagnostics = bounded(diagnostics, max)
    const safeCandidates = bounded(candidates, 500)
    const omitted = { parameters: parameters.length - safeParameters.length, diagnostics: diagnostics.length - safeDiagnostics.length, candidates: candidates.length - safeCandidates.length }
    return { parameters: safeParameters, candidates: safeCandidates, diagnostics: safeDiagnostics, complete: scan.complete && !Object.values(omitted).some(Boolean), omitted }
}
