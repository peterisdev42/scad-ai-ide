import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

let browser, server, base
before(async () => {
    const root = fileURLToPath(new URL('../', import.meta.url))
    const bundle = await build({
        absWorkingDir: root, tsconfig: 'tsconfig.webview.json', bundle: true, write: false, format: 'esm',
        stdin: { contents: "import './src/features/preview/webview/components/aside/Parameters.ts'", resolveDir: root },
    })
    server = createServer((request, response) => {
        response.setHeader('Content-Type', request.url === '/fields.js' ? 'text/javascript' : 'text/html')
        response.end(request.url === '/fields.js' ? bundle.outputFiles[0].text : '<!doctype html><script type="module" src="/fields.js"></script>')
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${server.address().port}`
    browser = await chromium.launch({ headless: true, executablePath: process.env.SCAD_CHROMIUM_EXECUTABLE || undefined })
})
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)) })

test('Preview manual numeric entry rejects out of bounds without clamping and accepts off-grid input', async t => {
    const page = await browser.newPage()
    t.after(() => page.close())
    await page.goto(base)
    await page.evaluate(async () => {
        await customElements.whenDefined('scad-number-field')
        const field = document.createElement('scad-number-field')
        Object.assign(field, { value: 12, min: 0, max: 100, step: 5 })
        window.changes = []
        field.addEventListener('change', e => window.changes.push(e.detail.value))
        document.body.append(field)
    })
    const control = page.getByRole('spinbutton', { name: 'Value' })
    await control.focus()
    await control.press('ArrowUp')
    assert.deepEqual(await page.evaluate(() => window.changes), [17])
    await control.press('Enter')
    const input = page.locator('scad-number-field input')
    await input.fill('101')
    await input.press('Enter')
    assert.equal(await input.inputValue(), '101')
    assert.equal(await input.evaluate(el => el.validity.valid), false)
    assert.deepEqual(await page.evaluate(() => window.changes), [17])
    await input.fill('13')
    await input.press('Enter')
    assert.deepEqual(await page.evaluate(() => window.changes), [17, 13])
    await page.waitForFunction(() => !document.querySelector('scad-number-field').shadowRoot.querySelector('input'))
})

test('Preview handles literal regex punctuation in group names and preserves multiline textbox values', async t => {
    const page = await browser.newPage()
    t.after(() => page.close())
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base)
    await page.evaluate(async () => {
        await customElements.whenDefined('scad-parameters')
        const fields = document.createElement('scad-parameters')
        fields.parameterContext = {
            parameters: [{ name: 'label', type: 'string', value: 'first\nsecond', group: 'A(' }],
            overrides: {}, parameterSets: {}, override: (name, value) => { window.changed = { name, value } },
        }
        fields.modelContext = {}
        document.body.append(fields)
    })
    const field = page.getByRole('textbox', { name: 'label' })
    assert.equal(await field.inputValue(), 'first\nsecond')
    await field.fill('changed\nvalue')
    await field.blur()
    assert.deepEqual(await page.evaluate(() => window.changed), { name: 'label', value: 'changed\nvalue' })
    assert.deepEqual(errors, [])
})


test('Preview incomplete analysis is visible and makes stale controls inert', async t => {
    const page = await browser.newPage()
    t.after(() => page.close())
    await page.goto(base)
    await page.evaluate(async () => {
        await customElements.whenDefined('scad-parameters')
        const fields = document.createElement('scad-parameters')
        fields.parameterContext = { analysisComplete: false, parameters: [{ name: 'label', type: 'string', value: 'retained', group: '' }], overrides: {}, parameterSets: {} }
        fields.modelContext = {}
        document.body.append(fields)
    })
    await page.getByRole('status').waitFor()
    assert.match(await page.getByRole('status').textContent(), /Stored values are preserved/)
    assert.equal(await page.locator('scad-parameters .parameter-controls').evaluate(el => el.inert), true)
    assert.equal(await page.locator('scad-parameters textarea').evaluate(el => { el.focus(); return el.getRootNode().activeElement === el }), false, 'An inert control must refuse focus')
    const protocol = await page.context().newCDPSession(page)
    await protocol.send('Accessibility.enable')
    const tree = await protocol.send('Accessibility.getFullAXTree')
    assert.equal(tree.nodes.some(node => !node.ignored && node.role?.value === 'textbox'), false, 'Native Chromium accessibility tree must exclude inert controls')
    await protocol.detach()
    await page.evaluate(() => {
        const fields = document.querySelector('scad-parameters')
        fields.parameterContext = { ...fields.parameterContext, analysisComplete: true }
    })
    await page.getByRole('textbox', { name: 'label' }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'label' }).inputValue(), 'retained')
})
