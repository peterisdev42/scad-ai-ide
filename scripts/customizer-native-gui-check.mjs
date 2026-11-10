import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import assert from 'node:assert/strict'

// Requires a live synthetic process from customizer-native-gui.mjs. These are
// real Qt controls and real Preview echoes, not CLI substitutes or injected values.
const directory = process.argv[2]
assert.ok(directory, 'Supply the current /tmp/cgui-* fixture directory')
const live = JSON.parse(await readFile(path.join(directory, 'live.json'), 'utf8'))
const source = await readFile(live.file, 'utf8')
const helper = path.resolve('.build/customizer-native-control')
const run = (...args) => JSON.parse(execFileSync(helper, [String(live.pid), live.bundle, ...args], { encoding: 'utf8', timeout: 15000 }))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const read = () => run('dump')
const echo = nodes => nodes.filter(node => node.AXRole === 'AXTextArea' && String(node.AXValue).includes('ECHO:')).flatMap(node => node.AXValue.split('\n')).filter(line => line.startsWith('ECHO:')).at(-1)
const value = (nodes, name, role) => {
    const label = nodes.findIndex(node => node.AXRole === 'AXStaticText' && node.AXValue === name)
    assert.ok(label >= 0, `Missing native parameter ${name}`)
    return nodes.slice(label + 1).find(node => node.AXRole === role)?.AXValue
}
const records = []
let stage = 'initial'
try {
    let nodes = read()
    if (!nodes.some(node => node.AXRole === 'AXStaticText' && node.AXValue === 'width')) {
        run('dock', 'Customizer')
        nodes = read()
        run('press', nodes.find(node => node.AXRole === 'AXButton' && node.AXTitle === 'Preview').path)
        await pause(700)
    }
    nodes = read()
    if (!nodes.some(node => node.AXRole === 'AXTextArea' && node.AXValue === source)) run('dock', 'Editor')
    nodes = read()
    if (!echo(nodes)) run('dock', 'Console')
    await writeFile(path.join(directory, 'ax-initial.json'), JSON.stringify(read(), null, 2))
    const check = async (id, action, expected, inspect = () => {}) => {
        stage = id
        await action()
        await pause(200)
        const button = read().find(node => node.AXRole === 'AXButton' && node.AXTitle === 'Preview')
        assert.ok(button, 'Missing actual Preview action')
        run('press', button.path)
        const deadline = Date.now() + 8000
        let current, actual
        do {
            await pause(150)
            current = read()
            actual = echo(current)
            if (actual && expected.every(text => actual.includes(text))) break
        } while (Date.now() < deadline)
        await writeFile(path.join(directory, `verified-${id}.json`), JSON.stringify(current, null, 2))
        assert.ok(actual && expected.every(text => actual.includes(text)), `${id}: actual ${actual}; expected ${expected.join('; ')}`)
        inspect(current)
        assert.ok(current.some(node => node.AXRole === 'AXTextArea' && node.AXValue === source), 'Widget interaction must not modify editor source')
        assert.equal(await readFile(live.file, 'utf8'), source)
        records.push({ id, status: 'PASS', echo: actual })
        console.log(`PASS ${id}: ${actual}`)
    }
    const preset = async name => { run('preset', name); await pause(150) }
    await check('default-display', () => {}, ['width = 120', 'offgrid = 12', 'text = "abcdef"'], current => {
        assert.equal(value(current, 'offgrid', 'AXIncrementor'), '10')
        assert.equal(value(current, 'text', 'AXTextField'), 'abcd')
        assert.ok(current.some(node => node.AXRole === 'AXStaticText' && node.AXValue === 'Width in millimeters'))
        assert.ok(!current.some(node => node.AXRole === 'AXStaticText' && node.AXValue === 'internalOffset'))
    })
    await check('preset-A', () => preset('A'), ['width = 30', 'spin = 1.25', 'shape = "square"'])
    // ParameterObjects.importValues resets every omitted parameter. The actual
    // native echo and the approved IDE policy both use defaults+selected set.
    await check('preset-B', () => preset('B'), ['width = 120', 'spin = 2', 'shape = "round"'])
    await check('preset-default', () => preset('<design default>'), ['width = 120', 'spin = 1.25', 'shape = "round"'])
    await check('width-arrow', () => run('click', 'param|width|AXIncrementor', '0.98', '0.75'), ['width = 115'])
    await check('offgrid-keyboard', () => { run('focus', 'param|offgrid|AXSlider'); run('key', '124') }, ['offgrid = 15'])
    await check('spin-arrow', () => run('click', 'param|spin|AXIncrementor', '0.98', '0.25'), ['spin = 1.5'])
    await check('enum', () => run('choice', 'Square'), ['shape = "square"'])
    await check('text-ascii', () => { run('click', 'param|text|AXTextField', '0.5', '0.5'); run('type', 'param|text|AXTextField', '123456789'); run('key', '48') }, ['text = "1234"'])
    await check('text-utf16', () => { run('click', 'param|text|AXTextField', '0.5', '0.5'); run('type', 'param|text|AXTextField', 'Ω😀xy'); run('key', '48') }, ['text = "Ω😀x"'])
    await check('checkbox', () => run('click', 'param|checked|AXCheckBox', '0.5', '0.5'), ['checked = false'])
    await check('vector-arrow', () => run('click', 'param|vector|AXIncrementor', '0.98', '0.25'), ['vector = [1.5, 2, 3]'])
} catch (error) {
    let failedState, observedEcho
    try { failedState = read(); observedEcho = echo(failedState); await writeFile(path.join(directory, 'failed-native-state.json'), JSON.stringify(failedState, null, 2)) } catch { /* Preserve the original failure even if the process ended. */ }
    records.push({ id: stage, status: 'FAIL', error: error.message, observedEcho, sourceBufferUnchanged: failedState ? failedState.some(node => node.AXRole === 'AXTextArea' && node.AXValue === source) : null, sourceDiskUnchanged: await readFile(live.file, 'utf8') === source })
    console.error(error.message)
    process.exitCode = 1
} finally {
    await writeFile(path.join(directory, 'dynamic-checks.json'), JSON.stringify({ scope: 'Actual native Qt controls and runtime echo; not full pinned binary or IDE parity', records }, null, 2))
    await writeFile(path.join(directory, 'finish'), 'dynamic checks ended')
}
