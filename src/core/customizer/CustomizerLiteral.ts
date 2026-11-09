import type { ParameterValue } from './CustomizerModel'

export const numeric = /^[+-]?(?:0x[0-9a-f]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i
export const numberValue = (text: string): number => (text.startsWith('-') ? -Number(text.slice(1)) : Number(text.replace(/^\+/, '')))

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

