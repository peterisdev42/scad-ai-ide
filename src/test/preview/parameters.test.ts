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
    assert.deepEqual(parameters.getOverrides(), { width: 8, label: 'b' })
    parameters.updateDefinitions(new ScadParser('width = true;').parameters)
    assert.deepEqual(parameters.getOverrides(), {})
})

test('presets retain explicit values, reject invalid numbers, and reset overrides', () => {
    const parameters = new ScadParameters()
    parameters.updateDefinitions(new ScadParser(source).parameters)
    parameters.updateParameterSets({ Wide: { width: '12', label: 'b', visible: 'false' }, Invalid: { width: 'NaN' } })
    parameters.setActiveSet('Wide')
    assert.deepEqual(parameters.getOverrides(), { width: 12, label: 'b', visible: false })
    assert.deepEqual(parameters.calculateActiveSetPartial(), { width: '12', label: 'b', visible: 'false' })
    parameters.setActiveSet('Invalid')
    assert.deepEqual(parameters.getOverrides(), {})
    parameters.replaceOverrides({ width: Infinity, computed: 2, label: 'b' })
    assert.deepEqual(parameters.getOverrides(), { label: 'b' })
    parameters.setActiveSet(undefined)
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

test('vectors and text limits survive preview synchronization, presets and definition changes', () => {
    const parameters = new ScadParameters()
    parameters.updateDefinitions(new ScadParser('size = [2, 4]; // [0:2:10]\nname = "abc"; // 4').parameters)
    parameters.updateValue('size', [4, 8])
    parameters.updateValue('name', 'test')
    assert.deepEqual(parameters.calculateActiveSetPartial(), { size: '[4,8]', name: 'test' })
    parameters.updateValue('size', [4, 7])
    parameters.updateValue('name', 'too long')
    assert.deepEqual(parameters.getOverrides(), { size: [4, 8], name: 'test' })
    parameters.updateParameterSets({ Good: { size: '[6,10]', name: 'okay' }, Bad: { size: '[6, "10"]' } })
    parameters.setActiveSet('Good')
    assert.deepEqual(parameters.getOverrides(), { size: [6, 10], name: 'okay' })
    parameters.setActiveSet('Bad')
    assert.deepEqual(parameters.getOverrides(), {})
    parameters.replaceOverrides({ size: [8, 10] })
    parameters.updateDefinitions(new ScadParser('size = [2,4,6];').parameters)
    assert.deepEqual(parameters.getOverrides(), {})
})
