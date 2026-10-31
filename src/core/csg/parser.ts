export type CsgValue = number | string | boolean | null | CsgValue[]
export interface CsgNode {
    name: string
    params: Record<string, CsgValue>
    children: CsgNode[]
    modifiers: string
}

/** Parse the evaluated CSG interchange format, never executable SCAD/JavaScript. */
export function parseCsg(source: string): CsgNode[] {
    if (source.length > 20 * 1024 * 1024) throw new Error('CSG input exceeds 20 MB.')
    const pattern = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[$a-z_][$\w]*|[()[\]{},;=#!%*]/iy
    const tokens: string[] = []
    let offset = 0
    while (offset < source.length) {
        pattern.lastIndex = offset
        const match = pattern.exec(source)
        if (!match) throw new Error(`Invalid CSG token at offset ${offset}.`)
        offset = pattern.lastIndex
        if (!/^\s|^\/\//.test(match[0]) && !match[0].startsWith('/*')) tokens.push(match[0])
    }
    let index = 0
    let count = 0
    const expect = (value: string) => {
        if (tokens[index++] !== value) throw new Error(`Expected '${value}' in CSG at token ${index}.`)
    }
    const value = (depth: number): CsgValue => {
        if (depth > 256) throw new Error('CSG nesting limit exceeded.')
        const token = tokens[index++]
        if (token === '[') {
            const result: CsgValue[] = []
            while (tokens[index] !== ']') {
                result.push(value(depth + 1))
                if (tokens[index] !== ',') break
                index++
                if (tokens[index] === ']') break
            }
            expect(']')
            return result
        }
        if (token?.startsWith('"')) return JSON.parse(token)
        if (token === 'true' || token === 'false') return token === 'true'
        if (token === 'undef' || token === 'null') return null
        if (token && Number.isFinite(Number(token))) return Number(token)
        throw new Error(`Expected a literal CSG value, got '${token}'.`)
    }
    const node = (depth: number): CsgNode => {
        if (depth > 256 || ++count > 100000) throw new Error('CSG complexity limit exceeded.')
        let modifiers = ''
        while (/^[#!%*]$/.test(tokens[index] ?? '')) modifiers += tokens[index++]
        const name = tokens[index++]
        if (!/^[$a-z_][$\w]*$/i.test(name ?? '')) throw new Error(`Expected CSG instruction, got '${name}'.`)
        expect('(')
        const params: Record<string, CsgValue> = Object.create(null)
        let positional = 0
        while (tokens[index] !== ')') {
            let key = `$${positional++}`
            if (tokens[index + 1] === '=') {
                key = tokens[index]
                index += 2
            }
            params[key] = value(depth + 1)
            if (tokens[index] !== ',') break
            index++
        }
        expect(')')
        const children: CsgNode[] = []
        if (tokens[index] === '{') {
            index++
            while (tokens[index] !== '}') children.push(node(depth + 1))
            expect('}')
        } else if (tokens[index] === ';') index++
        else children.push(node(depth + 1))
        return { name, params, children, modifiers }
    }
    const result: CsgNode[] = []
    while (index < tokens.length) {
        if (tokens[index] === ';') index++
        else result.push(node(0))
    }
    return result
}

/** Native preview chooses the first root tag in depth-first order. */
export function selectCsgRoots(trees: CsgNode[]): CsgNode[] {
    const find = (nodes: CsgNode[]): CsgNode | undefined => {
        for (const node of nodes) {
            if (node.modifiers.includes('*')) continue
            if (node.modifiers.includes('!')) return { ...node, modifiers: node.modifiers.replace(/!/g, '') }
            const nested = find(node.children)
            if (nested) return nested
        }
    }
    const root = find(trees)
    return root ? [root] : trees
}
