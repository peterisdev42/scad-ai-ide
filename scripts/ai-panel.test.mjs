import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const root = new URL('../', import.meta.url)
const catalog = JSON.parse(await readFile(new URL('src/core/capabilities/catalog.json', root)))
const resources = JSON.parse(await readFile(new URL('src/core/capabilities/resources.json', root)))
const snapshot = { total: catalog.length, resources, capabilities: catalog.map((entry) => ({ ...entry, availability: { enabled: !entry.id.startsWith('development.') || entry.id === 'development.status', reasonCode: entry.id.startsWith('development.') && entry.id !== 'development.status' ? 'DEVELOPMENT_ONLY' : undefined } })) }

test('AI Panel categorizes every catalog tool and awareness resource, buffers early state, escapes content and reflects permissions', async () => {
    const browser = await chromium.launch({ channel: process.env.SCAD_BROWSER_CHANNEL || undefined })
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 960 } })
        const errors = []
        page.on('pageerror', (error) => errors.push(error.message))
        const html = (await readFile(new URL('media/panels/index.html', root), 'utf8')).replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, '').replace(/<script[^>]*><\/script>/g, '').replace(/<link[^>]+>/g, '').replaceAll('{{title}}', 'AI').replaceAll('{{page}}', 'ai')
        await page.setContent(html)
        await page.evaluate(() => {
            window.actions = []
            window.acquireVsCodeApi = () => ({ getState: () => ({}), setState() {}, postMessage: (action) => window.actions.push(action) })
        })
        await page.addStyleTag({ content: ':root { --vscode-font-family: system-ui; --vscode-font-size: 13px; --vscode-font-weight: 400; --vscode-foreground: #ccc; --vscode-editor-background: #1f1f1f; --vscode-editorWidget-background:#252526; --vscode-descriptionForeground:#aaa; --vscode-panel-border:#444; --vscode-focusBorder:#007fd4; --vscode-textCodeBlock-background:#333; }' })
        await page.addStyleTag({ path: new URL('media/panels/main.css', root).pathname })
        await page.addScriptTag({ path: new URL('media/panels/main.js', root).pathname })
        await page.evaluate((state) => window.postMessage({ type: 'aiCapabilities', state }, '*'), snapshot)
        await page.addScriptTag({ path: new URL('media/panels/ai.js', root).pathname })
        assert.equal(await page.locator('#placeholder').isVisible(), false)
        assert.equal(await page.locator('#ai-capability-groups table').count(), 6)
        assert.equal(await page.locator('[data-capability-id]').count(), catalog.length)
        assert.deepEqual((await page.locator('[data-capability-id]').evaluateAll((rows) => rows.map((row) => row.dataset.capabilityId))).sort(), catalog.map((entry) => entry.id).sort())
        for (const entry of catalog) assert.equal(await page.locator(`[data-capability-id="${entry.id}"] code`).textContent(), entry.toolName)
        assert.equal(await page.locator('#ai-resources tbody tr').count(), 5)
        assert.match(await page.locator('[data-capability-id="development.clearCaches"]').textContent(), /Restricted.*Development mode required/)
        assert.match(await page.locator('[data-capability-id="runtime.remove"]').textContent(), /Human confirmation/)
        await page.getByRole('button', { name: 'Refresh availability' }).click()
        assert.equal(await page.evaluate(() => window.actions.at(-1).action), 'refreshAiCapabilities')
        const changed = structuredClone(snapshot)
        changed.capabilities[0].description = '<img src=x onerror=alert(1)>'
        changed.capabilities.find((entry) => entry.id === 'runtime.select').availability = { enabled: false, reasonCode: 'BUSY' }
        await page.evaluate((state) => window.postMessage({ type: 'aiCapabilities', state }, '*'), changed)
        await page.getByText('Operation in progress', { exact: true }).waitFor()
        assert.equal(await page.locator('#ai img').count(), 0)
        assert.match(await page.locator('[data-capability-id="capabilities.discover"]').textContent(), /<img src=x/)
        await page.evaluate((state) => window.postMessage({ type: 'aiCapabilities', state }, '*'), snapshot)
        await mkdir(new URL('.build/', root), { recursive: true })
        await page.screenshot({ path: new URL('.build/ai-capabilities-panel.png', root).pathname })
        await page.setViewportSize({ width: 360, height: 780 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        assert.equal(await page.locator('[data-capability-id]').count(), 37)
        assert.ok(await page.locator('.ai-table-scroll').first().evaluate((node) => node.scrollWidth > node.clientWidth))
        assert.deepEqual(errors, [])
    } finally { await browser.close() }
})
