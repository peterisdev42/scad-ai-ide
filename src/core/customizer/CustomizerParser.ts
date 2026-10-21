export type ParameterValue = string | number | boolean

export interface Parameter {
    name: string
    group: string
    description: string
    defaultValue: ParameterValue
    range?: { min: number; max: number; step?: number }
    choices?: { label: string; value: ParameterValue }[]
}

export function parseLiteral(text: string): ParameterValue | undefined {
    if (text === 'true' || text === 'false') {
        return text === 'true'
    }
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
        const value = Number(text)
        return Number.isFinite(value) ? value : undefined
    }
    if (/^"(?:\\.|[^"\\])*"$/.test(text)) {
        try {
            return JSON.parse(text) as string
        } catch {
            return undefined
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
    const annotation = /^\s*\[(.*)\]\s*$/.exec(comment)?.[1]
    if (annotation === undefined) {
        return
    }
    const parts = splitOutsideStrings(annotation, ':')
    if (typeof parameter.defaultValue === 'number' && (parts.length === 2 || parts.length === 3) && !annotation.includes(',')) {
        const numbers = parts.map(Number)
        const min = numbers[0]
        const max = numbers.at(-1)!
        const step = numbers.length === 3 ? numbers[1] : undefined
        if (numbers.every(Number.isFinite)) {
            if (min <= max && (step === undefined || step > 0)) {
                parameter.range = { min, max, step }
            }
            return
        }
    }
    const choices = splitOutsideStrings(annotation, ',')
        .map((entry) => {
            const [raw, label] = splitOutsideStrings(entry, ':')
            const value = parseLiteral(raw) ?? (typeof parameter.defaultValue === 'string' && raw ? raw : undefined)
            return { value, label: label ? String(parseLiteral(label) ?? label) : String(value) }
        })
        .filter((choice): choice is { value: ParameterValue; label: string } => choice.value !== undefined && typeof choice.value === typeof parameter.defaultValue)
    if (choices.length) {
        parameter.choices = choices
    }
}

export function parseCustomizer(source: string): Parameter[] {
    const parameters: Parameter[] = []
    let group = ''
    let description = ''
    let blockComment = false
    for (const line of source.split(/\r?\n/)) {
        const heading = !blockComment && /^\s*\/\*\s*\[([^\]]+)\]\s*\*\/\s*$/.exec(line)
        if (heading) {
            group = heading[1].trim()
            description = ''
            continue
        }
        let code = ''
        let comment = ''
        let quoted = false
        for (let index = 0; index < line.length; index++) {
            const char = line[index]
            const next = line[index + 1]
            if (blockComment) {
                if (char === '*' && next === '/') {
                    blockComment = false
                    index++
                }
                continue
            }
            if (quoted) {
                code += char
                if (char === '\\') {
                    code += line[++index] ?? ''
                    continue
                }
                if (char === '"') {
                    quoted = false
                }
                continue
            }
            if (char === '"') {
                quoted = true
                code += char
                continue
            }
            if (char === '/' && next === '*') {
                blockComment = true
                code += ' '
                index++
                continue
            }
            if (char === '/' && next === '/') {
                comment = line.slice(index + 2).trim()
                break
            }
            code += char
        }
        if (!code.trim()) {
            description = comment || description
            continue
        }
        // First phase: scalar assignments before module/function definitions or geometry blocks.
        const structural = code.replace(/"(?:\\.|[^"\\])*"/g, '""')
        if (/\b(?:module|function)\b|[{}]/.test(structural)) {
            break
        }
        const assignment = /^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*;\s*$/.exec(code)
        if (assignment && group !== 'Hidden') {
            const defaultValue = parseLiteral(assignment[2])
            if (defaultValue !== undefined && !parameters.some((parameter) => parameter.name === assignment[1])) {
                const parameter: Parameter = { name: assignment[1], group, description, defaultValue }
                annotate(parameter, comment)
                parameters.push(parameter)
            }
        }
        description = ''
    }
    return parameters
}
