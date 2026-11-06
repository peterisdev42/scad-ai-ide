import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { analyzeCustomizerSource } from '../core/customizer/CustomizerSourceAnalyzer'
import { planCustomizerFix } from '../core/customizer/CustomizerFixPlanner'
import { applySourceEdits } from '../core/customizer/CustomizerSourceEditor'
import { customizerRules, type CustomizerRuleId } from '../core/customizer/CustomizerRules'

const cases: Array<[CustomizerRuleId, string, string]> = [
    ['CUST-ANN-01', '[0:10', '[0:10]'],
    ['CUST-ANN-02', '0', ''],
    ['CUST-RANGE-02', '[0:0:10]', '[0:10]'],
    ['CUST-ANN-03', '[1,,2]', '[1,2]'],
]
for (const [id, hint, replacement] of cases) {
    test(`${id} repairs one annotation, preserves unrelated warnings and is idempotent`, () => {
        const prefix = '\ufeff// 😀 尺寸\r\na = 1; '
        const suffix = '\r\nother=2; // [100:10]\r\ncube([a,other]);\r\n'
        const source = prefix + '// ' + hint + suffix
        const before = analyzeCustomizerSource(source)
        const diagnostic = before.diagnostics.find(item => item.ruleId === id)!
        assert.ok(diagnostic)
        assert.equal(diagnostic.fix.safety, 'safe')
        assert.equal(diagnostic.code, customizerRules[id].code)
        assert.equal(diagnostic.evidence.kind, 'explicit-effective-hint')
        const planned = planCustomizerFix(source, id, 'a')
        assert.equal(planned.edits.length, 1)
        assert.equal(applySourceEdits(source, planned.edits), planned.source)
        assert.equal(planned.source, prefix + (replacement ? '// ' + replacement : '') + suffix)
        assert.equal(analyzeCustomizerSource(planned.source).diagnostics.some(item => item.parameter === 'a'), false)
        assert.equal(analyzeCustomizerSource(planned.source).diagnostics.some(item => item.parameter === 'other'), true)
        assert.equal(planCustomizerFix(planned.source, id, 'a').edits.length, 0)
    })
}

test('review-only fixes do not swap bounds, change defaults, truncate text or delete complex options', () => {
    for (const [source, id] of [
        ['a=1; // [10:0]\n', 'CUST-RANGE-01'],
        ['a=120; // [0:100]\n', 'CUST-RANGE-03'],
        ['a="abcdef"; // 3\n', 'CUST-TEXT-02'],
        ['a="abc"; // -1\n', 'CUST-TEXT-01'],
        ['a="x"; // ["x",,"y"]\n', 'CUST-ANN-03'],
    ] as const) {
        assert.equal(analyzeCustomizerSource(source).diagnostics.find(item => item.ruleId === id)!.fix.safety, 'review')
        assert.throws(() => planCustomizerFix(source, id, 'a'), /review|length|empty|positive|range|default/i)
    }
    assert.throws(() => planCustomizerFix('a="unfinished', 'CUST-ANN-01', 'a'), /incomplete/)
})

test('ordinary bracketed prose never gains a fix or a warning from isolated punctuation', () => {
    for (const prose of ['[TODO check: width later', '[TODO check, docs later', '[e:1', '[0:22] IDs in Assembly.md; 0 shows the group', 'use ], comma, colon: for examples']) {
        const source = `a=1; // ${prose}\n`
        assert.deepEqual(analyzeCustomizerSource(source).diagnostics, [], prose)
        assert.deepEqual(planCustomizerFix(source, 'CUST-ANN-01', 'a').edits, [])
    }
})
