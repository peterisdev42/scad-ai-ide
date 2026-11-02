import type { CsgInstruction, CsgProduct } from './types'

export interface NormalizationLimits {
    products: number
    literals: number
    work: number
}
const defaults: NormalizationLimits = { products: 4096, literals: 65536, work: 1000000 }
type Term = number[] // Signed (operand + 1); negative literals mean subtraction.

/** Exact disjunctive normal form, including complements of nested differences.
 * [] is false; [[]] is true. The universal term is internal only: a valid CSG
 * root always has a positive operand. No recursion or unbounded expansion.
 */
export function normalizeCsg(program: CsgInstruction[], root: number, limits: Partial<NormalizationLimits> = {}, constants = new Map<number, boolean>()): CsgProduct[] {
    const budget = { ...defaults, ...limits }
    let work = 0
    const check = (terms: Term[]) => {
        if (terms.length > budget.products || terms.reduce((n, t) => n + t.length, 0) > budget.literals || work > budget.work) throw new Error(`CSG normalization complexity limit exceeded (${budget.products} products / ${budget.literals} literals / ${budget.work} operations). Simplify the expression or use Full Render.`)
        return terms
    }
    const unique = (terms: Term[]) => {
        const map = new Map<string, Term>()
        for (const term of terms) {
            if (!term.length) return [[]]
            map.set(term.join(','), term)
        }
        return check([...map.values()])
    }
    const union = (a: Term[], b: Term[]) => {
        work += a.length + b.length
        return unique([...a, ...b])
    }
    const intersect = (a: Term[], b: Term[]) => {
        const result: Term[] = []
        let literalCount = 0
        for (const x of a)
            for (const y of b) {
                work += x.length + y.length + 1
                if (work > budget.work) check(result)
                const literals = new Set(x)
                if (y.some((v) => literals.has(-v))) continue
                y.forEach((v) => literals.add(v))
                result.push([...literals].sort((a, b) => a - b))
                literalCount += result[result.length - 1].length
                if (result.length > budget.products || literalCount > budget.literals) check(result)
            }
        return unique(result)
    }
    const values = new Map<number, Term[]>()
    const stack: Array<[number, boolean, boolean]> = [[root, false, false]]
    while (stack.length) {
        const [id, negative, ready] = stack.pop()!,
            key = id * 2 + Number(negative)
        if (values.has(key)) continue
        const instruction = program[id]
        if (!instruction || !Number.isInteger(id) || id < 0) throw new Error('Invalid CSG normalization instruction.')
        if (++work > budget.work) check([])
        if (instruction.op === 'empty') {
            values.set(key, negative ? [[]] : [])
            continue
        }
        if (instruction.op === 'leaf') {
            if (!Number.isInteger(instruction.operand) || instruction.operand < 0) throw new Error('Invalid CSG normalization operand.')
            const constant = constants.get(instruction.operand)
            values.set(key, constant === undefined ? [[(instruction.operand + 1) * (negative ? -1 : 1)]] : constant !== negative ? [[]] : [])
            continue
        }
        if (!['union', 'intersection', 'difference'].includes(instruction.op) || instruction.left >= id || instruction.right >= id || instruction.left < 0 || instruction.right < 0) throw new Error('Invalid CSG normalization DAG.')
        const leftKey = instruction.left * 2 + Number(negative)
        const rightNegative = instruction.op === 'difference' ? !negative : negative
        const rightKey = instruction.right * 2 + Number(rightNegative)
        if (!ready) {
            stack.push([id, negative, true], [instruction.right, rightNegative, false], [instruction.left, negative, false])
            continue
        }
        const isUnion = instruction.op === 'union' ? !negative : negative
        values.set(key, isUnion ? union(values.get(leftKey)!, values.get(rightKey)!) : intersect(values.get(leftKey)!, values.get(rightKey)!))
    }
    return check(values.get(root * 2)!).map((term) => ({ intersections: term.filter((v) => v > 0).map((v) => v - 1), subtractions: term.filter((v) => v < 0).map((v) => -v - 1) }))
}

/** Cofactors on the two sides of an operand boundary. Keeping these as two
 * product sets avoids distributing F1 & !F0 into a potentially much larger DNF.
 * The GPU computes membership on each side and compares the resulting bits.
 * Spatially disjoint operands can safely be replaced by false. */
export function boundaryCofactors(program: CsgInstruction[], root: number, operand: number, constants = new Map<number, boolean>()) {
    return {
        inside: normalizeCsg(program, root, {}, new Map([...constants, [operand, true]])),
        outside: normalizeCsg(program, root, {}, new Map([...constants, [operand, false]])),
    }
}
