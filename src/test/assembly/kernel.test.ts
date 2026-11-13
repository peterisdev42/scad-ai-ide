import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeAssembly } from '../../core/assembly/AssemblyKernel'
import { parseManifest } from '../../core/assembly/PartRegistry'
import { box, stl } from '../mesh/fixtures'
import { bound, rat, next } from '../../core/assembly/exact'
const part = (id: string, size: [number, number, number] = [1, 1, 1], origin: [number, number, number] = [0, 0, 0]) => ({ id, bytes: stl(box(size, origin), true), format: 'stl' as const, transform: undefined })
async function pair(a = part('a'), b = part('b', [1, 1, 1], [1.3, 0, 0])) {
    return analyzeAssembly([a, b], [['a', 'b']])
}
test('certified scalar rounding and exact representable thresholds', () => {
    assert.deepEqual(bound(rat(1n, 4n), 0), { lower: 0.25, upper: 0.25 })
    const r = bound(rat(3n, 10n), 0)!
    assert.equal(r.lower, 0.3)
    assert.equal(r.upper, next(0.3, true))
    assert.deepEqual(bound(rat(4n), 0, true), { lower: 2, upper: 2 })
})
test('positive separation, physical volume and dimensions', async () => {
    const r = await pair()
    assert.equal(r.parts[0].volumeBound?.lower, 1)
    assert.equal(r.pairs[0].relation, 'clear')
    assert.ok(r.pairs[0].distanceBound!.lower > 0.25)
    assert.ok(r.pairs[0].distanceBound!.upper < 0.35)
    assert.ok(r.worldMesh?.length)
    assert.equal(r.display?.bytes.length, 1284)
})
for (const [name, origin] of [
    ['face', [1, 0, 0]],
    ['edge', [1, 1, 0]],
    ['point', [1, 1, 1]],
] as const)
    test(`support plane proves ${name} contact`, async () => {
        const r = await pair(part('a'), part('b', [1, 1, 1], [...origin]))
        assert.equal(r.pairs[0].relation, 'contact')
        assert.deepEqual(r.pairs[0].distanceBound, { lower: 0, upper: 0 })
    })
for (const [name, a, b] of [
    ['crossing', part('a'), part('b', [1, 1, 1], [0.5, 0.5, 0.5])],
    ['coincident', part('a'), part('b')],
    ['contained', part('a', [3, 3, 3]), part('b', [1, 1, 1], [1, 1, 1])],
] as const)
    test(`material overlap: ${name}`, async () => {
        const r = await pair(a, b)
        assert.equal(r.pairs[0].relation, 'overlap', JSON.stringify(r.incomplete))
        assert.equal(r.pairs[0].overlapVolume, null)
    })
test('cavity is empty material, multi-region containment is not one-vertex sampling', async () => {
    const shell = part('a', [4, 4, 4])
    shell.bytes = stl([...box([4, 4, 4]), ...box([2, 2, 2], [1, 1, 1]).map((t) => [t[0], t[2], t[1]])], true)
    const r = await pair(shell, part('b', [1, 1, 1], [1.5, 1.5, 1.5]))
    assert.equal(r.pairs[0].relation, 'clear')
    assert.equal(r.parts[0].volumeBound?.lower, 56)
})
test('invalid raw mesh cannot produce assembly PASS', async () => {
    const a = part('a')
    a.bytes = stl(box().slice(1))
    const r = await pair(a)
    assert.equal(r.pairs[0].relation, 'undetermined')
    assert.equal(r.complete, false)
})
test('manifest identity ignores array order, validates contradictions and injection', () => {
    const m = {
        schemaVersion: 1,
        units: 'mm',
        entry: './model.scad',
        parts: [
            { id: 'a', selector: { type: 'define', name: 'part', value: 'body' } },
            { id: 'b', selector: { type: 'file', path: './lid.stl' } },
        ],
        checks: [{ id: 'gap', type: 'clearance', parts: ['a', 'b'], min: 0.25, max: 0.35 }],
    }
    const a = parseManifest(JSON.stringify(m))
    assert.ok(a.manifest, JSON.stringify(a.issues))
    m.parts.reverse()
    const b = parseManifest(JSON.stringify(m))
    assert.equal(a.digest, b.digest)
    m.checks.push({ id: 'bad', type: 'clearance', parts: ['a', 'b'], min: 1, max: 2 })
    assert.ok(parseManifest(JSON.stringify(m)).issues.some((i) => i.code === 'CONTRADICTORY_CONSTRAINTS'))
    const unsafe = JSON.stringify(m).replace('"name":"part"', '"name":"part);cube(9)"')
    assert.equal(parseManifest(unsafe).manifest, null)
})
import { evaluate, rangeStatus } from '../../core/assembly/constraints'
test('same pair facts evaluate .30/.18 against .25 independently, contact cannot waive minimum', async () => {
    for (const gap of [0.3, 0.18]) {
        const f = await pair(part('a'), part('b', [1, 1, 1], [1 + gap, 0, 0]))
        const m = parseManifest(
            JSON.stringify({
                schemaVersion: 1,
                units: 'mm',
                parts: [
                    { id: 'a', selector: { type: 'file', path: 'a.stl' } },
                    { id: 'b', selector: { type: 'file', path: 'b.stl' } },
                ],
                checks: [
                    { id: 'loose', type: 'clearance', parts: ['a', 'b'], min: 0.1 },
                    { id: 'strict', type: 'clearance', parts: ['a', 'b'], min: 0.25, max: 0.35 },
                ],
            }),
        ).manifest!
        const c = evaluate(m, f)
        assert.equal(c.find((c) => c.id === 'loose')?.status, 'PASS')
        assert.equal(c.find((c) => c.id === 'strict')?.status, gap === 0.3 ? 'PASS' : 'FAIL')
        m.checks = [{ id: 'gap', type: 'clearance', parts: ['a', 'b'], min: 0.25, allowContact: true }]
        const contact = await pair(part('a'), part('b', [1, 1, 1], [1, 0, 0]))
        assert.equal(evaluate(m, contact).find((c) => c.id === 'gap')?.status, 'FAIL')
    }
    assert.equal(rangeStatus({ lower: 0.249999, upper: 0.250001 }, 0.25), 'UNRESOLVED')
})
test('rigid transform order, reflected intrinsic 3MF and mm volume', async () => {
    const a = part('a', [1, 2, 3])
    const r = await analyzeAssembly([{ ...a, transform: { rotate: [0, 0, 90], translate: [10, 0, 0] } }], [])
    assert.equal(r.parts[0].world.bounds?.min[0], 8)
    assert.equal(r.parts[0].world.bounds?.max[0], 10)
    assert.equal(r.parts[0].volumeBound?.lower, 6)
})
