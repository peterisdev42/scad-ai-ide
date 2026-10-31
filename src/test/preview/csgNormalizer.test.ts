import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeCsg, boundaryCofactors } from '../../core/csg/normalize'
import { evaluateProgram } from '../../core/csg/acceleration'
import type { CsgInstruction, CsgProduct } from '../../core/csg/types'

const membership = (products: CsgProduct[], bits: number[]) => products.some((p) => p.intersections.every((id) => bits[id] === 1) && p.subtractions.every((id) => bits[id] === 0))

test('normalization and boundary cofactors preserve exhaustive Boolean truth tables', () => {
    let seed = 12345
    const random = (n: number) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed % n
    }
    for (let example = 0; example < 120; example++) {
        const program: CsgInstruction[] = [{ op: 'leaf', operand: 0 }, { op: 'leaf', operand: 1 }, { op: 'leaf', operand: 2 }, { op: 'leaf', operand: 3 }, { op: 'empty' }]
        for (let i = 0; i < 9; i++) program.push({ op: (['union', 'difference', 'intersection'] as const)[random(3)], left: random(program.length), right: random(program.length) })
        const root = program.length - 1,
            products = normalizeCsg(program, root)
        for (let state = 0; state < 16; state++) {
            const bits = Array.from({ length: 4 }, (_, i) => (state >> i) & 1)
            assert.equal(membership(products, bits), evaluateProgram(program, bits, root), JSON.stringify(program))
            for (let operand = 0; operand < 4; operand++) {
                const boundary = boundaryCofactors(program, root, operand)
                const one = evaluateProgram(
                        program,
                        bits.map((v, i) => (i === operand ? 1 : v)),
                        root,
                    ),
                    zero = evaluateProgram(
                        program,
                        bits.map((v, i) => (i === operand ? 0 : v)),
                        root,
                    )
                assert.equal(membership(boundary.inside, bits), one)
                assert.equal(membership(boundary.outside, bits), zero)
            }
        }
    }
})

test('difference of difference and intersection use De Morgan algebra exactly', () => {
    const leaves: CsgInstruction[] = [0, 1, 2].map((operand) => ({ op: 'leaf', operand }))
    const difference = [...leaves, { op: 'difference', left: 1, right: 2 }, { op: 'difference', left: 0, right: 3 }] as CsgInstruction[]
    assert.deepEqual(normalizeCsg(difference, 4), [
        { intersections: [0], subtractions: [1] },
        { intersections: [0, 2], subtractions: [] },
    ])
    const intersection = [...leaves, { op: 'intersection', left: 1, right: 2 }, { op: 'difference', left: 0, right: 3 }] as CsgInstruction[]
    assert.deepEqual(normalizeCsg(intersection, 4), [
        { intersections: [0], subtractions: [1] },
        { intersections: [0], subtractions: [2] },
    ])
})

test('empty, repeated, contradictory and invalid instructions are bounded', () => {
    assert.deepEqual(normalizeCsg([{ op: 'empty' }], 0), [])
    const contradiction: CsgInstruction[] = [
        { op: 'leaf', operand: 0 },
        { op: 'difference', left: 0, right: 0 },
    ]
    assert.deepEqual(normalizeCsg(contradiction, 1), [])
    assert.throws(() => normalizeCsg([{ op: 'union', left: 0, right: 0 }], 0), /Invalid/)
    assert.throws(() => normalizeCsg([{ op: 'leaf', operand: -1 }], 0), /Invalid/)
    const program: CsgInstruction[] = []
    let root = -1
    for (let i = 0; i < 16; i++) {
        const a = program.push({ op: 'leaf', operand: i * 2 }) - 1,
            b = program.push({ op: 'leaf', operand: i * 2 + 1 }) - 1
        const pair = program.push({ op: 'union', left: a, right: b }) - 1
        root = root < 0 ? pair : program.push({ op: 'intersection', left: root, right: pair }) - 1
    }
    assert.throws(() => normalizeCsg(program, root), /complexity limit/)
    assert.throws(() => normalizeCsg([{ op: 'leaf', operand: 0 }], 0, { work: 0 }), /complexity limit/)
})

test('large left-deep trees use an explicit stack', () => {
    const program: CsgInstruction[] = [{ op: 'leaf', operand: 0 }]
    let root = 0
    for (let i = 0; i < 4000; i++) root = program.push({ op: 'union', left: root, right: 0 }) - 1
    assert.deepEqual(normalizeCsg(program, root), [{ intersections: [0], subtractions: [] }])
})
