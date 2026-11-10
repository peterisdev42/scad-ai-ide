import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { validateCustomizerSource } from '../core/customizer/CustomizerSourceValidator'

test('validator compares every explicit expectation and reports independent skipped checks', () => {
    const source = '/* [Dimensions] */\n// Width\nwidth=40; // [10:5:100]\nshape="round"; // [round:Round,square:Square]\n'
    const expected = { name: 'width', widget: 'slider' as const, type: 'number' as const, group: 'Dimensions', defaultValue: 40, range: { min: 10, max: 100, step: 5 }, requireDescription: true }
    const result = validateCustomizerSource(source, [expected])
    assert.equal(result.semanticPass, true)
    assert.equal(result.matched, 1)
    assert.equal(result.runtimeCheck.status, 'notRequested')
    assert.equal(result.guiCheck.status, 'notRequested')
    for (const patch of [{ widget: 'spinbox' as const }, { group: 'Appearance' }, { defaultValue: 20 }, { range: { min: 0, max: 100 } }, { description: 'Wrong' }, { type: 'string' as const }]) assert.equal(validateCustomizerSource(source, [{ ...expected, ...patch }]).semanticPass, false)
    assert.equal(validateCustomizerSource(source, [{ name: 'shape', choices: [{ value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }] }]).semanticPass, true)
    assert.equal(validateCustomizerSource(source, [{ name: 'shape', choices: [{ value: 'round', label: 'Wrong' }] }]).semanticPass, false)
})
test('missing, wrong-widget, hidden and unsupported defaults fail explicit visible contracts', () => {
    for (const source of ['a=1;', 'width=2; width=3;', '/* [Hidden] */\nwidth=2;', 'width=1+1;']) assert.equal(validateCustomizerSource(source, [{ name: 'width', widget: 'slider' }]).semanticPass, false)
    assert.equal(validateCustomizerSource('/* [Hidden] */\na=1;', [{ name: 'a', visible: false }]).semanticPass, true)
    assert.equal(validateCustomizerSource('a=1;', [{ name: 'a', visible: false }]).semanticPass, false)
})
test('no targets means only static consistency; warnings filtering never hides a failed pass', () => {
    assert.equal(validateCustomizerSource('cube([1,2,3]);').semanticPass, true)
    const result = validateCustomizerSource('a=10; // [0:0:20]', [], false)
    assert.equal(result.semanticPass, false)
    assert.equal(result.diagnostics.length, 0)
    assert.equal(validateCustomizerSource('a=[1,2;', []).semanticPass, false)
})


test('validation compares the effective control rather than rejecting legal reassignment counts', () => {
    const source = 'width=10; // [1:1:200]\nwidth=30; // [1:1:200]\n'
    const expected = { name: 'width', widget: 'slider' as const, defaultValue: 30, range: { min: 1, max: 200, step: 1 } }
    assert.equal(validateCustomizerSource(source, [expected]).semanticPass, true)
    assert.equal(validateCustomizerSource(source, [{ ...expected, defaultValue: 10 }]).semanticPass, false)
    assert.equal(validateCustomizerSource('width=10; // [1:1:200]\nwidth=10+20;', [expected]).semanticPass, false)
    assert.equal(validateCustomizerSource('width=10; // [1:1:200]\n/* [Hidden] */\nwidth=30;', [{ name: 'width', visible: false }]).semanticPass, true)
})


test('unmet explicit targets are business results, never source errors or missing-syntax warnings', () => {
    for (const source of ['cube(10);', 'width=40;', 'width=20+20; // [1:1:200]']) {
        const result = validateCustomizerSource(source, [{ name: 'width', widget: 'slider', requireDescription: true }])
        assert.equal(result.semanticPass, false)
        assert.deepEqual(result.diagnostics, [])
        assert.equal(result.expectationResults.length, 1)
        assert.equal(result.expectationResults[0].matched, false)
        assert.ok(result.expectationResults[0].issues.length > 0)
    }
    assert.equal(validateCustomizerSource('width=40; derived=width/2;').semanticPass, true)
})

test('large unmet target results remain bounded without becoming source diagnostics', () => {
    const result = validateCustomizerSource('label="x";', Array.from({ length: 100 }, () => ({ name: 'label', defaultValue: 'x'.repeat(4096) })))
    assert.equal(result.semanticPass, false)
    assert.equal(result.complete, false)
    assert.ok(result.omittedExpectations > 0)
    assert.deepEqual(result.diagnostics, [])
    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') < 68000)
})

test('source completeness, explicit goals and quality are independent without changing legacy semanticPass', () => {
    const warning = validateCustomizerSource('w=120; // [0:100]\n', [{ name: 'w', widget: 'slider' }], false)
    assert.equal(warning.sourceStatus.status, 'complete')
    assert.equal(warning.contractStatus, 'matched')
    assert.equal(warning.qualityStatus, 'warnings')
    assert.equal(warning.semanticPass, false)
    assert.deepEqual(warning.diagnostics, [])
    const mismatch = validateCustomizerSource('w=40;\n', [{ name: 'w', widget: 'slider', requireDescription: true }])
    assert.equal(mismatch.sourceStatus.status, 'complete')
    assert.equal(mismatch.contractStatus, 'mismatch')
    assert.equal(mismatch.qualityStatus, 'clear')
    assert.deepEqual(mismatch.diagnostics, [])
    assert.deepEqual(mismatch.expectationResults[0].details.map(issue => issue.code).sort(), ['EXPECTED_DESCRIPTION', 'EXPECTED_WIDGET'])
    assert.ok(mismatch.expectationResults[0].details.every(issue => issue.range.start.line === 0))
    const incomplete = validateCustomizerSource('w="unfinished', [{ name: 'w' }])
    assert.equal(incomplete.sourceStatus.status, 'incomplete')
    assert.ok(incomplete.sourceStatus.reasons.includes('unterminatedString'))
    assert.equal(incomplete.contractStatus, 'unverified')
    assert.equal(incomplete.expectationResults[0].details[0].code, 'UNVERIFIED_INCOMPLETE')
})

test('overridden controls fail explicit visibility contracts and remain warnings without expectations', () => {
    const source = 'width=10;\nmodule model() {}\nwidth=20;'
    const result = validateCustomizerSource(source, [{ name: 'width', visible: true }])
    assert.equal(result.contractStatus, 'mismatch')
    assert.equal(result.qualityStatus, 'warnings')
    assert.equal(result.semanticPass, false)
    assert.equal(result.expectationResults[0].details[0].code, 'EXPECTED_VISIBLE')
    assert.equal(validateCustomizerSource(source).semanticPass, false)
    assert.equal(validateCustomizerSource(source, [], false).qualityStatus, 'warnings')
})
