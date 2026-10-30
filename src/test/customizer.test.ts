import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCustomizer, numericStep } from '../core/customizer/CustomizerParser'
import { encodePresetValue, parsePresetFile, presetOverrides } from '../core/customizer/CustomizerPresets'
import { CustomizerService, validateValue } from '../core/customizer/CustomizerService'
import { RuntimeManager } from '../core/runtime/RuntimeManager'

const source = `/* [Geometry] */
// Model width
width = 40; // [10:5:100]
height = 20; // [0:100]
wall = 2.5;
/* [Options] */
hollow = true;
shape = "round"; // [round:Round, square:Square]
label = "https://example.com/{hello}";
/* [Hidden] */
secret = 12;
/* [More] */
choice = 1; // [1:Small, 2:Large]
ignored = width * 2;
module model() { local = 1; }
after = 7;
`

test('parses scalar parameters, groups, descriptions, ranges and enum labels without evaluating code', () => {
    const parameters = parseCustomizer(source)
    assert.deepEqual(
        parameters.map((parameter) => parameter.name),
        ['width', 'height', 'wall', 'hollow', 'shape', 'label', 'choice'],
    )
    assert.equal(parameters[0].description, 'Model width')
    assert.deepEqual(parameters[0].range, { min: 10, max: 100, step: 5 })
    assert.deepEqual(parameters[1].range, { min: 0, max: 100, step: undefined })
    assert.equal(parameters[3].group, 'Options')
    assert.deepEqual(parameters[4].choices, [
        { label: 'Round', value: 'round' },
        { label: 'Square', value: 'square' },
    ])
    assert.equal(parameters[5].defaultValue, 'https://example.com/{hello}')
    assert.deepEqual(parameters[6].choices, [
        { label: 'Small', value: 1 },
        { label: 'Large', value: 2 },
    ])
})

test('comments and quoted delimiters do not create parameters or corrupt annotations', () => {
    const parameters = parseCustomizer('/*\n fake = 2;\n*/\ntext = "a; \\\"quoted\\\" // b";\noption = "a,b"; // ["a,b":"Comma", "c:d":"Colon"]\ncount = -1.2e2;\n')
    assert.deepEqual(
        parameters.map((parameter) => parameter.name),
        ['text', 'option', 'count'],
    )
    assert.equal(parameters[0].defaultValue, 'a; "quoted" // b')
    assert.deepEqual(parameters[1].choices, [
        { label: 'Comma', value: 'a,b' },
        { label: 'Colon', value: 'c:d' },
    ])
    assert.equal(parameters[2].defaultValue, -120)
})

test('validates finite numbers, types, ranges, steps and enum values', () => {
    const [width, , , , shape] = parseCustomizer(source)
    assert.equal(validateValue(width, 45), undefined)
    assert.match(validateValue(width, 41)!, /steps/)
    assert.match(validateValue(width, 105)!, /between/)
    assert.match(validateValue(width, NaN)!, /finite/)
    assert.match(validateValue(width, '45')!, /type/)
    assert.match(validateValue(shape, 'triangle')!, /listed/)
})

test('overrides are per file, use CLI argument arrays, reset to defaults and preserve source', () => {
    const service = new CustomizerService()
    service.load('a.scad', source)
    service.set('width', 45)
    service.set('hollow', false)
    service.set('label', 'a"; echo("injected"); //')
    assert.deepEqual(service.getArguments(), ['-D', 'width=45', '-D', 'hollow=false', '-D', 'label="a\\"; echo(\\"injected\\"); //"'])
    assert.equal(service.parameters[0].defaultValue, 40)
    service.load('b.scad', source)
    assert.deepEqual(service.getArguments(), [])
    service.load('a.scad', source)
    assert.equal(service.value(service.parameters[0]), 45)
    service.set('width', 40)
    assert.ok(!service.getArguments().includes('width=45'))
    service.load('a.scad', 'width = 40; // [50:100]\n')
    assert.deepEqual(service.getArguments(), [])
    service.clear()
    assert.equal(service.target, undefined)
    assert.deepEqual(service.getArguments(), [])
})

test('runtime manager selects a valid result and respects invalid explicit overrides', async () => {
    const runtime = { id: 'test', source: 'PATH' as const, command: { executable: '/bin/openscad', argsPrefix: [] }, version: '2021.01', platform: 'linux' as const, status: 'available' as const }
    const manager = new RuntimeManager(async (options) => ({ runtimes: [runtime], diagnostics: [], configuredError: options.configuredPath ? 'missing' : undefined }))
    await manager.refresh({})
    assert.equal(manager.active, runtime)
    await manager.refresh({ configuredPath: '/missing' })
    assert.equal(manager.active, undefined)
    assert.equal(manager.result.runtimes.length, 1)
})

test('official widget hints cover max-only sliders, steps, text lengths and all vector sizes', () => {
    const parameters = parseCustomizer(`max = 34; // [50]
range = 34; // [10:100]
stepped = 20; // [0:5:100]
spin = 5.5; // .5
text = "hello"; // 8
v1 = [12]; // [0:2:50]
v2 = [12, 34]; // [0:50]
v3 = [-20, 6, 30]; // [-30:2:60]
v4 = [12, 34, 46, 24]; // [0:2:50]
vectorStep = [1, 2]; // .1
v5 = [1, 2, 3, 4, 5];
empty = [];
mixed = [1, true];
computed = [1, 2 * 3];`)
    assert.equal(parameters.length, 10)
    assert.deepEqual(parameters[0].range, { min: 0, max: 50, step: undefined })
    assert.equal(parameters[0].choices, undefined)
    assert.equal(parameters[3].step, 0.5)
    assert.equal(parameters[4].maxLength, 8)
    assert.deepEqual(
        parameters.slice(5, 9).map((parameter) => parameter.defaultValue),
        [[12], [12, 34], [-20, 6, 30], [12, 34, 46, 24]],
    )
    assert.deepEqual(parameters[7].range, { min: -30, max: 60, step: 2 })
    assert.equal(parameters[9].step, 0.1)
})

test('scanner supports multiline literals, multiple statements and library directives without evaluating code', () => {
    const parameters = parseCustomizer(`include <library/{parts}.scad>
use <functions.scad>;
// Model dimensions
// X, Y and Z in millimeters
size = [
  10,
  20,
  30
]; // [0:5:100]
a = 1; b = "// not a comment { ;";
function helper(x) = x * 2;
module helper2() echo("{}");
after_definition = true;
if (true) local = 9;
cube(1);
after_geometry = 2;
module stop() {
after_brace = 5;
}`)
    assert.deepEqual(
        parameters.map((parameter) => parameter.name),
        ['size', 'a', 'b', 'after_definition', 'after_geometry'],
    )
    assert.equal(parameters[0].description, 'Model dimensions\nX, Y and Z in millimeters')
    assert.deepEqual(parameters[0].range, { min: 0, max: 100, step: 5 })
})

test('groups, Hidden, Global, block descriptions and malformed hints stay isolated', () => {
    const parameters = parseCustomizer(`/* [Global] */
// Units for all sections
units = "mm"; // [mm:Millimeters, in:Inches]
/* [Hidden] */
secret = 10;
/* [Visible] */
/**
 * The visible count.
 * A second line with <html> & quotes.
 */
count = 3; // [0:0:10]
/* [Hidden] */
more = 2;
/* [Again] */
choice = "a:b"; // ["a:b":"Label, with colon: yes", c:Other]
invalid = 1; // [0:1e999]
number = 2; // -1
`)
    assert.deepEqual(
        parameters.map((parameter) => parameter.name),
        ['units', 'count', 'choice', 'invalid', 'number'],
    )
    assert.equal(parameters[0].group, 'Global')
    assert.match(parameters[1].description, /The visible count\.\nA second line/)
    assert.equal(parameters[1].range, undefined)
    assert.deepEqual(parameters[2].choices, [
        { label: 'Label, with colon: yes', value: 'a:b' },
        { label: 'Other', value: 'c' },
    ])
    assert.equal(parameters[3].choices, undefined)
    assert.equal(parameters[4].step, undefined)
})

test('vectors and text constraints validate at the host boundary and reset without changing source', () => {
    const service = new CustomizerService()
    const changes: string[] = []
    service.onDidChangeValues((target) => changes.push(target))
    service.load('vector.scad', 'size = [2, 4]; // [0:2:10]\nlabel = "abc"; // 4')
    const [size, label] = service.parameters
    for (const bad of [[2], [2, 4, 6], [2, NaN], [2, Infinity], [2, '4'], null, {}, '2,4']) {
        assert.ok(validateValue(size, bad))
    }
    assert.match(validateValue(size, [2, 3])!, /steps/)
    assert.match(validateValue(size, [2, 12])!, /between/)
    assert.equal(validateValue(size, [4, 6]), undefined)
    assert.match(validateValue(label, 'abcde')!, /4 characters/)
    service.set('size', [4, 6])
    assert.deepEqual(service.getArguments(), ['-D', 'size=[4,6]'])
    service.set('size', [2, 4])
    assert.deepEqual(service.getOverrides('vector.scad'), {})
    service.set('size', [6, 8])
    service.set('label', 'd')
    service.reset('size')
    assert.deepEqual(service.getOverrides('vector.scad'), { label: 'd' })
    service.reset()
    assert.deepEqual(service.getArguments(), [])
    assert.equal(changes.length, 6)
})

test('OpenSCAD string escapes, hex numbers and trailing vector commas preserve literal values', () => {
    const parameters = parseCustomizer(String.raw`label = "\u03a9 \U01F600\n\t\"\\";
hex = 0x20;
negative = -0x10;
vector = [0x10, -2.5,];
`)
    assert.equal(parameters[0].defaultValue, 'Ω 😀\n\t"\\')
    assert.equal(parameters[1].defaultValue, 32)
    assert.equal(parameters[2].defaultValue, -16)
    assert.deepEqual(parameters[3].defaultValue, [16, -2.5])
})

test('decimal controls infer precision and preserve explicit steps', () => {
    const parameters = parseCustomizer('fraction=0.5; // [0:1]\nsmall=0.3; // [0.1:0.9]\ntiny=1e-7;\nvector=[0.5, 0.25];\nexplicit=0.5; // [0:0.05:1]')
    assert.deepEqual(parameters.map(numericStep), [0.1, 0.1, 1e-7, 0.01, 0.05])
})

test('later assignments invalidate obsolete controls, including Hidden and assignments after geometry', () => {
    for (const source of ['x=1;\nx=2+3;', 'x=1;\n/* [Hidden] */\nx=2;', 'x=1;\nmodule part() { local=2; }\nx=3;']) {
        assert.deepEqual(parseCustomizer(source), [])
    }
    assert.deepEqual(
        parseCustomizer('x=1;\nmodule part() { x=2; }').map((p) => p.name),
        ['x'],
    )
})

test('compound headings, Unicode identifiers, mixed enums and unlisted defaults remain editable', () => {
    const [parameter, extra] = parseCustomizer('/* [Tab] [Name] */\n模式="auto"; // [auto:Automatic,1:One,2:Two]\nextra=3; // [1,2]')
    assert.equal(parameter.group, 'Tab-Name')
    assert.equal(parameter.name, '模式')
    assert.deepEqual(
        parameter.choices?.map((choice) => choice.value),
        ['auto', 1, 2],
    )
    assert.equal(validateValue(parameter, 2), undefined)
    assert.equal(validateValue(parameter, 'auto'), undefined)
    assert.ok(validateValue(parameter, 'invalid'))
    assert.deepEqual(
        extra.choices?.map((choice) => choice.value),
        [3, 1, 2],
    )
    assert.equal(validateValue(extra, 3), undefined)
})

test('OpenSCAD preset files round-trip every widget, mixed enums and hidden metadata', () => {
    const parameters = parseCustomizer('width=0.5; // [0:0.1:1]\nlabel="hello";\nvisible=true;\nsize=[1,2];\nmode="auto"; // [auto,1,2]')
    const file = parsePresetFile(JSON.stringify({ fileFormatVersion: '1', metadata: 'preserve', parameterSets: { Small: { width: '0.7', label: 'quoted "text"', visible: 'false', size: '[3,4]', mode: '2', internal: '42' } } }))
    assert.equal(file.metadata, 'preserve')
    const values = presetOverrides(parameters, file.parameterSets.Small)
    assert.deepEqual(values, { width: 0.7, label: 'quoted "text"', visible: false, size: [3, 4], mode: 2 })
    assert.deepEqual(Object.fromEntries(Object.entries(values).map(([name, value]) => [name, encodePresetValue(value)])), { width: '0.7', label: 'quoted "text"', visible: 'false', size: '[3,4]', mode: '2' })
    assert.deepEqual(presetOverrides(parameters, { internal: '42' }), {})
    assert.throws(() => presetOverrides(parameters, { width: '0.71', visible: 'false' }), /width:.*steps/)
    for (const value of ['null', '[]', '{}', '{"parameterSets":[]}', '{"fileFormatVersion":"2","parameterSets":{}}', '{"parameterSets":{"Bad":{"width":2}}}']) {
        assert.throws(() => parsePresetFile(value))
    }
})

test('preset changes notify their target even when selecting the same values again', () => {
    const service = new CustomizerService()
    const changes: [string, string][] = []
    const subscription = service.onDidChangeValues((target, reason) => changes.push([target, reason]))
    service.load('first', 'x=1;')
    service.set('x', 2)
    service.replaceOverrides('first', { x: 3 }, 'preset')
    service.replaceOverrides('first', { x: 3 }, 'preset')
    service.reset(undefined, 'preset')
    subscription.dispose()
    service.set('x', 4)
    assert.deepEqual(changes, [
        ['first', 'values'],
        ['first', 'preset'],
        ['first', 'preset'],
        ['first', 'preset'],
    ])
})
