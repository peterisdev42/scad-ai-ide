import { customizerRules, safeHintReplacement, hasUnclosedHintIntent, CUSTOMIZER_REFERENCE, type CustomizerRuleId } from './CustomizerRules'
import { parseCustomizerAnnotation } from './CustomizerAnnotation'
import { utf8Length } from './CustomizerConstraints'
import { scanCustomizer, splitOutsideStrings, type Parameter, type SourceSpan, type ScannedDeclaration } from './CustomizerParser'
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
    const empty: CustomizerSourceAnalysis = { parameters: [], candidates: [], diagnostics: [], complete: false, incompleteReasons: ['sourceLimit'], omitted: { parameters: 0, diagnostics: 0, candidates: 0 } }
    if (source.length > SOURCE_LIMIT || utf8Length(source) > SOURCE_LIMIT) return empty
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
    // A later top-level assignment can remove an otherwise supported control.
    // Report the observable loss, not legal duplicate assignments in general.
    const firstControls = new Map<string, ScannedDeclaration>()
    for (const d of scan.declarations) if (d.parameter && !firstControls.has(d.name)) firstControls.set(d.name, d)
    for (const [name, original] of firstControls) {
        const effective = lastDeclarations.get(name)!
        if (effective.beforeFirstBrace || effective.group === 'Hidden') continue
        const rule = customizerRules['CUST-VIS-01']
        diagnostics.push({
            ruleId: 'CUST-VIS-01', code: rule.code, severity: rule.severity, parameter: name,
            message: `The later assignment to "${name}" is outside the Customizer region and overrides its earlier parameter declaration; no control is available for this parameter.`,
            suggestedFix: 'Keep one effective literal declaration before the first code block. Review both assignments before removing or moving either one.',
            range: coordinates(effective),
            relatedInformation: [{ range: coordinates(original), message: 'Earlier customizable parameter declaration overridden here.' }],
            evidence: { kind: 'superseded-parameter', category: rule.category, referenceOpenSCADCommit: CUSTOMIZER_REFERENCE },
            fix: { id: 'CUST-VIS-01', safety: 'review', title: rule.title },
        })
    }
    for (const d of scan.declarations) {
        // Only explicit annotations on an effective, supported control are linted.
        // Ordinary SCAD, missing hints and unsupported forms are not errors.
        if (lastDeclarations.get(d.name) !== d || !d.beforeFirstBrace || d.group === 'Hidden' || !d.parameter || !d.annotation) continue
        const p = d.parameter
        if (typeof p.defaultValue === 'boolean') continue
        const hint = source.slice(d.annotation.start + 2, d.annotation.end).trim()
        const numericControl = typeof p.defaultValue === 'number' || Array.isArray(p.defaultValue)
        const add = (ruleId: CustomizerRuleId, message: string, suggestedFix: string) => {
            const rule = customizerRules[ruleId]
            diagnostics.push({ code: rule.code, ruleId, severity: rule.severity, parameter: d.name, message, suggestedFix, range: coordinates(d.annotation!), evidence: { kind: 'explicit-effective-hint', category: rule.category, referenceOpenSCADCommit: CUSTOMIZER_REFERENCE }, fix: { id: ruleId, safety: safeHintReplacement(ruleId, hint) === undefined ? 'review' : 'safe', title: rule.title } } satisfies CustomizerDiagnostic)
        }
        if (hint.startsWith('[')) {
            const closingParts = splitOutsideStrings(hint, ']')
            if (closingParts.length === 1) {
                // A bracketed prose note is not sufficient evidence of Widget intent.
                if (hasUnclosedHintIntent(hint)) add('CUST-ANN-01', 'The written Widget hint is missing its closing ].', 'Close any quoted values/labels, then close the Widget hint with ], or remove the incomplete annotation.')
                continue
            }
            // A closed prefix followed by prose is ordinary/unsupported comment text,
            // not a missing bracket. Keep the GUI Parser's whole-comment semantics.
            if (closingParts.length !== 2 || closingParts[1]) continue
            const body = hint.slice(1, -1)
            const annotation = parseCustomizerAnnotation(hint)
            if (numericControl && annotation.kind === 'range') {
                const { min, max, step } = annotation
                if (min > max) add('CUST-RANGE-01', `The written minimum ${min} exceeds the maximum ${max}.`, 'Set the minimum no greater than the maximum in this range annotation.')
                else if (step !== undefined && step <= 0) add('CUST-RANGE-02', `The written step ${step} must be positive.`, 'Use a positive step, or remove the explicit step to keep [min:max].')
            } else if ((numericControl || typeof p.defaultValue === 'string') && splitOutsideStrings(body, ',').some((entry) => !entry)) {
                add('CUST-ANN-03', 'The written Widget hint contains an empty option.', 'Remove the empty option/comma, add its value, or remove the empty annotation.')
            }
        } else {
            const annotation = parseCustomizerAnnotation(hint)
            if (annotation.kind === 'number') {
                const value = annotation.value
                if (numericControl && value <= 0) add('CUST-ANN-02', `The written numeric step ${value} must be positive.`, 'Use a positive numeric step, or remove the step annotation.')
                else if (typeof p.defaultValue === 'string' && (!Number.isSafeInteger(value) || value < 0)) add('CUST-TEXT-01', 'The written text length must be a nonnegative integer.', 'Use a nonnegative integer length, or remove the text-length annotation.')
            }
        }
        if (p.maxLength !== undefined && typeof p.defaultValue === 'string' && utf8Length(p.defaultValue) > p.maxLength) add('CUST-TEXT-02', `The default text has ${utf8Length(p.defaultValue)} UTF-8 bytes but the written limit is ${p.maxLength}.`, 'Increase this length annotation to fit the default text, or shorten the default text.')
        if (p.range) {
            const values = Array.isArray(p.defaultValue) ? p.defaultValue : [p.defaultValue as number]
            if (values.some((v) => v < p.range!.min || v > p.range!.max)) add('CUST-RANGE-03', `The default value is outside the written range [${p.range.min}:${p.range.max}].`, 'Expand this range annotation to include the default, or choose a default inside the range.')
        }
        // An unlisted default is automatically included in choices by the Parser.
        // Off-step defaults, mixed choices and duplicate labels are not syntax errors.
    }
    const candidates = options.includeCandidates === false ? [] : scan.declarations.filter((d) => !d.parameter || !visible.has(d.parameter)).map((d) => ({ name: d.name, range: coordinates(d), reason: d.group === 'Hidden' ? 'hidden' : !d.beforeFirstBrace ? 'afterFirstBrace' : d.value === undefined ? 'unsupportedDefault' : 'superseded', confidence: 'certain' as const }))
    const max = Math.max(0, Math.min(200, options.maxDiagnostics ?? 100))
    let metadataBytes = 0
    const bounded = <T>(items: T[], limit: number) => {
        const output: T[] = []
        for (const item of items) {
            const size = utf8Length(JSON.stringify(item))
            if (output.length >= limit || size > 8192 || metadataBytes + size > 65536 - 1024) break
            output.push(item); metadataBytes += size
        }
        return output
    }
    // Diagnostics are needed even when a parameter projection hits its limit.
    // One shared budget covers all arrays; 1 KiB reserves wrapper/reason overhead.
    const safeDiagnostics = bounded(diagnostics, max)
    const safeParameters = bounded(parameters, 500)
    const safeCandidates = bounded(candidates, 500)
    const omitted = { parameters: parameters.length - safeParameters.length, diagnostics: diagnostics.length - safeDiagnostics.length, candidates: candidates.length - safeCandidates.length }
    return { parameters: safeParameters, candidates: safeCandidates, diagnostics: safeDiagnostics, complete: scan.complete && !Object.values(omitted).some(Boolean), incompleteReasons: [...scan.incompleteReasons, ...(Object.values(omitted).some(Boolean) ? ['metadataLimit'] : [])], omitted }
}
