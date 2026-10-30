/** Only reject sources we can prove contain no geometry. Unknown syntax stays eligible. */
export function canPreviewSource(source: string): boolean {
    // Preserve strings as a single token so comment markers/semicolons inside them are harmless.
    const tokens = source.match(/"(?:\\[\s\S]|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|[A-Za-z_$][\w$]*|\s+|./g) ?? []
    const code = tokens.filter((token) => !/^\s+$|^\/\/|^\/\*/.test(token))
    let index = 0
    while (index < code.length) {
        if (code[index] === ';') {
            index++
            continue
        }
        if (!/^[A-Za-z_$][\w$]*$/.test(code[index]) || code[index + 1] !== '=') {
            return true
        }
        index += 2
        const stack: string[] = []
        let hasValue = false
        let ended = false
        for (; index < code.length; index++) {
            const token = code[index]
            if (token === '{' || token === '}') {
                return true
            }
            if (token === '(' || token === '[') {
                stack.push(token)
            }
            if (token === ')' || token === ']') {
                if (stack.pop() !== (token === ')' ? '(' : '[')) {
                    return true
                }
            }
            if (token === ';') {
                if (stack.length || !hasValue) {
                    return true
                }
                index++
                ended = true
                break
            }
            hasValue = true
        }
        if (!ended) {
            return true
        }
    }
    return false
}

export const emptyModelMessage = 'This file has no geometry to preview.'

export class EmptyModelError extends Error {
    constructor() {
        super(emptyModelMessage)
        this.name = 'EmptyModelError'
    }
}

/** Do not hide real parser, evaluation, or exporter errors alongside the empty result. */
export function isEmptyModelOutput(stderr: string): boolean {
    return /^\s*Current top level object is empty\.\s*$/m.test(stderr) && !/\bERROR:|Parser error|Parsing design.*failed/i.test(stderr)
}
