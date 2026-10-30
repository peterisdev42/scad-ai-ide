import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const stl = Buffer.from('solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 20 0 0\nvertex 0 20 0\nendloop\nendfacet\nendsolid test\n').toString('base64')
let csg
let browser
before(async () => {
    const worker = new Worker(join(root, 'dist/csg-worker.mjs'))
    try {
        const result = await new Promise((resolve, reject) => {
            worker.once('message', resolve)
            worker.once('error', reject)
            worker.postMessage('cube(size=[20,20,20],center=true);')
        })
        if (result.error) throw new Error(result.error)
        csg = Buffer.from(JSON.stringify(result.scene)).toString('base64')
    } finally {
        await worker.terminate()
    }
    browser = await chromium.launch({ headless: true, executablePath: process.env.SCAD_CHROMIUM_EXECUTABLE || undefined })
})
after(async () => browser?.close())

async function fixture(t, mode = 'render') {
    const server = createServer((request, response) => {
        const path = new URL(request.url, 'http://fixture').pathname
        if (path === '/') {
            response.setHeader('Content-Type', 'text/html')
            response.end(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src data: blob:; connect-src 'self' data: blob:; worker-src blob:;"><link id="vscode-codicon-stylesheet" rel="stylesheet" href="/dist/codicons/codicon.css"><link rel="stylesheet" href="/theme.css"></head><body><div id="root"></div><script type="module" src="/dist/preview.js"></script></body></html>`)
        } else if (path === '/theme.css') {
            response.setHeader('Content-Type', 'text/css')
            response.end('body { margin:0; height:100vh; --vscode-editor-background:#1f1f1f; --vscode-foreground:#ccc; --vscode-panel-border:#444; --vscode-focusBorder:#0078d4; --vscode-font-family:sans-serif; --vscode-font-size:13px; color:#ccc; font-family:sans-serif; font-size:13px; } #root {height:100%;}')
        } else if (/^\/dist\/(preview\.js|codicons\/codicon\.(css|ttf))$/.test(path)) {
            response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'font/ttf')
            response.end(readFileSync(join(root, path)))
        } else {
            response.statusCode = 404
            response.end()
        }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(
        ({ mode, csg, stl }) => {
            window.hostMessages = []
            const send = (data) => window.dispatchEvent(new MessageEvent('message', { data }))
            const update = (mode) => send({ type: 'update', format: mode === 'preview' ? 'csg' : 'stl', content: mode === 'preview' ? csg : stl })
            window.acquireVsCodeApi = () => ({
                postMessage(message) {
                    window.hostMessages.push(message)
                    if (message.type === 'ready')
                        queueMicrotask(() => {
                            if (mode) send({ type: 'previewMode', mode })
                            send({ type: 'loadScene', snapshot: null })
                            update(mode)
                            send({ type: 'updateParameters', parameters: [{ name: 'width', group: 'Parameters', type: 'number', value: 20 }], overrides: {}, parameterSets: {} })
                        })
                    if (message.type === 'setPreviewMode')
                        queueMicrotask(() => {
                            send({ type: 'previewMode', mode: message.mode })
                            send({ type: 'loadingState', loading: true, message: 'Generating preview...' })
                            update(message.mode)
                        })
                },
            })
        },
        { mode, csg, stl },
    )
    t.after(async () => {
        await page.close()
        await new Promise((resolve) => server.close(resolve))
        assert.deepEqual(errors, [])
    })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.locator('scad-app').waitFor()
    return page
}

test('CSG switching keeps the interactive Stage and camera, with mode controls immediately after projection', async (t) => {
    const page = await fixture(t)
    await page.locator('scad-preview canvas.main-canvas').waitFor()
    await page.waitForFunction(() => document.querySelector('scad-app').shadowRoot.querySelector('scad-preview')?.stage?.serializeProperties().size > 0)
    const canvas = await page.locator('scad-preview canvas.main-canvas').boundingBox()
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(canvas.x + canvas.width / 2 + 40, canvas.y + canvas.height / 2 + 20)
    await page.mouse.up({ button: 'middle' })
    const camera = await page.locator('scad-preview').evaluate((preview) => {
        window.originalStage = preview.stage
        return preview.stage.serializeProperties().get('camera-default')
    })
    const projection = await page.getByRole('switch', { name: 'Orthographic', exact: true }).boundingBox()
    const mode = await page.getByRole('switch', { name: 'CSG preview', exact: true }).boundingBox()
    assert.ok(mode.x > projection.x && Math.abs(mode.y - projection.y) < 1)
    assert.equal(await page.locator('.preview-mode-bar').count(), 0)
    await page.getByRole('switch', { name: 'Full mesh render', exact: true }).click()
    assert.equal(await page.getByRole('switch', { name: 'Full mesh render', exact: true }).getAttribute('aria-checked'), 'true')
    for (let turn = 0; turn < 2; turn++) {
        for (const [name, format] of [
            ['CSG preview', 'csg'],
            ['Full mesh render', 'stl'],
        ]) {
            await page.getByRole('switch', { name, exact: true }).click()
            await page.waitForFunction((format) => document.querySelector('scad-app').modelContext.format === format, format)
            assert.equal(await page.getByRole('switch', { name, exact: true }).getAttribute('aria-checked'), 'true')
            assert.equal(await page.locator('scad-preview canvas.main-canvas').count(), 1)
            assert.equal(await page.locator('scad-preview').evaluate((preview) => preview.stage === window.originalStage), true)
            assert.deepEqual(await page.locator('scad-preview').evaluate((preview) => preview.stage.serializeProperties().get('camera-default')), camera)
        }
    }
    assert.equal(await page.evaluate(() => window.hostMessages.filter((message) => message.type === 'setPreviewMode').length), 5)
})

test('initial CSG preview supports parameters, mesh exports and output through the top toolbar', async (t) => {
    const page = await fixture(t, 'preview')
    await page.locator('scad-preview canvas.main-canvas').waitFor()
    assert.equal(await page.getByRole('switch', { name: 'CSG preview', exact: true }).getAttribute('aria-checked'), 'true')
    await page.getByRole('switch', { name: 'Toggle Parameters', exact: true }).click()
    await page.locator('scad-parameters').waitFor()
    await page.locator('scad-parameters scad-number-field').click()
    await page.locator('scad-parameters input[type="number"]').fill('30')
    await page.locator('scad-parameters input[type="number"]').press('Enter')
    await page.waitForFunction(() => window.hostMessages.some((message) => message.type === 'parameterChanged' && message.name === 'width' && message.value === 30))
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await page.getByRole('button', { name: 'Print', exact: true }).click()
    assert.equal(await page.evaluate(() => window.hostMessages.some((message) => message.type === 'exportModel')), true)
    assert.equal(await page.evaluate(() => window.hostMessages.some((message) => message.type === 'sendToSlicer')), true)
    await page.getByRole('switch', { name: 'Toggle Parameters', exact: true }).click()
    await page.getByRole('switch', { name: 'Toggle Output', exact: true }).click()
    await page.locator('scad-output').waitFor()
    assert.equal(await page.locator('scad-preview canvas.main-canvas').count(), 1)
})

test('native mesh previews keep their interactive viewer without SCAD mode controls', async (t) => {
    const page = await fixture(t, null)
    await page.locator('scad-preview canvas.main-canvas').waitFor()
    assert.equal(await page.getByRole('switch', { name: 'CSG preview', exact: true }).count(), 0)
})

test('loading and mode notifications keep the existing GPU model until new geometry arrives', async (t) => {
    const page = await fixture(t, 'preview')
    await page.locator('scad-preview canvas.main-canvas').waitFor()
    await page.waitForFunction(() => document.querySelector('scad-app').shadowRoot.querySelector('scad-preview')?.stage?.modelGroup.children.length > 0)
    await page.locator('scad-preview').evaluate((preview) => {
        window.initialGeometry = preview.stage.modelGroup.children[0].geometry
        window.geometryDisposed = false
        window.initialGeometry.addEventListener('dispose', () => {
            window.geometryDisposed = true
        })
    })
    await page.evaluate(() => {
        for (let i = 0; i < 8; i++) window.dispatchEvent(new MessageEvent('message', { data: { type: 'loadingState', loading: true, message: 'Updating parameters...' } }))
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'previewMode', mode: 'preview' } }))
    })
    await page.locator('scad-app').evaluate((app) => app.updateComplete)
    assert.equal(await page.locator('scad-preview').evaluate((preview) => preview.stage.modelGroup.children[0].geometry === window.initialGeometry), true)
    assert.equal(await page.evaluate(() => window.geometryDisposed), false)
    await page.evaluate((content) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'update', format: 'stl', content } })), stl)
    await page.waitForFunction(() => window.geometryDisposed)
    assert.equal(await page.locator('scad-preview').evaluate((preview) => preview.stage.modelGroup.children[0].geometry === window.initialGeometry), false)
})

test('the actual backend, fallback reason and elapsed evaluation time remain visible', async (t) => {
    const page = await fixture(t, 'preview')
    await page.locator('scad-preview canvas.main-canvas').waitFor()
    const send = async (backend) => page.evaluate((backend) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'previewBackend', backend } })), backend)
    await send({ kind: 'csg', elapsedMs: 87 })
    await page.getByText('CSG / Manifold mesh', { exact: true }).waitFor()
    assert.match(await page.locator('scad-backend-status .status').innerText(), /87 ms/)
    assert.match(await page.locator('scad-backend-status .status').innerText(), /drag updates enabled/)
    await send({ kind: 'fallback', reason: 'non-triangular polyhedron face', elapsedMs: 1240 })
    await page.getByText('CSG → STL fallback', { exact: true }).waitFor()
    assert.match(await page.locator('scad-backend-status .status').innerText(), /non-triangular polyhedron face/)
    assert.match(await page.locator('scad-backend-status .status').innerText(), /1240 ms/)
    assert.match(await page.locator('scad-backend-status .status').innerText(), /Release slider to update/)
    await page.screenshot({ path: '/private/tmp/scad-backend-status.png' })
    await send({ kind: 'mesh', elapsedMs: 560 })
    await page.getByText('CLI mesh render', { exact: true }).waitFor()
    assert.doesNotMatch(await page.locator('scad-backend-status .status').innerText(), /non-triangular/)
})
