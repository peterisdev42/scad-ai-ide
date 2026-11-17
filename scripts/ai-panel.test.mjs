import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const root = new URL('../', import.meta.url)
const catalog = JSON.parse(await readFile(new URL('src/core/capabilities/catalog.json', root)))
const manifest = JSON.parse(await readFile(new URL('package.json', root)))
const resources = JSON.parse(await readFile(new URL('src/core/capabilities/resources.json', root)))
const snapshot = { total: catalog.length, resources, preferences: { agentEnabled: true, guidanceEnabled: true, sourceDiagnostics: true, diagnosticsOnSave: false }, capabilities: catalog.map((entry) => ({ ...entry, availability: { enabled: !entry.id.startsWith('development.') || entry.id === 'development.status', reasonCode: entry.id.startsWith('development.') && entry.id !== 'development.status' ? 'DEVELOPMENT_ONLY' : undefined } })) }

test('Generated native Agent contributions honor the two opt-out context keys', () => {
    const contribution = manifest.contributes
    assert.equal(contribution.languageModelTools.length, catalog.length)
    assert.ok(contribution.languageModelTools.every(tool => tool.when === 'scadAiAgentEnabled'))
    assert.ok([...contribution.chatSkills, ...contribution.chatInstructions].every(resource => resource.when === 'scadAiAgentEnabled && scadAiGuidanceEnabled'))
    assert.equal(contribution.configuration.properties['scad-ai-ide.agent.enabled'].default, true)
    assert.equal(contribution.configuration.properties['scad-ai-ide.agent.guidanceEnabled'].default, true)
})

test('AI Panel presents useful capability summaries, editable preferences and collapsible technical details', async () => {
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
        assert.equal(await page.locator('.ai-overview-card').count(), 4)
        assert.equal(await page.locator('#ai-tool-details').evaluate(node => node.open), false)
        assert.equal(await page.locator('#ai-resource-details').evaluate(node => node.open), false)
        assert.equal(await page.locator('#ai-skill-count').textContent(), String(resources.filter(r => r.kind === 'Skill').length))
        assert.equal(await page.locator('#ai-agent-enabled').isChecked(), true)
        assert.equal(await page.locator('#ai-diagnostics-on-save').isChecked(), false)
        await page.locator('#ai-tool-details > summary').click()
        await page.locator('#ai-resource-details > summary').click()
        assert.equal(await page.locator('#ai-capability-groups table').count(), 7)
        assert.equal(await page.locator('[data-capability-id]').count(), catalog.length)
        assert.deepEqual((await page.locator('[data-capability-id]').evaluateAll((rows) => rows.map((row) => row.dataset.capabilityId))).sort(), catalog.map((entry) => entry.id).sort())
        for (const entry of catalog) assert.equal(await page.locator(`[data-capability-id="${entry.id}"] code`).textContent(), entry.toolName)
        assert.equal(await page.locator('#ai-resources tbody tr').count(), resources.length)
        assert.match(await page.locator('[data-capability-id="cad.modelAnalyze"]').textContent(), /scad_ai_ide_model_analyze/)
        assert.match(await page.locator('[data-capability-id="cad.issueDetails"]').textContent(), /scad_ai_ide_model_getIssue/)
        assert.match(await page.locator('[data-capability-id="development.clearCaches"]').textContent(), /Restricted.*Development mode required/)
        assert.match(await page.locator('[data-capability-id="runtime.remove"]').textContent(), /Human confirmation/)
        await page.getByRole('button', { name: 'Refresh availability' }).click()
        assert.equal(await page.evaluate(() => window.actions.at(-1).action), 'refreshAiCapabilities')
        await page.locator('#ai-agent-enabled').uncheck()
        assert.deepEqual(await page.evaluate(() => window.actions.at(-1)), { action: 'setAiPreference', key: 'agentEnabled', value: false })
        const agentDisabled = structuredClone(snapshot)
        agentDisabled.preferences.agentEnabled = false
        agentDisabled.capabilities.forEach(entry => { entry.availability = { enabled: false, reasonCode: 'DISABLED_BY_USER' } })
        await page.evaluate(state => window.postMessage({ type: 'aiCapabilities', state }, '*'), agentDisabled)
        assert.equal(await page.locator('#ai-integration-status').textContent(), 'Disabled by you')
        assert.equal(await page.locator('#ai-guidance-enabled').isDisabled(), true)
        assert.match(await page.locator('[data-capability-id="runtime.state"]').textContent(), /Agent integration disabled/)
        await page.locator('#ai-source-diagnostics').uncheck()
        assert.deepEqual(await page.evaluate(() => window.actions.at(-1)), { action: 'setAiPreference', key: 'sourceDiagnostics', value: false })
        await page.evaluate(state => window.postMessage({ type: 'aiCapabilities', state }, '*'), snapshot)
        assert.equal(await page.locator('#ai-guidance-enabled').isDisabled(), false)
        await page.locator('#ai-diagnostics-on-save').check()
        assert.deepEqual(await page.evaluate(() => window.actions.at(-1)), { action: 'setAiPreference', key: 'diagnosticsOnSave', value: true })
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
        assert.equal(await page.locator('[data-capability-id]').count(), catalog.length)
        assert.ok(await page.locator('.ai-table-scroll').first().evaluate((node) => node.scrollWidth > node.clientWidth))
        assert.equal(await page.locator('.ai-overview-grid').evaluate(node => node.scrollWidth <= node.clientWidth), true)
        assert.deepEqual(errors, [])
    } finally { await browser.close() }
})
