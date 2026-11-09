import type { Parameter } from './CustomizerModel'

export function splitOutsideStrings(text: string, delimiter: string): string[] {
    const parts: string[] = []
    let start = 0
    let quoted = false
    for (let index = 0; index < text.length; index++) {
        if (quoted && text[index] === '\\') {
            index++
            continue
        }
        if (text[index] === '"') {
            quoted = !quoted
        }
        if (!quoted && text[index] === delimiter) {
            parts.push(text.slice(start, index).trim())
            start = index + 1
        }
    }
    parts.push(text.slice(start).trim())
    return parts
}

type Token = { kind: 'number'; value: number } | { kind: 'word'; value: string } | { kind: 'punctuation'; value: string }
export type ParsedAnnotation =
    | { kind: 'number'; value: number }
    | { kind: 'range'; min: number; max: number; step?: number; minimumExplicit: boolean }
    | { kind: 'choices'; items: NonNullable<Parameter['choices']> }
    | { kind: 'text' | 'unsupported' }

/** Pinned comment_lexer.l uses decimal NUM tokens and longest-match WORDs.
 * It is deliberately independent of the SCAD literal/string lexer. */
function tokensFor(comment: string): Token[] | undefined {
    const tokens: Token[] = []
    for (let offset = 0; offset < comment.length;) {
        const char = comment[offset]
        if (/\s/.test(char) || char === '(' || char === ')') { offset++; continue }
        if ('[],:'.includes(char)) { tokens.push({ kind: 'punctuation', value: char }); offset++; continue }
        if (char === '"') {
            let value = '', closed = false
            for (offset++; offset < comment.length; offset++) {
                const current = comment[offset]
                if (current === '"') { offset++; closed = true; break }
                if (current === '\\') {
                    const next = comment[++offset]
                    if (next === undefined) return
                    value += ({ n: '\n', r: '\r', t: '\t' }[next] ?? next)
                } else value += current
            }
            if (!closed) return
            tokens.push({ kind: 'word', value })
            continue
        }
        const rest = comment.slice(offset)
        const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/.exec(rest)?.[0] ?? ''
        const word = /^[^()[\],": \t\r\n]+/.exec(rest)?.[0] ?? ''
        if (numeric && numeric.length >= word.length) {
            const value = Number(numeric)
            if (!Number.isFinite(value)) return
            tokens.push({ kind: 'number', value }); offset += numeric.length
        } else if (word) { tokens.push({ kind: 'word', value: word }); offset += word.length }
        else return
    }
    return tokens
}

export function parseCustomizerAnnotation(comment: string): ParsedAnnotation {
    const tokens = tokensFor(comment)
    if (!tokens?.length) return { kind: 'unsupported' }
    if (tokens.length === 1 && tokens[0].kind === 'number') return { kind: 'number', value: tokens[0].value }
    if (tokens[0].value !== '[' || tokens.at(-1)!.value !== ']') return { kind: 'text' }
    const body = tokens.slice(1, -1)
    if (body.length === 1 && body[0].kind === 'number') return { kind: 'range', min: 0, max: body[0].value, minimumExplicit: false }
    if ((body.length === 3 || body.length === 5) && body.every((token, index) => index % 2 ? token.kind === 'punctuation' && token.value === ':' : token.kind === 'number')) {
        return { kind: 'range', min: body[0].value as number, max: body.at(-1)!.value as number, step: body.length === 5 ? body[2].value as number : undefined, minimumExplicit: true }
    }
    const scalar = (part: Token[]): string | number | undefined => {
        if (!part.length || part.some(token => token.kind === 'punctuation')) return
        if (part.length === 1) return part[0].value
        if (part.some(token => token.kind === 'word')) return part.map(token => token.value).join(' ')
    }
    const items: NonNullable<Parameter['choices']> = []
    let entry: Token[] = []
    for (const token of [...body, { kind: 'punctuation', value: ',' } as Token]) {
        if (token.kind !== 'punctuation' || token.value !== ',') { entry.push(token); continue }
        const colons = entry.map((item, index) => item.kind === 'punctuation' && item.value === ':' ? index : -1).filter(index => index >= 0)
        if (colons.length > 1) return { kind: 'unsupported' }
        const colon = colons[0]
        const value = scalar(colon === undefined ? entry : entry.slice(0, colon))
        const label = colon === undefined ? value : scalar(entry.slice(colon + 1))
        if (value === undefined || label === undefined) return { kind: 'unsupported' }
        items.push({ value, label: String(label) }); entry = []
    }
    return items.length ? { kind: 'choices', items } : { kind: 'unsupported' }
}

export function annotate(parameter: Parameter, comment: string): Parameter['choices'] | undefined {
    parameter.hint = comment
    const annotation = parseCustomizerAnnotation(comment)
    const numeric = typeof parameter.defaultValue === 'number' || Array.isArray(parameter.defaultValue)
    if (annotation.kind === 'number') {
        if (numeric && annotation.value > 0) parameter.step = annotation.value
        else if (typeof parameter.defaultValue === 'string' && Number.isSafeInteger(annotation.value) && annotation.value >= 0) parameter.maxLength = annotation.value
    } else if (annotation.kind === 'range' && numeric) {
        const { min, max, step, minimumExplicit } = annotation
        if (min <= max && (step === undefined || step > 0)) {
            parameter.range = { min, max, step }
            parameter.declaredRange = { ...parameter.range }
            const defaults = Array.isArray(parameter.defaultValue) ? parameter.defaultValue : [parameter.defaultValue as number]
            parameter.effectiveRange = { min: minimumExplicit ? Math.min(min, ...defaults) : min, max: Math.max(max, ...defaults), step }
        }
    } else if (annotation.kind === 'choices' && !Array.isArray(parameter.defaultValue) && typeof parameter.defaultValue !== 'boolean') {
        const declaredChoices = annotation.items
        parameter.choices = [...declaredChoices]
        if (!parameter.choices.some(choice => choice.value === parameter.defaultValue)) parameter.choices.unshift({ label: String(parameter.defaultValue), value: parameter.defaultValue as string | number })
        return declaredChoices
    }
}
