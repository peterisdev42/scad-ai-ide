import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const root = new URL('../', import.meta.url)
const generated = new URL('src/ai/generated/', root)
const catalog = JSON.parse(await readFile(new URL('feature-catalog.generated.json', generated)))
const layout = JSON.parse(await readFile(new URL('ai-panel-layout.generated.json', generated)))
for (const feature of catalog.features) feature.configurable = feature.control.userConfigurable
const pick = id => catalog.features.find(feature => feature.id === id)
const fixture = {
    schemaVersion: 1,
    revision: 1,
    state: Object.fromEntries(catalog.features.map(feature => [feature.id, {
        userPreferenceEnabled: feature.control.enabledByDefault,
        effectiveEnabled: feature.control.enabledByDefault,
        reasonCode: 'AVAILABLE',
        reasonDetail: '',
    }])),
    preferences: {
        agentEnabled: true, guidanceEnabled: true,
        groups: Object.fromEntries(catalog.groups.filter(group => group.control).map(group => [group.id, true])),
        features: {},
        editorAssistance: Object.fromEntries(catalog.features.flatMap(feature => feature.setting ? [[feature.id, feature.setting.default]] : [])),
    },
}

test('AI Panel renders all metadata, safely edits preferences and retains focus during live updates', async () => {
    const browser = await chromium.launch({ channel: process.env.SCAD_BROWSER_CHANNEL || undefined })
    try {
        const page = await browser.newPage({ viewport: { width: 1000, height: 960 } })
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        const mount = {
            csp: "'self'", nonce: 'feature-test-nonce', page: 'ai', title: 'AI',
            style: '/main.css', scrollbarStyle: '/scrollbar.css', scrollbarScript: '/scrollbar.js',
            script: '/main.js', aiScript: '/ai.js', librariesScript: '/libraries.js',
        }
        const html = (await readFile(new URL('media/panels/index.html', root), 'utf8')).replace(/\{\{(\w+)\}\}/g, (_, key) => mount[key])
        const theme = ':root { --vscode-font-family: system-ui; --vscode-font-size: 13px; --vscode-font-weight: 400; --vscode-foreground: #ccc; --vscode-editor-background: #1f1f1f; --vscode-editorWidget-background:#252526; --vscode-descriptionForeground:#aaa; --vscode-panel-border:#444; --vscode-focusBorder:#007fd4; --vscode-textCodeBlock-background:#333; }'
        await page.route('https://feature-panel.test/**', async route => {
            const name = new URL(route.request().url()).pathname
            if (name === '/') return route.fulfill({ contentType: 'text/html', body: html })
            if (name === '/scrollbar.js' || name === '/scrollbar.css') return route.fulfill({ contentType: name.endsWith('.js') ? 'text/javascript' : 'text/css', body: '' })
            const body = await readFile(new URL('media/panels' + name, root), 'utf8')
            return route.fulfill({ contentType: name.endsWith('.js') ? 'text/javascript' : 'text/css', body: name.endsWith('.css') ? theme + body : body })
        })
        await page.addInitScript(() => {
            window.actions = []
            window.acquireVsCodeApi = () => ({ getState: () => ({}), setState() {}, postMessage: action => window.actions.push(action) })
        })
        await page.goto('https://feature-panel.test/')
        const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
        assert.match(csp, /default-src 'none';.*script-src 'nonce-feature-test-nonce'/)
        await page.evaluate(() => {
            const script = document.createElement('script')
            script.textContent = 'window.untrustedScriptRan = true'
            document.head.append(script)
        })
        assert.equal(await page.evaluate(() => window.untrustedScriptRan), undefined)
        const send = (state, staticData = {}) => page.evaluate(data => window.postMessage({ type: 'ai.snapshot', ...data }, '*'), { state, ...staticData })
        const lastAction = () => page.evaluate(() => window.actions.at(-1))
        const hostile = '<img src=x onerror=alert(1)>'
        const unsafeCatalog = structuredClone(catalog)
        unsafeCatalog.features[0].display.summary = hostile
        await send(fixture, { catalog: unsafeCatalog, layout })
        await page.getByRole('heading', { name: 'Integration' }).waitFor()
        const row = id => page.locator(`[data-feature-id="${id}"]`)
        assert.equal(await page.locator('[data-feature-id]').count(), catalog.features.length)
        assert.match(await row(catalog.features[0].id).textContent(), /<img src=x/)
        assert.equal(await page.locator('#ai img').count(), 0)
        assert.equal(await page.locator('#ai-content .ai-overview-card').count(), 4)
        assert.equal(await page.locator('.ai-disclosure[open]').count(), 0)
        assert.equal(await page.locator('#ai-content .ai-disclosure').count(), 9)
        for (const feature of catalog.features) {
            if (feature.tool || feature.resource) assert.equal(await row(feature.id).locator('code').textContent(), feature.tool?.name ?? feature.resource.path)
        }
        const integration = page.getByRole('checkbox', { name: catalog.controls.agentEnabled.label })
        await integration.focus()
        await integration.press('Space')
        assert.deepEqual(await lastAction(), { action: 'ai.setIntegrationEnabled', controlId: 'agentEnabled', enabled: false })
        assert.equal(await integration.isChecked(), true, 'Pending write retains last acknowledged value')
        await page.evaluate(() => window.postMessage({ type: 'error', action: 'ai.setIntegrationEnabled', message: 'Settings write failed' }, '*'))
        await page.locator('#action-error').filter({ hasText: 'Settings write failed' }).waitFor()
        assert.equal(await integration.isChecked(), true)
        const disabled = structuredClone(fixture)
        disabled.revision = 2
        disabled.preferences.agentEnabled = false
        const id = 'tool.runtime.state'
        Object.assign(disabled.state[id], { reasonCode: 'DISABLED_GLOBAL', effectiveEnabled: false })
        await send(disabled)
        await page.waitForFunction(() => !document.activeElement.checked)
        assert.equal(await integration.evaluate(node => document.activeElement === node), true)
        await send(fixture) // Lower revision cannot overwrite live state.
        const runtime = catalog.groups.find(group => group.id === 'runtime')
        await page.locator('summary').filter({ hasText: /^Runtime$/ }).click()
        const group = page.getByRole('checkbox', { name: 'Enable ' + runtime.label, exact: true })
        await group.press('Space')
        assert.deepEqual(await lastAction(), { action: 'ai.setGroupEnabled', groupId: 'runtime', enabled: false })
        const item = row(id).getByRole('checkbox', { name: pick(id).display.label })
        await item.press('Space')
        assert.deepEqual(await lastAction(), { action: 'ai.setFeatureEnabled', featureId: id, enabled: false })
        assert.match(await row(id).textContent(), /Agent integration is disabled/)
        assert.equal(await integration.isChecked(), false)
        const state = structuredClone(disabled)
        state.revision = 3
        state.preferences.groups.runtime = false
        Object.assign(state.state[id], { reasonCode: 'DISABLED_GROUP', effectiveEnabled: false, reasonDetail: hostile, userPreferenceEnabled: false })
        await send(state)
        await row(id).getByText('Group is disabled', { exact: true }).waitFor()
        assert.equal(await item.evaluate(node => document.activeElement === node), true)
        assert.equal(await row(id).locator('img').count(), 0)
        assert.match(await group.locator('../../..').textContent(), /selected · \d+ available/)
        const select = page.getByRole('combobox', { name: pick('setting.editor.onSave').display.label })
        await select.selectOption('diagnostics')
        assert.deepEqual(await lastAction(), { action: 'ai.setSettingEnabled', featureId: 'setting.editor.onSave', value: 'diagnostics' })
        const turnOff = page.getByRole('button', { name: 'Turn all off', exact: true })
        const restore = page.getByRole('button', { name: 'Restore defaults', exact: true })
        await turnOff.click()
        assert.deepEqual(await lastAction(), { action: 'ai.applyPreferencePreset', preset: 'off' })
        assert.equal(await restore.isDisabled(), true)
        const finish = () => page.evaluate(() => window.postMessage({ type: 'actionComplete', action: 'ai.applyPreferencePreset' }, '*'))
        await finish()
        await restore.click()
        assert.deepEqual(await lastAction(), { action: 'ai.applyPreferencePreset', preset: 'defaults' })
        await finish()
        await page.setViewportSize({ width: 360, height: 780 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        assert.deepEqual(errors, [])
    } finally { await browser.close() }
})
