/** Lightweight CSG metadata only: no evaluation, tessellation or code execution. */
export interface CsgPartHint {
    id: string
    min: number[]
    max: number[]
    color?: number[]
}
type Value = number | string | boolean | null | Value[]
interface Node {
    name: string
    args: Record<string, Value>
    children: Node[]
}
type Bounds = { min: number[]; max: number[] }
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const multiply = (a: number[], b: number[]) => a.map((_, i) => [0, 1, 2, 3].reduce((sum, k) => sum + a[Math.floor(i / 4) * 4 + k] * b[k * 4 + (i % 4)], 0))
const merge = (boxes: Bounds[]): Bounds | undefined => (boxes.length ? { min: [0, 1, 2].map((d) => Math.min(...boxes.map((b) => b.min[d]))), max: [0, 1, 2].map((d) => Math.max(...boxes.map((b) => b.max[d]))) } : undefined)
const transform = (b: Bounds, m: number[]): Bounds => {
    const points = Array.from({ length: 8 }, (_, i) => [0, 1, 2].map((d) => (i & (1 << d) ? b.max[d] : b.min[d])))
    const world = points.map((p) => [0, 1, 2].map((d) => m[d * 4 + 3] + p.reduce((s, v, k) => s + m[d * 4 + k] * v, 0)))
    return { min: [0, 1, 2].map((d) => Math.min(...world.map((p) => p[d]))), max: [0, 1, 2].map((d) => Math.max(...world.map((p) => p[d]))) }
}

export function readCsgPartHints(source: string): CsgPartHint[] {
    if (source.length > 2 * 1024 * 1024) throw new Error('CSG color metadata exceeds 2 MiB.')
    const tokens = (source.match(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[$\w]+|[^\s]/g) ?? []).filter((token) => !token.startsWith('//') && !token.startsWith('/*'))
    if (tokens.length > 300000) throw new Error('CSG color metadata is too complex.')
    let cursor = 0,
        nodes = 0
    const expect = (value: string) => {
        if (tokens[cursor++] !== value) throw new Error('Unsupported CSG color metadata.')
    }
    const value = (depth = 0): Value => {
        if (depth > 64) throw new Error('CSG value nesting limit.')
        const token = tokens[cursor++]
        if (token === '[') {
            const result: Value[] = []
            while (tokens[cursor] !== ']') {
                result.push(value(depth + 1))
                if (tokens[cursor] !== ']') expect(',')
            }
            cursor++
            return result
        }
        if (token?.startsWith('"')) return JSON.parse(token)
        if (token === 'true' || token === 'false') return token === 'true'
        if (token === 'undef') return null
        const number = Number(token)
        if (!Number.isFinite(number)) throw new Error('Unsupported CSG argument.')
        return number
    }
    const sequence = (depth = 0): Node[] => {
        if (depth > 128) throw new Error('CSG tree nesting limit.')
        const result: Node[] = []
        while (cursor < tokens.length && tokens[cursor] !== '}') {
            if (++nodes > 20000) throw new Error('CSG node limit.')
            let name = tokens[cursor++]
            let ignored = false
            while (['#', '%', '!', '*'].includes(name)) {
                ignored ||= name === '%' || name === '*'
                name = tokens[cursor++]
                if (name === undefined) throw new Error('Invalid CSG modifier.')
            }
            expect('(')
            const args: Record<string, Value> = Object.create(null)
            let positional = 0
            while (tokens[cursor] !== ')') {
                let key = String(positional++)
                if (tokens[cursor + 1] === '=') {
                    key = tokens[cursor++]
                    cursor++
                }
                args[key] = value()
                if (tokens[cursor] !== ')') expect(',')
            }
            cursor++
            let children: Node[] = []
            if (tokens[cursor] === '{') {
                cursor++
                children = sequence(depth + 1)
                expect('}')
            } else expect(';')
            result.push({ name: ignored ? '__ignored' : name, args, children })
        }
        return result
    }
    const roots = sequence()
    if (cursor !== tokens.length) throw new Error('Unexpected CSG terminator.')
    const matrix = (node: Node) => {
        const m = (node.args.m ?? node.args['0']) as Value[][] | undefined
        if (!Array.isArray(m) || m.length !== 4 || !m.every((row) => Array.isArray(row) && row.length === 4 && row.every((n) => typeof n === 'number'))) throw new Error('Invalid CSG matrix.')
        return m.flat() as number[]
    }
    const bounds = (node: Node, m: number[]): Bounds | undefined => {
        const a = node.args
        const num = (key: string, fallback = 0) => (typeof a[key] === 'number' ? (a[key] as number) : fallback)
        if (node.name === 'multmatrix') return merge(node.children.map((c) => bounds(c, multiply(m, matrix(node)))).filter((b): b is Bounds => !!b))
        let local: Bounds | undefined
        if (node.name === 'cube') {
            const size = a.size ?? a['0'] ?? 1
            const dimensions = typeof size === 'number' ? [size, size, size] : (size as number[])
            if (Array.isArray(dimensions) && dimensions.length === 3 && dimensions.every((n) => typeof n === 'number' && n >= 0)) local = { min: dimensions.map((n) => (a.center ? -n / 2 : 0)), max: dimensions.map((n) => (a.center ? n / 2 : n)) }
        } else if (node.name === 'sphere' || node.name === 'cylinder') {
            const radius = Math.max(num('r', num('d') / 2), num('r1', num('d1') / 2), num('r2', num('d2') / 2))
            const height = num('h', 1)
            local = node.name === 'sphere' ? { min: [-radius, -radius, -radius], max: [radius, radius, radius] } : { min: [-radius, -radius, a.center ? -height / 2 : 0], max: [radius, radius, a.center ? height / 2 : height] }
        } else if (node.name === 'polyhedron') {
            const points = a.points as number[][]
            if (Array.isArray(points) && points.length && points.every((p) => Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === 'number'))) local = merge(points.map((p) => ({ min: p, max: p })))
        } else {
            // A difference cannot extend beyond its positive operand. Other
            // supported containers retain conservative bounds, not solid semantics.
            if (!['group', 'union', 'difference', 'intersection', 'color', 'render', 'hull'].includes(node.name)) return undefined
            const children = node.name === 'difference' ? node.children.slice(0, 1) : node.children
            const boxes = children.map((c) => bounds(c, m))
            if (boxes.some((b) => !b)) return undefined
            return merge(boxes as Bounds[])
        }
        return local ? transform(local, m) : undefined
    }
    const hints: CsgPartHint[] = []
    const append = (node: Node, m: number[], path: string, color?: number[]) => {
        const box = bounds(node, m)
        if (box && [...box.min, ...box.max].every(Number.isFinite) && box.min.every((n, d) => n <= box.max[d])) hints.push({ id: path, ...box, color })
        if (hints.length > 256) throw new Error('CSG part limit.')
    }
    const colors = (list: Node[], m: number[], path: string) =>
        list.forEach((node, i) => {
            const key = `${path}/${i}`
            if (node.name === '__ignored') return
            if (node.name === 'multmatrix') colors(node.children, multiply(m, matrix(node)), key)
            else if (node.name === 'color') {
                const color = (node.args.c ?? node.args['0']) as number[]
                append(node, m, key, Array.isArray(color) && color.length >= 3 ? color.slice(0, 3) : undefined)
            } else colors(node.children, m, key)
        })
    colors(roots, identity, '')
    if (!hints.length) {
        const groups = (list: Node[], m: number[], path: string): void => {
            if (list.length === 1 && ['group', 'union', 'multmatrix'].includes(list[0].name)) {
                const node = list[0]
                return groups(node.children, node.name === 'multmatrix' ? multiply(m, matrix(node)) : m, `${path}/0`)
            }
            list.forEach((node, i) => append(node, m, `${path}/${i}`))
        }
        groups(roots, identity, '')
    }
    return hints
}
