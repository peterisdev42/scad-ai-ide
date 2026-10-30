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

function annotate(parameter: Parameter, comment: string): void {
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
        if (!parameter.choices.some((choice) => choice.value === parameter.defaultValue)) {
            parameter.choices.unshift({ label: String(parameter.defaultValue), value: parameter.defaultValue as string | number })
        }
    }
}

/** Scan source without evaluating expressions or following includes. Only standalone
 * literal assignments before the first real opening brace are customizable. */
export function parseCustomizer(source: string): Parameter[] {
    const parameters = new Map<string, Parameter>()
    let group = ''
    let descriptions: string[] = []
    let statement = ''
    let depth = 0
    let braceDepth = 0
    let beforeFirstBrace = true
    let lastParameter: Parameter | undefined
    let statementDescription = ''
    for (let index = 0; index < source.length; index++) {
        const char = source[index]
        if (char === '"') {
            statement += char
            while (++index < source.length) {
                statement += source[index]
                if (source[index] === '\\') {
                    statement += source[++index] ?? ''
                } else if (source[index] === '"') {
                    break
                }
            }
            continue
        }
        if (char === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) {
            const block = source[index + 1] === '*'
            const end = source.indexOf(block ? '*/' : '\n', index + 2)
            const stop = end < 0 ? source.length : end
            const comment = source.slice(index + 2, stop).trim()
            const lineStart = source.lastIndexOf('\n', index - 1) + 1
            const standalone = !source.slice(lineStart, index).trim()
            if (braceDepth) {
                index = stop + (block && end >= 0 ? 1 : -1)
                continue
            }
            const heading = block && standalone && /^(?:\[[^\]]+\]\s*)+$/.test(comment) ? [...comment.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1].trim()).join('-') : undefined
            if (heading && !statement.trim()) {
                group = heading
                descriptions = []
            } else if (!block && lastParameter && !standalone) {
                annotate(lastParameter, comment)
            } else if (standalone && !statement.trim()) {
                descriptions.push(comment.replace(/^\s*\* ?/gm, '').trim())
            }
            statement += ' '
            index = stop + (block && end >= 0 ? 1 : -1)
            continue
        }
        if (char === '<' && /^\s*(?:include|use)\s*$/.test(statement)) {
            // Library directives have no required semicolon; do not swallow the next assignment.
            const end = source.indexOf('>', index + 1)
            if (end < 0) break
            index = end
            statement = ''
            descriptions = []
            continue
        }
        if (char === '{' || char === '}') {
            beforeFirstBrace = false
            braceDepth += char === '{' ? 1 : -1
            statement = ''
            descriptions = []
            lastParameter = undefined
            depth = 0
            continue
        }
        if (braceDepth) continue
        if (char === '\n') {
            lastParameter = undefined
        }
        if (!statement.trim() && !/\s/.test(char)) {
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
            if (assignment) parameters.delete(assignment[1])
            if (assignment && beforeFirstBrace && group !== 'Hidden') {
                const defaultValue = parseLiteral(assignment[2])
                if (defaultValue !== undefined) {
                    lastParameter = { name: assignment[1], group, description: statementDescription, defaultValue }
                    parameters.set(assignment[1], lastParameter)
                }
            }
            statement = ''
            statementDescription = ''
        } else {
            statement += char
        }
    }
    return [...parameters.values()]
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
