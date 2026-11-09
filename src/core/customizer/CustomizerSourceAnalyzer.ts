import { scanCustomizer, parseLiteral, splitOutsideStrings, type Parameter, type SourceSpan, type ScannedDeclaration } from './CustomizerParser'
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
    const lastDeclarations = new Map<string, ScannedDeclaration>()
    for (const declaration of scan.declarations) lastDeclarations.set(declaration.name, declaration)
    const byParameter = new Map(scan.declarations.filter((d) => d.parameter).map((d) => [d.parameter!, d]))
    const visible = new Set(scan.parameters)
    const parameters = scan.parameters.map((p) => {
        const d = byParameter.get(p)!
        return { ...p, widget: widgetFor(p), declarationRange: coordinates(d), annotationRange: d.annotation && coordinates(d.annotation), descriptionRange: d.description && coordinates(d.description) }
    })
    for (const d of scan.declarations) {
        // Only explicit annotations on an effective, supported control are linted.
        // Ordinary SCAD, missing hints and unsupported forms are not errors.
        if (lastDeclarations.get(d.name) !== d || !d.beforeFirstBrace || d.group === 'Hidden' || !d.parameter || !d.annotation) continue
        const p = d.parameter
        if (typeof p.defaultValue === 'boolean') continue
        const hint = source.slice(d.annotation.start + 2, d.annotation.end).trim()
        const numericControl = typeof p.defaultValue === 'number' || Array.isArray(p.defaultValue)
        const add = (code: string, message: string, suggestedFix: string) => diagnostics.push({ code: `CUSTOMIZER_${code}`, severity: 'warning', parameter: d.name, message, suggestedFix, range: coordinates(d.annotation!) } satisfies CustomizerDiagnostic)
        if (hint.startsWith('[')) {
            const closingParts = splitOutsideStrings(hint, ']')
            if (closingParts.length === 1) {
                // A bracketed prose note is not sufficient evidence of Widget intent.
                if (/^\[\s*[+-]?(?:\d|\.\d)/.test(hint) || /[:,]/.test(hint)) add('MALFORMED_HINT', 'The written Widget hint is missing its closing ].', 'Close any quoted values/labels, then close the Widget hint with ], or remove the incomplete annotation.')
                continue
            }
            // A closed prefix followed by prose is ordinary/unsupported comment text,
            // not a missing bracket. Keep the GUI Parser's whole-comment semantics.
            if (closingParts.length !== 2 || closingParts[1]) continue
            const body = hint.slice(1, -1)
            const numbers = splitOutsideStrings(body, ':').map(parseLiteral)
            if (numericControl && numbers.length >= 1 && numbers.length <= 3 && numbers.every((value) => typeof value === 'number')) {
                const values = numbers as number[]
                const min = values.length === 1 ? 0 : values[0]
                const max = values[values.length - 1]
                if (min > max) add('INVALID_RANGE', `The written minimum ${min} exceeds the maximum ${max}.`, 'Set the minimum no greater than the maximum in this range annotation.')
                else if (values.length === 3 && values[1] <= 0) add('INVALID_RANGE', `The written step ${values[1]} must be positive.`, 'Use a positive step, or remove the explicit step to keep [min:max].')
            } else if ((numericControl || typeof p.defaultValue === 'string') && splitOutsideStrings(body, ',').some((entry) => !entry)) {
                add('INVALID_CHOICES', 'The written Widget hint contains an empty option.', 'Remove the empty option/comma, add its value, or remove the empty annotation.')
            }
        } else {
            const value = parseLiteral(hint)
            if (typeof value === 'number') {
                if (numericControl && value <= 0) add('MALFORMED_HINT', `The written numeric step ${value} must be positive.`, 'Use a positive numeric step, or remove the step annotation.')
                else if (typeof p.defaultValue === 'string' && (!Number.isSafeInteger(value) || value < 0)) add('MALFORMED_HINT', 'The written text length must be a nonnegative integer.', 'Use a nonnegative integer length, or remove the text-length annotation.')
            }
        }
        if (p.maxLength !== undefined && typeof p.defaultValue === 'string' && p.defaultValue.length > p.maxLength) add('DEFAULT_OUT_OF_RANGE', `The default text has ${p.defaultValue.length} characters but the written limit is ${p.maxLength}.`, 'Increase this length annotation to fit the default text, or shorten the default text.')
        if (p.range) {
            const values = Array.isArray(p.defaultValue) ? p.defaultValue : [p.defaultValue as number]
            if (values.some((v) => v < p.range!.min || v > p.range!.max)) add('DEFAULT_OUT_OF_RANGE', `The default value is outside the written range [${p.range.min}:${p.range.max}].`, 'Expand this range annotation to include the default, or choose a default inside the range.')
        }
        // An unlisted default is automatically included in choices by the Parser.
        // Off-step defaults, mixed choices and duplicate labels are not syntax errors.
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
