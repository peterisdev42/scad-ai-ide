import test from 'node:test'
import assert from 'node:assert/strict'
import { parseManifest } from '../../core/assembly/PartRegistry'
const m = () => ({
    schemaVersion: 1,
    units: 'mm',
    entry: './model.scad',
    parts: [
        { id: 'body', selector: { type: 'define', name: 'part', value: 'body' } },
        { id: 'lid', selector: { type: 'file', path: './lid.stl' } },
    ],
    checks: [{ id: 'gap', type: 'clearance', parts: ['body', 'lid'], min: 0.25, max: 0.35 }],
})
test('strict schema and semantic validation reject malformed declarations with JSON positions', () => {
    const cases: [string, (v: any) => void][] = [
        ['DUPLICATE_PART_ID', (v) => v.parts.push(v.parts[0])],
        ['DUPLICATE_CHECK_ID', (v) => v.checks.push(v.checks[0])],
        ['PART_NOT_FOUND', (v) => (v.checks[0].parts[1] = 'missing')],
        ['SELF_PAIR', (v) => (v.checks[0].parts[1] = 'body')],
        ['MANIFEST_SCHEMA', (v) => (v.schemaVersion = 2)],
        ['MANIFEST_SCHEMA', (v) => (v.units = 'inch')],
        ['MANIFEST_SCHEMA', (v) => (v.checks[0].min = -1)],
        ['MANIFEST_SCHEMA', (v) => (v.parts[0].selector.name = '$fn')],
        ['MANIFEST_SCHEMA', (v) => (v.parts[1].transform = { scale: [2, 2, 2] })],
        ['PART_ENTRY_MISSING', (v) => delete v.entry],
        ['CONTRADICTORY_CONSTRAINTS', (v) => v.checks.push({ id: 'contact', type: 'relation', parts: ['body', 'lid'], allowed: ['contact'] })],
    ]
    for (const [code, mutate] of cases) {
        const value = m()
        mutate(value)
        const text = JSON.stringify(value, null, 2),
            r = parseManifest(text)
        assert.equal(r.manifest, null)
        const issue = r.issues.find((i) => i.code === code)
        assert.ok(issue, JSON.stringify(r.issues))
        assert.ok(issue.offset >= 0 && issue.offset < text.length)
        assert.ok(issue.length > 0)
    }
    assert.equal(parseManifest('{"units": /* no comments */"mm"}').issues[0].code, 'MANIFEST_JSON')
})
test('semantic digest is stable for reordered declarations but binds thresholds, units and transforms', () => {
    const a = m(),
        first = parseManifest(JSON.stringify(a))
    a.parts.reverse()
    assert.equal(parseManifest(JSON.stringify(a)).digest, first.digest)
    a.checks[0].min = 0.2
    assert.notEqual(parseManifest(JSON.stringify(a)).digest, first.digest)
})
