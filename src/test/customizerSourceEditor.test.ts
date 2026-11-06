import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { planCustomizerEdits, applySourceEdits } from '../core/customizer/CustomizerSourceEditor'
import { parseCustomizer } from '../core/customizer/CustomizerParser'
import type { SourceEditIntent } from '../core/customizer/CustomizerSourceTypes'

const slider: SourceEditIntent = { kind: 'annotateExisting', name: 'width', widget: 'slider', description: 'Width in millimeters', range: { min: 10, max: 100, step: 5 } }
test('minimal edits preserve CRLF, indentation, geometry, directives and final newline; idempotent', () => {
    const source = 'include <shapes.scad>\r\n// existing description\r\n  width = 40;\r\n\r\nmodule shape() { cube([width,2,3]); }\r\n'
    const plan = planCustomizerEdits(source, [slider])
    assert.equal(applySourceEdits(source, plan.edits), plan.source)
    assert.equal(plan.validation.semanticPass, true)
    assert.ok(plan.source.endsWith('\r\n\r\nmodule shape() { cube([width,2,3]); }\r\n'))
    assert.ok(plan.source.startsWith('include <shapes.scad>\r\n// Width in millimeters\r\n  width = 40; // [10:5:100]'))
    assert.equal(planCustomizerEdits(plan.source, [slider]).edits.length, 0)
})
test('batch group intents preserve neighboring groups and all non-target declarations', () => {
    const source = 'width=40;\nheight=20;\nshape="round";\nmodule model() { cube([width,height,1]); }\n'
    const intents: SourceEditIntent[] = [slider, { ...slider, name: 'height', description: 'Height', group: 'Dimensions' }, { kind: 'changeWidget', name: 'shape', widget: 'dropdown', group: 'Appearance', choices: [{ value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }] }]
    intents[0] = { ...slider, group: 'Dimensions' }
    const plan = planCustomizerEdits(source, intents)
    assert.equal(plan.validation.semanticPass, true)
    assert.deepEqual(parseCustomizer(plan.source).map((p) => p.group), ['Dimensions', 'Dimensions', 'Appearance'])
    assert.equal(applySourceEdits(source, plan.edits), plan.source)
    assert.equal(planCustomizerEdits(plan.source, intents).edits.length, 0)
})
test('insert literal, move group, hide parameter, quoted choices and explicit range conversion', () => {
    const inserted = planCustomizerEdits('cube([1,2,3]);\n', [{ kind: 'insertLiteralParameter', name: 'width', widget: 'slider', defaultValue: 40, group: 'Dimensions', range: { min: 10, max: 100, step: 5 } }])
    assert.equal(inserted.validation.semanticPass, true)
    const hidden = planCustomizerEdits(inserted.source, [{ kind: 'hideParameter', name: 'width' }])
    assert.equal(parseCustomizer(hidden.source).length, 0)
    assert.equal(planCustomizerEdits(hidden.source, [{ kind: 'hideParameter', name: 'width' }]).edits.length, 0)
    const moved = planCustomizerEdits('/* [One] */\na=1;\nb=2;\n', [{ kind: 'moveGroup', name: 'a', group: 'Two' }])
    assert.deepEqual(parseCustomizer(moved.source).map((p) => p.group), ['Two', 'One'])
    const choices = planCustomizerEdits('s="a,b";\n', [{ kind: 'changeWidget', name: 's', widget: 'dropdown', choices: [{ value: 'a,b', label: 'A:B' }, { value: 'c' }] }])
    assert.equal(choices.validation.semanticPass, true)
    assert.match(planCustomizerEdits('width=40; // range: 10..100 step 5\n', [slider]).source, /\/\/ \[10:5:100\]/)
})
test('structured edits refuse ambiguous comments/expressions/multiple declarations and invalid contracts', () => {
    for (const source of ['width=40; // preserve this reason\n', 'width=20*2;\n', 'width=40;\nwidth=50;\n', 'width=40; height=20;\n']) assert.throws(() => planCustomizerEdits(source, [slider]))
    assert.throws(() => planCustomizerEdits('width=40;\nheight=20;\n', [{ ...slider, group: 'Dimensions' }]), /following parameters/)
    assert.throws(() => planCustomizerEdits('width=40;\n', [{ ...slider, description: 'Bad\nx=99;' }]), /Single-line/)
    assert.throws(() => planCustomizerEdits('width=40;\n', [{ ...slider, group: 'Bad */ x=99;' }]), /group/)
    assert.throws(() => planCustomizerEdits('width=40;\n', [{ ...slider, range: { min: 10, max: 100, step: 7 } }]), /contract/)
    assert.throws(() => planCustomizerEdits('width=40;\n', [{ kind: 'changeWidget', name: 'width', widget: 'checkbox' }]), /contract/)
})


test('literal insertion preserves BOM and is idempotent; multiline vectors keep geometry untouched', () => {
    const intent: SourceEditIntent = { kind: 'insertLiteralParameter', name: 'size', widget: 'vector', defaultValue: [20,30,40], group: 'Dimensions', range: { min: 0, max: 100, step: 5 } }
    const source = '\ufeffcube([1,2,3]);\r\n'
    const plan = planCustomizerEdits(source, [intent])
    assert.equal(plan.source[0], '\ufeff')
    assert.ok(plan.source.endsWith('cube([1,2,3]);\r\n'))
    assert.equal(planCustomizerEdits(plan.source, [intent]).edits.length, 0)
    const multi = 'size = [20,\r\n30, 40];\r\ncube(size);\r\n'
    const changed = planCustomizerEdits(multi, [{ ...intent, kind: 'annotateExisting' }])
    assert.ok(changed.source.endsWith('size = [20,\r\n30, 40]; // [0:5:100]\r\ncube(size);\r\n'))
})
