export type ParameterValue = string | number | boolean | number[]

export interface Parameter {
    name: string
    group: string
    description: string
    defaultValue: ParameterValue
    range?: { min: number; max: number; step?: number }
    choices?: { label: string; value: string | number }[]
    step?: number
    maxLength?: number
    hint?: string
}

const numeric = /^[+-]?(?:0x[0-9a-f]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i
const numberValue = (text: string): number => (text.startsWith('-') ? -Number(text.slice(1)) : Number(text.replace(/^\+/, '')))

export function parseLiteral(text: string): ParameterValue | undefined {
    text = text.trim()
    if (text === 'true' || text === 'false') {
        return text === 'true'
    }
    if (numeric.test(text)) {
        const value = numberValue(text)
        return Number.isFinite(value) ? value : undefined
    }
    if (/^"(?:\\[\s\S]|[^"\\])*"$/.test(text)) {
        // Match OpenSCAD's string escapes, including its six-digit Unicode form.
        return text.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{6}|x[0-7][0-9a-fA-F]|\r?\n|[\s\S])|\r?\n/g, (_, escape: string | undefined) => {
            if (!escape || /^\r?\n$/.test(escape)) return ''
            if (/^[uUx]/.test(escape) && escape.length > 1) {
                const codepoint = parseInt(escape.slice(1), 16)
                return codepoint <= 0x10ffff ? String.fromCodePoint(escape[0] === 'x' && codepoint === 0 ? 32 : codepoint) : '\ufffd'
            }
            return { n: '\n', r: '\r', t: '\t' }[escape] ?? escape
        })
    }
    if (text.startsWith('[') && text.endsWith(']')) {
        const entries = text
            .slice(1, -1)
            .replace(/,\s*$/, '')
            .split(',')
            .map((entry) => entry.trim())
        if (entries.length >= 1 && entries.length <= 4 && entries.every((entry) => numeric.test(entry) && Number.isFinite(numberValue(entry)))) {
            return entries.map(numberValue)
        }
    }
    return undefined
}

function splitOutsideStrings(text: string, delimiter: string): string[] {
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

function annotate(parameter: Parameter, comment: string): Parameter['choices'] | undefined {
    parameter.hint = comment
    const annotation = /^\s*\[([\s\S]*)\]\s*$/.exec(comment)?.[1]
    const isNumeric = typeof parameter.defaultValue === 'number' || Array.isArray(parameter.defaultValue)
    if (annotation === undefined) {
        if (numeric.test(comment)) {
            const value = numberValue(comment)
            if (isNumeric && value > 0 && Number.isFinite(value)) {
                parameter.step = value
            } else if (typeof parameter.defaultValue === 'string' && Number.isSafeInteger(value) && value >= 0) {
                parameter.maxLength = value
            }
        }
        return
    }
    const parts = splitOutsideStrings(annotation, ':')
    if (isNumeric && parts.length <= 3 && parts.every((part) => numeric.test(part))) {
        const values = parts.map(numberValue)
        const min = values.length === 1 ? 0 : values[0]
        const max = values.at(-1)!
        const step = values.length === 3 ? values[1] : undefined
        if (values.every(Number.isFinite) && min <= max && (step === undefined || step > 0)) {
            parameter.range = { min, max, step }
        }
        return
    }
    if (parts.length <= 3 && parts.every((part) => numeric.test(part))) return
    if (Array.isArray(parameter.defaultValue) || typeof parameter.defaultValue === 'boolean') {
        return
    }
    const choices = splitOutsideStrings(annotation, ',').map((entry) => {
        const [raw, ...labels] = splitOutsideStrings(entry, ':')
        const parsed = parseLiteral(raw)
        const value = typeof parsed === 'number' || typeof parsed === 'string' ? parsed : raw && (parsed === undefined || typeof parsed === 'boolean') ? raw : undefined
        const label = labels.join(':')
        return { value, label: label ? String(parseLiteral(label) ?? label) : String(value) }
    })
    if (choices.length && choices.every((choice) => typeof choice.value === 'string' || typeof choice.value === 'number')) {
        parameter.choices = choices as NonNullable<Parameter['choices']>
        const declaredChoices = [...parameter.choices]
        if (!parameter.choices.some((choice) => choice.value === parameter.defaultValue)) {
            parameter.choices.unshift({ label: String(parameter.defaultValue), value: parameter.defaultValue as string | number })
        }
        return declaredChoices
    }
}

/** Scan source without evaluating expressions or following includes. Only standalone
 * literal assignments before the first real opening brace are customizable. */
export interface SourceSpan { start: number; end: number }
export interface ScannedDeclaration {
    name: string
    group: string
    start: number
    end: number
    value?: ParameterValue
    parameter?: Parameter
    declaredChoices?: Parameter['choices']
    annotation?: SourceSpan
    description?: SourceSpan
    beforeFirstBrace: boolean
}

export function scanCustomizer(source: string) {
    const declarations: ScannedDeclaration[] = []
    let complete = true
    let lineStart = 0
    let lineEnd = source.indexOf('\n')
    const firstContent = (start: number, end: number) => {
        for (let i = start; i < (end < 0 ? source.length : end); i++) { if (!/\s/.test(source[i])) return i }
        return -1
    }
    let firstOnLine = firstContent(lineStart, lineEnd)
    let statementStart = -1
    let descriptionStart = -1
    let descriptionEnd = -1
    let statementDescriptionSpan: SourceSpan | undefined
    let lastDeclaration: ScannedDeclaration | undefined
    const parameters = new Map<string, Parameter>()
    let group = ''
    let descriptions: string[] = []
    let statement = ''
    let statementHasContent = false
    let depth = 0
    let braceDepth = 0
    let beforeFirstBrace = true
    let lastParameter: Parameter | undefined
    let statementDescription = ''
    for (let index = 0; index < source.length; index++) {
        const char = source[index]
        if (char === '"') {
            statementHasContent = true
            statement += char
            while (++index < source.length) {
                statement += source[index]
                if (source[index] === '\\') {
                    statement += source[++index] ?? ''
                } else if (source[index] === '"') {
                    break
                }
            }
            if (index >= source.length) complete = false
            continue
        }
        if (char === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) {
            const block = source[index + 1] === '*'
            const end = source.indexOf(block ? '*/' : '\n', index + 2)
            const stop = end < 0 ? source.length : end
            if (block && end < 0) complete = false
            const comment = source.slice(index + 2, stop).trim()
            while (lineEnd >= 0 && lineEnd < index) {
                lineStart = lineEnd + 1
                lineEnd = source.indexOf('\n', lineStart)
                firstOnLine = firstContent(lineStart, lineEnd)
            }
            const standalone = firstOnLine === index
            if (braceDepth) {
                index = stop + (block && end >= 0 ? 1 : -1)
                continue
            }
            const heading = block && standalone && /^(?:\[[^\]]+\]\s*)+$/.test(comment) ? [...comment.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1].trim()).join('-') : undefined
            if (heading && !statementHasContent) {
                group = heading
                descriptions = []
                descriptionStart = -1
            } else if (!block && lastParameter && !standalone) {
                const declaredChoices = annotate(lastParameter, comment)
                if (lastDeclaration) {
                    lastDeclaration.declaredChoices = declaredChoices
                    lastDeclaration.annotation = { start: index, end: stop - (source[stop - 1] === '\r' ? 1 : 0) }
                }
            } else if (!block && lastDeclaration && !standalone) {
                lastDeclaration.annotation = { start: index, end: stop - (source[stop - 1] === '\r' ? 1 : 0) }
            } else if (standalone && !statementHasContent) {
                if (descriptionStart < 0) descriptionStart = index
                descriptionEnd = stop + (block && end >= 0 ? 2 : !block && source[stop - 1] === '\r' ? -1 : 0)
                descriptions.push(comment.replace(/^\s*\* ?/gm, '').trim())
            }
            statement += ' '
            index = stop + (block && end >= 0 ? 1 : -1)
            continue
        }
        if (char === '<' && /^\s*(?:include|use)\s*$/.test(statement)) {
            // Library directives have no required semicolon; do not swallow the next assignment.
            const end = source.indexOf('>', index + 1)
            if (end < 0) { complete = false; break }
            index = end
            statement = ''
            statementHasContent = false
            statementStart = -1
            descriptions = []
            descriptionStart = -1
            continue
        }
        if (char === '{' || char === '}') {
            beforeFirstBrace = false
            braceDepth += char === '{' ? 1 : -1
            statement = ''
            statementHasContent = false
            statementStart = -1
            descriptions = []
            descriptionStart = -1
            lastParameter = undefined
            lastDeclaration = undefined
            depth = 0
            continue
        }
        if (braceDepth) continue
        if (char === '\n') {
            lastParameter = undefined
            lastDeclaration = undefined
        }
        if (!statementHasContent && !/\s/.test(char)) {
            statementHasContent = true
            statementStart = index
            statementDescriptionSpan = descriptionStart >= 0 ? { start: descriptionStart, end: descriptionEnd } : undefined
            descriptionStart = -1
            statementDescription = descriptions.join('\n')
            descriptions = []
        }
        if (char === '(' || char === '[') {
            depth++
        } else if (char === ')' || char === ']') {
            depth--
        }
        if (char === ';' && depth === 0) {
            const assignment = /^\s*([\p{L}_$][\p{L}\p{N}_$]*)\s*=\s*([\s\S]*?)\s*$/u.exec(statement)
            lastParameter = undefined
            lastDeclaration = undefined
            if (assignment) {
                lastDeclaration = { name: assignment[1], group, start: statementStart, end: index + 1, value: parseLiteral(assignment[2]), beforeFirstBrace, description: statementDescriptionSpan }
                declarations.push(lastDeclaration)
            }
            if (assignment) parameters.delete(assignment[1])
            if (assignment && beforeFirstBrace && group !== 'Hidden') {
                const defaultValue = parseLiteral(assignment[2])
                if (defaultValue !== undefined) {
                    lastParameter = { name: assignment[1], group, description: statementDescription, defaultValue }
                    parameters.set(assignment[1], lastParameter)
                    lastDeclaration!.parameter = lastParameter
                }
            }
            statement = ''
            statementHasContent = false
            statementStart = -1
            statementDescription = ''
        } else {
            statement += char
        }
    }
    if (depth !== 0 || braceDepth !== 0 || /^\s*[\p{L}_$][\p{L}\p{N}_$]*\s*=/u.test(statement)) complete = false
    return { parameters: [...parameters.values()], declarations, complete }
}

/** Backwards-compatible GUI API; analysis and authoring use the same scanner. */
export function parseCustomizer(source: string): Parameter[] {
    return scanCustomizer(source).parameters
}

/** Match the precision of the literal defaults instead of rounding decimal controls to integers. */
export function numericStep(parameter: Parameter): number {
    if (parameter.range?.step !== undefined) return parameter.range.step
    if (parameter.step !== undefined) return parameter.step
    const values = Array.isArray(parameter.defaultValue) ? parameter.defaultValue : [parameter.defaultValue]
    if (parameter.range) values.push(parameter.range.min)
    const decimals = values.reduce<number>((precision, value) => {
        const [fraction, exponent = '0'] = String(value).toLowerCase().split('e')
        return Math.max(precision, (fraction.split('.')[1]?.length ?? 0) - Number(exponent))
    }, 0)
    return 10 ** -Math.min(decimals, 15)
}
