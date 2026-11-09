import assert from 'node:assert/strict'
import test from 'node:test'
import { ScadParser } from '../../features/preview/extension/services/ScadParser'
import { ScadParameters } from '../../features/preview/extension/core/ScadParameters'
import { CustomizerService } from '../../core/customizer/CustomizerService'

const source = `/* [Size] */
width = 4; // [0:2:20]
label = "a"; // [a:Alpha, b:Beta]
visible = true;
computed = width * 2;
/* [Hidden] */
internal = 99;
cube(computed);
`

test('preview adapts the IDE parser without overriding expressions or hidden values', () => {
    const parser = new ScadParser(source)
    assert.deepEqual(
        parser.parameters.map((parameter) => parameter.name),
        ['width', 'label', 'visible'],
    )
    assert.deepEqual(parser.parameters[0], { name: 'width', group: 'Size', description: '', type: 'number', value: 4, min: 0, max: 20, step: 2, options: undefined })
    const parameters = new ScadParameters()
    parameters.updateDefinitions(parser.parameters)
    assert.deepEqual(parameters.getOverrides(), {})
    parameters.updateValue('width', 8)
    parameters.updateValue('label', 'b')
    assert.deepEqual(parameters.getOverrides(), { width: 8, label: 'b' })
    parameters.updateValue('width', 7)
    parameters.updateValue('label', 'unlisted')
    assert.deepEqual(parameters.getOverrides(), { width: 7, label: 'b' }, 'Native accepts off-grid numeric values')
    parameters.updateDefinitions(new ScadParser('width = true;').parameters)
    assert.deepEqual(parameters.getOverrides(), {})
})

test('Preview mirrors host preset identity without independently applying or clearing overrides', () => {
    const parameters = new ScadParameters()
    parameters.updateDefinitions(new ScadParser(source).parameters)
    parameters.replaceOverrides({ width: 12 })
    parameters.syncPresetState({ Wide: { width: '12', label: 'b', visible: 'false' }, Invalid: { width: 'NaN' } }, 'Wide')
    assert.deepEqual(parameters.getOverrides(), { width: 12 })
    assert.equal(parameters.getActiveSetName(), 'Wide')
    assert.deepEqual(parameters.getParameterSets().Invalid, { width: 'NaN' }, 'Raw metadata is retained; only the host domain can validate and apply it')
    parameters.syncPresetState({}, undefined)
    assert.equal(parameters.getActiveSetName(), undefined)
    assert.deepEqual(parameters.getOverrides(), { width: 12 }, 'Preset metadata alone cannot change model values')
    parameters.replaceOverrides({ width: Infinity, computed: 2, label: 'b' })
    assert.deepEqual(parameters.getOverrides(), { label: 'b' })
    parameters.replaceOverrides({})
    assert.deepEqual(parameters.getOverrides(), {})
})

test('shared customizer notifies both editors and isolates file overrides and subscriptions', () => {
    const service = new CustomizerService()
    const changes: string[] = []
    const subscription = service.onDidChangeValues((target) => changes.push(target))
    service.load('first', source)
    service.set('width', 8)
    service.replaceOverrides('second', { width: 16 })
    assert.deepEqual(service.getArguments(), ['-D', 'width=8'])
    service.load('second', source)
    assert.deepEqual(service.getArguments(), ['-D', 'width=16'])
    assert.deepEqual(changes, ['first', 'second'])
    subscription.dispose()
    service.set('width', 10)
    assert.deepEqual(changes, ['first', 'second'])
    assert.deepEqual(service.getOverrides('first'), { width: 8 })
})

test('vectors and text limits survive preview synchronization and definition changes', () => {
    const parameters = new ScadParameters()
    parameters.updateDefinitions(new ScadParser('size = [2, 4]; // [0:2:10]\nname = "abc"; // 4').parameters)
    parameters.updateValue('size', [4, 8])
    parameters.updateValue('name', 'test')
    assert.deepEqual(parameters.getOverrides(), { size: [4,8], name: 'test' })
    parameters.updateValue('size', [4, 7])
    parameters.updateValue('name', 'too long')
    assert.deepEqual(parameters.getOverrides(), { size: [4, 7], name: 'test' })
    parameters.replaceOverrides({ size: [8, 10] })
    parameters.updateDefinitions(new ScadParser('size = [2,4,6];').parameters)
    assert.deepEqual(parameters.getOverrides(), {})
})


test('Preview projection uses effective bounds and keeps source defaults unchanged', () => {
    const parser = new ScadParser('w=120; // [0:5:100]\nv=[-5,120]; // [0:10]\n')
    assert.equal(parser.parameters[0].type, 'number')
    assert.equal((parser.parameters[0] as { max: number }).max, 120)
    assert.equal((parser.parameters[1] as { min: number }).min, -5)
    const parameters = new ScadParameters()
    parameters.updateDefinitions(parser.parameters)
    parameters.replaceOverrides({ w: 119, v: [-4,119] })
    assert.deepEqual(parameters.getOverrides(), { w: 119, v: [-4,119] })
    assert.equal(parser.parameters[0].value, 120)
    assert.deepEqual(parser.parameters[1].value, [-5,120])
})
