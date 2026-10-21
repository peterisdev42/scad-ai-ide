import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCustomizer } from '../core/customizer/CustomizerParser'
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
