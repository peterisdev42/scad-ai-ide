import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
export async function libraryFixtureHtml() {
    return (await readFile(new URL('../media/panels/index.html', import.meta.url), 'utf8'))
        .replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, '')
        .replace(/<script[^>]*><\/script>/g, '')
        .replace(/<link[^>]+>/g, '')
        .replace(/\{\{title\}\}/g, 'Libraries')
        .replace(/\{\{page\}\}/g, 'libraries')
}
export const state = {
    projects: ['/projects/A', '/projects/B'],
    selectedProject: '/projects/A',
    trusted: true,
    busy: false,
    message: '',
    error: '',
    registryError: '',
    registryBusy: false,
    registryLoaded: true,
    projectError: '',
    query: '',
    globalIssues: [],
    projectDependencies: [{ id: 'fixture', repositoryUrl: 'https://github.com/example/fixture', name: 'Fixture', version: 'v1', commit: 'a'.repeat(40), status: 'Ready', mode: 'symlink' }],
    global: [{ libraryId: 'fixture', repositoryUrl: 'https://github.com/example/fixture', versions: ['v1'], commit: 'a'.repeat(40), sizeBytes: 1234, status: 'ready', installedAt: '2026-11-03', sourcePath: '/global/source', key: 'opaque-host-key', references: { projects: ['/projects/A'], unavailable: [], externalReferencesUnknown: true } }],
    registry: [
        {
            id: 'fixture',
            name: '<Fixture Library>',
            description: '<img src=x onerror=alert(1)>',
            license: 'MIT',
            sync: { status: 'ok' },
            latestVersion: null,
            repositoryUrl: 'https://github.com/example/fixture',
            documentationUrl: 'https://github.com/example/fixture',
            layout: { includeName: 'fixture-library', includeRoot: '.' },
            versions: [
                { label: 'v1', commit: 'a'.repeat(40), layoutError: '', cached: true },
                { label: 'v2', commit: 'b'.repeat(40), layoutError: 'Layout not audited' },
            ],
        },
    ],
}
test('Library webview: tabs, escaping, exact selection, project selection, cleanup protection and busy/trust states', async () => {
    const browser = await chromium.launch({ channel: process.env.SCAD_BROWSER_CHANNEL || undefined })
    try {
        const page = await browser.newPage({ viewport: { width: 1120, height: 860 } })
        await page.clock.install()
        const errors = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.setContent(await libraryFixtureHtml())
        await page.evaluate(() => {
            window.__actions = []
            let saved = {}
            window.acquireVsCodeApi = () => ({
                postMessage: (value) => window.__actions.push(value),
                getState: () => saved,
                setState: (value) => {
                    saved = value
                },
            })
        })
        await page.addStyleTag({ content: ':root { --vscode-font-family: system-ui; --vscode-font-size: 13px; --vscode-font-weight: 400; --vscode-foreground: #cccccc; --vscode-editor-background: #1f1f1f; --vscode-descriptionForeground: #999999; --vscode-panel-border: #343434; --vscode-focusBorder: #007fd4; --vscode-button-background: #0078d4; --vscode-button-foreground: #ffffff; --vscode-button-secondaryBackground: #313131; --vscode-button-secondaryForeground: #cccccc; --vscode-input-background: #313131; --vscode-input-foreground: #cccccc; }' })
        await page.addStyleTag({ path: root + 'media/panels/main.css' })
        await page.addScriptTag({ path: root + 'media/panels/main.js' })
        // Exercise early host response buffering before the feature script attaches.
        await page.evaluate((state) => window.postMessage({ type: 'librariesState', state }, '*'), state)
        await page.addScriptTag({ path: root + 'media/panels/libraries.js' })
        assert.deepEqual(
            await page
                .getByRole('tablist', { name: 'Library sections' })
                .getByRole('tab')
                .allTextContents()
                .then((labels) => labels.map((label) => label.trim().split(' ')[0])),
            ['Registry', 'Global', 'Project'],
        )
        assert.equal(await page.locator('#library-tabs').evaluate((node) => node.parentElement.tagName), 'HEADER')
        await page.getByRole('tab', { name: 'Registry', exact: true }).click()
        assert.equal(await page.locator('#library-panel-registry img').count(), 0)
        assert.equal(await page.getByRole('combobox', { name: '<Fixture Library> version' }).inputValue(), 'v1', 'Without a declared latest tag, use the first Registry entry')
        assert.equal(await page.getByRole('button', { name: 'Install to Project' }).isEnabled(), true)
        await page.getByRole('combobox', { name: '<Fixture Library> version' }).selectOption('v1')
        await page.getByRole('button', { name: 'Install to Project' }).click()
        assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), { action: 'libraries.install', id: 'fixture', version: 'v1' })
        assert.equal(await page.getByRole('heading', { name: 'Libraries', exact: true }).count(), 1)
        assert.equal(await page.locator('.library-breadcrumb').count(), 0)
        assert.equal(await page.getByRole('combobox', { name: 'Current project' }).count(), 0)
        assert.equal(await page.getByRole('button', { name: 'Search', exact: true }).count(), 0)
        const searchLayout = await page.locator('.library-search').evaluate((toolbar) => {
            const input = toolbar.querySelector('input').getBoundingClientRect()
            const icon = toolbar.querySelector('.library-search-input svg').getBoundingClientRect()
            const refresh = toolbar.querySelector('button').getBoundingClientRect()
            return { iconInside: icon.left > input.left && icon.right < input.right, gap: icon.left - input.left, padding: parseFloat(getComputedStyle(toolbar.querySelector('input')).paddingLeft), aligned: Math.abs((refresh.top + refresh.bottom) / 2 - (input.top + input.bottom) / 2) < 1, right: refresh.left > input.right }
        })
        assert.equal(searchLayout.iconInside, true)
        assert.ok(searchLayout.gap >= 7 && searchLayout.padding >= 31)
        assert.equal(searchLayout.aligned, true)
        assert.equal(searchLayout.right, true)

        assert.equal(await page.locator('.library-current-project').isVisible(), false)
        // Installing the clock still lets real time advance. Pause before exact
        // 299/300ms assertions so CI scheduling cannot consume the final 1ms.
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
        const search = page.getByRole('searchbox', { name: 'Search registry' })
        await search.fill('missing')
        await page.clock.fastForward(299)
        assert.equal(await page.locator('#library-panel-registry .library-card').count(), 1, 'Filter waits 300ms')
        await page.clock.fastForward(1)
        await page.getByRole('heading', { name: 'No matching libraries' }).waitFor()
        await search.fill('unfinished')
        await page.clock.fastForward(200)
        await search.fill('FIXTURE')
        await page.clock.fastForward(299)
        assert.equal(await page.locator('#library-panel-registry .library-card').count(), 0, 'Typing restarts the debounce')
        await page.clock.fastForward(1)
        await page.locator('#library-panel-registry .library-card').waitFor()
        assert.equal(await page.evaluate(() => window.__actions.some((action) => action.action === 'libraries.search')), false, 'Filtering never sends a host/network request')
        await page.clock.resume()
        await page.evaluate((state) => window.postMessage({ type: 'librariesState', state: { ...state, registryBusy: true, registryStatus: 'Showing locally cached registry.', message: 'Loading libraries…' } }, '*'), state)
        await page.waitForFunction(() => document.querySelector('[aria-label="Search registry"]') === document.activeElement)
        assert.equal(await search.inputValue(), 'FIXTURE')
        assert.equal(await page.getByRole('combobox', { name: '<Fixture Library> version' }).inputValue(), 'v1')
        assert.equal(await page.getByRole('combobox', { name: '<Fixture Library> version' }).isEnabled(), true)
        assert.equal(await page.locator('.library-status').isVisible(), false, 'Cached refresh is silent')
        assert.equal(await page.getByRole('heading', { name: 'Loading libraries…' }).count(), 0)
        await page.evaluate((state) => window.postMessage({ type: 'librariesState', state: { ...state, registryError: 'Registry refresh failed' } }, '*'), state)
        await page.getByRole('alert').filter({ hasText: 'Registry refresh failed' }).waitFor()
        assert.equal(await page.locator('#library-panel-registry .library-card').count(), 1)
        await page.evaluate((state) => window.postMessage({ type: 'librariesState', state: { ...state, message: 'Library state refreshed.' } }, '*'), state)
        await page.getByRole('combobox', { name: '<Fixture Library> version' }).selectOption('v2')
        assert.equal(await page.getByRole('button', { name: 'Install to Project' }).isDisabled(), true)
        await page.getByRole('tab', { name: 'Project', exact: true }).click()
        assert.equal(await page.locator('.library-current-project').isVisible(), true)
        assert.equal(await page.locator('.library-current-project').textContent(), '/projects/A')
        assert.equal(await page.locator('.library-current-project input, .library-current-project select').count(), 0)
        await page.getByRole('tab', { name: 'Global', exact: true }).click()
        assert.equal(await page.getByRole('button', { name: 'Preview Cleanup…' }).isDisabled(), true)
        await page.evaluate((state) => window.postMessage({ type: 'librariesState', state: { ...state, busy: true, cancellable: true, message: 'Downloading…' } }, '*'), state)
        await page.waitForFunction(() => document.body.textContent.includes('Downloading…'))
        assert.equal(await page.getByRole('button', { name: 'Verify', exact: true }).isDisabled(), true)
        assert.equal(await page.getByRole('button', { name: 'Cancel Operation' }).isEnabled(), true)
        await page.evaluate((state) => window.postMessage({ type: 'librariesState', state: { ...state, trusted: false } }, '*'), state)
        await page.waitForFunction(() => document.body.textContent.includes('Trust this workspace'))
        await page.getByRole('tab', { name: 'Project', exact: true }).click()
        assert.equal(await page.getByRole('button', { name: 'Restore Dependencies' }).isDisabled(), true)
        assert.equal(await page.getByRole('button', { name: 'Remove', exact: true }).isDisabled(), true)
        await page.getByRole('tab', { name: 'Registry', exact: true }).click()
        await page.evaluate((state) => window.postMessage({ type: 'librariesState', state: { ...state, registry: [], registryBusy: true, registryLoaded: false } }, '*'), state)
        await page.getByRole('heading', { name: 'Loading libraries…' }).waitFor()
        await page.evaluate((state) => window.postMessage({ type: 'librariesState', state: { ...state, registry: [], registryBusy: false, registryLoaded: false, registryError: 'Network unavailable' } }, '*'), state)
        await page.getByRole('alert').filter({ hasText: 'Network unavailable' }).waitFor()
        assert.equal(await page.getByRole('heading', { name: 'Loading libraries…' }).count(), 0)
        const runtime = await browser.newPage({ viewport: { width: 1120, height: 860 } })
        await runtime.setContent((await libraryFixtureHtml()).replace('data-page="libraries"', 'data-page="runtime"'))
        await runtime.evaluate(() => {
            document.querySelector('header h1').textContent = 'Runtime'
            window.acquireVsCodeApi = () => ({ getState: () => ({}), setState() {}, postMessage() {} })
        })
        await runtime.addStyleTag({ path: root + 'media/panels/main.css' })
        await runtime.addScriptTag({ path: root + 'media/panels/main.js' })
        assert.equal(await runtime.getByRole('heading', { name: 'Runtime', exact: true }).count(), 1)
        assert.deepEqual(
            await page.locator('main').evaluate((node) => {
                const s = getComputedStyle(node)
                return [s.maxWidth, s.paddingLeft, s.paddingRight]
            }),
            await runtime.locator('main').evaluate((node) => {
                const s = getComputedStyle(node)
                return [s.maxWidth, s.paddingLeft, s.paddingRight]
            }),
            'Libraries shares Runtime centered layout',
        )
        await runtime.close()
        assert.deepEqual(errors, [])
        await mkdir(root + '.build', { recursive: true })
        await page.screenshot({ path: root + '.build/library-manager-ui.png', fullPage: true })
    } finally {
        await browser.close()
    }
})

test('Library layout follows VS Code theme tokens and adapts navigation without horizontal overflow', async () => {
    const browser = await chromium.launch({ channel: process.env.SCAD_BROWSER_CHANNEL || undefined })
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
        await page.setContent(await libraryFixtureHtml())
        await page.evaluate(() => {
            let saved = {}
            window.acquireVsCodeApi = () => ({
                postMessage() {},
                getState: () => saved,
                setState: (value) => {
                    saved = value
                },
            })
        })
        await page.addStyleTag({ content: ':root { --vscode-font-family: system-ui; --vscode-editor-font-family: monospace; --vscode-font-size: 13px; --vscode-font-weight: 400; }' })
        await page.addStyleTag({ path: root + 'media/panels/main.css' })
        await page.addScriptTag({ path: root + 'media/panels/main.js' })
        await page.addScriptTag({ path: root + 'media/panels/libraries.js' })
        assert.equal(await page.locator('.library-status').isVisible(), false, 'No empty blue tip before the first host state')
        assert.equal(await page.locator('.library-content > [role="alert"]').isVisible(), false, 'No empty red tip before the first host state')
        const display = {
            ...state,
            projects: ['/workspace/parametric-enclosure'],
            selectedProject: '/workspace/parametric-enclosure',
            projectDependencies: state.projectDependencies.map((dep) => ({ ...dep, id: 'geometry-toolkit', repositoryUrl: state.registry[0].repositoryUrl })),
            global: state.global.map((entry) => ({ ...entry, libraryId: 'geometry-toolkit' })),
            registry: [
                { ...state.registry[0], id: 'geometry-toolkit', name: 'Geometry Toolkit', description: 'Reusable shapes, transformations, and helpers for parametric models.', latestVersion: 'v2', versions: state.registry[0].versions.map((v) => ({ ...v, layoutError: '' })) },
                { ...state.registry[0], id: 'fasteners', name: 'Fasteners', description: 'Threaded parts, screw profiles, and mounting hardware for your next project.' },
                { ...state.registry[0], id: 'curve-utilities', name: 'Curve Utilities', description: 'Build smooth paths, rounded outlines, and custom surface profiles.', versions: [{ label: 'snapshot:' + 'c'.repeat(40), commit: 'c'.repeat(40), kind: 'snapshot', layoutError: '', cached: false }] },
            ],
        }
        await page.evaluate((state) => window.postMessage({ type: 'librariesState', state }, '*'), display)
        await page.getByRole('tab', { name: 'Registry', exact: true }).click()
        assert.equal(await page.locator('.library-content h1, .library-content h2, .library-subtitle').count(), 0)
        assert.equal(await page.getByText('Discover libraries from SCAD Registry.', { exact: true }).count(), 0)
        assert.equal(await page.getByText('3 libraries', { exact: true }).count(), 0)
        assert.equal(await page.locator('#library-panel-registry .library-metadata, #library-panel-registry .library-include').count(), 0)
        assert.equal(await page.getByRole('combobox', { name: 'Geometry Toolkit version' }).inputValue(), 'v2', 'Declared latest wins over display order')
        assert.equal(await page.getByRole('combobox', { name: 'Fasteners version' }).inputValue(), 'v1')
        assert.equal(await page.getByRole('combobox', { name: 'Curve Utilities version' }).inputValue(), 'snapshot:' + 'c'.repeat(40))
        const cardHeader = page.locator('#library-panel-registry .library-card-header').first()
        assert.equal(await cardHeader.getByRole('link', { name: 'Repository', exact: true }).count(), 1)
        assert.equal(await cardHeader.getByRole('link', { name: 'Documentation', exact: true }).count(), 1)
        const titleBox = await cardHeader.getByRole('heading', { name: 'Geometry Toolkit', exact: true }).boundingBox()
        const linksBox = await cardHeader.locator('.library-links').boundingBox()
        assert.ok(linksBox.x > titleBox.x + titleBox.width)
        assert.ok(Math.abs(linksBox.y - titleBox.y) < 8, 'Links align with the title row on wide windows')
        assert.deepEqual(
            await page.getByRole('combobox', { name: 'Geometry Toolkit version' }).evaluate((node) => {
                const style = getComputedStyle(node)
                const arrow = getComputedStyle(node.parentElement, '::after')
                return [style.appearance, style.paddingInlineEnd, arrow.insetInlineEnd, arrow.pointerEvents]
            }),
            ['none', '32px', '12px', 'none'],
        )
        const themes = {
            dark: { bg: '#1f1f1f', fg: '#cccccc', sidebar: '#181818', muted: '#9d9d9d', border: '#343434', input: '#313131', accent: '#0078d4', selected: '#04395e', selectedText: '#ffffff' },
            light: { bg: '#ffffff', fg: '#333333', sidebar: '#f3f3f3', muted: '#616161', border: '#e2e2e2', input: '#ffffff', accent: '#006ab1', selected: '#cce8ff', selectedText: '#000000' },
            'high-contrast': { bg: '#000000', fg: '#ffffff', sidebar: '#000000', muted: '#ffffff', border: '#ffffff', input: '#000000', accent: '#ffff00', selected: '#000000', selectedText: '#ffff00' },
            'high-contrast-light': { bg: '#ffffff', fg: '#292929', sidebar: '#ffffff', muted: '#292929', border: '#292929', input: '#ffffff', accent: '#0f4a85', selected: '#ffffff', selectedText: '#0f4a85' },
        }
        for (const [name, theme] of Object.entries(themes)) {
            await page.evaluate(
                ({ name, theme }) => {
                    document.body.className = `vscode-${name}`
                    const values = {
                        'editor-background': theme.bg,
                        foreground: theme.fg,
                        'sideBar-background': theme.sidebar,
                        'sideBar-foreground': theme.fg,
                        descriptionForeground: theme.muted,
                        'panel-border': theme.border,
                        'widget-border': theme.border,
                        'input-border': theme.border,
                        'input-background': theme.input,
                        'input-foreground': theme.fg,
                        'input-placeholderForeground': theme.muted,
                        'dropdown-background': theme.input,
                        'dropdown-foreground': theme.fg,
                        'dropdown-border': theme.border,
                        'editorWidget-background': theme.sidebar,
                        'textLink-foreground': theme.accent,
                        focusBorder: theme.accent,
                        'button-background': theme.accent,
                        'button-foreground': name === 'high-contrast' ? theme.bg : '#ffffff',
                        'button-secondaryBackground': name === 'dark' ? '#313131' : name === 'light' ? '#e5e5e5' : theme.input,
                        'button-secondaryForeground': theme.fg,
                        disabledForeground: theme.muted,
                        'list-activeSelectionBackground': theme.selected,
                        'list-activeSelectionForeground': theme.selectedText,
                        'testing-iconPassed': theme.accent,
                        'textCodeBlock-background': theme.sidebar,
                    }
                    for (const [key, value] of Object.entries(values)) document.documentElement.style.setProperty(`--vscode-${key}`, value)
                    if (name.startsWith('high-contrast')) document.documentElement.style.setProperty('--vscode-contrastBorder', theme.border)
                    else document.documentElement.style.removeProperty('--vscode-contrastBorder')
                },
                { name, theme },
            )
            const expected = await page.evaluate((theme) => {
                const c = document.createElement('div')
                c.style.color = theme.bg
                document.body.append(c)
                const rgb = getComputedStyle(c).color
                c.remove()
                return rgb
            }, theme)
            assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), expected)
            assert.equal(await page.getByRole('tablist', { name: 'Library sections' }).getAttribute('aria-orientation'), 'horizontal')
            assert.equal(await page.getByRole('tab', { name: 'Registry', exact: true }).evaluate((node) => getComputedStyle(node).borderBottomStyle), 'solid')
            await page.screenshot({ path: root + `.build/library-manager-registry-${name}.png`, fullPage: true })
            if (name === 'dark') {
                for (const tab of ['Global', 'Project']) {
                    await page.getByRole('tab', { name: tab, exact: true }).click()
                    await page.screenshot({ path: root + `.build/library-manager-${tab.toLowerCase()}-dark.png`, fullPage: true })
                }
                await page.getByRole('tab', { name: 'Registry', exact: true }).click()
            }

        }
        await page.getByRole('tab', { name: 'Registry', exact: true }).focus()
        await page.keyboard.press('ArrowRight')
        assert.equal(await page.getByRole('tab', { name: 'Global', exact: true }).getAttribute('aria-selected'), 'true')
        await page.setViewportSize({ width: 480, height: 900 })
        await page.waitForFunction(() => document.querySelector('[role="tablist"][aria-label="Library sections"]').getAttribute('aria-orientation') === 'horizontal')
        await page.getByRole('tab', { name: 'Global', exact: true }).focus()
        await page.keyboard.press('ArrowRight')
        assert.equal(await page.getByRole('tab', { name: 'Project', exact: true }).getAttribute('aria-selected'), 'true')
        for (const width of [320, 480, 720, 960, 1280]) {
            await page.setViewportSize({ width, height: 900 })
            const boxes = []
            for (const tab of ['Project', 'Global', 'Registry']) {
                await page.getByRole('tab', { name: tab, exact: true }).click()
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${tab} overflows at ${width}px`)
                const card = page.locator(`#library-panel-${tab.toLowerCase()} .library-card`).first()
                boxes.push(await card.boundingBox())
                const spacing = await card.evaluate((node) => {
                    const info = node.querySelector('.library-card-info').getBoundingClientRect()
                    const mark = node.querySelector('.library-package-mark').getBoundingClientRect()
                    const actions = node.querySelector('.library-card-actions')
                    const divider = actions.getBoundingClientRect().top
                    const firstControl = Math.min(...[...actions.children].map((child) => child.getBoundingClientRect().top))
                    return { above: divider - Math.max(info.bottom, mark.bottom), below: firstControl - divider - parseFloat(getComputedStyle(actions).borderTopWidth) }
                })
                assert.ok(Math.abs(spacing.above - spacing.below) < 1, `${tab} divider gaps differ at ${width}px: ${JSON.stringify(spacing)}`)
            }
            for (const box of boxes.slice(1)) {
                assert.ok(Math.abs(box.x - boxes[0].x) < 1 && Math.abs(box.width - boxes[0].width) < 1, `Tab card widths differ at ${width}px`)
            }
        }
        await page.setViewportSize({ width: 960, height: 800 })
        const longCatalog = { ...display, registry: Array.from({ length: 24 }, (_, index) => ({ ...display.registry[0], id: `library-${index}` })) }
        await publishPanelState(page, 'librariesState', longCatalog)
        const widths = []
        const overflows = []
        for (const tab of ['Registry', 'Global', 'Project', 'Registry']) {
            await page.getByRole('tab', { name: tab, exact: true }).click()
            widths.push(await page.locator(`#library-panel-${tab.toLowerCase()} .library-card`).first().evaluate((node) => ({ x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width })))
            overflows.push(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight))
        }
        assert.deepEqual(overflows, [true, false, false, true], 'The fixture switches between overflowing and non-overflowing pages')
        assert.deepEqual(widths, widths.map(() => widths[0]), 'Scrollbar visibility must not shift tab/card widths')
        await publishPanelState(page, 'librariesState', display)
        await page.setViewportSize({ width: 480, height: 900 })
        await page.screenshot({ path: root + '.build/library-manager-registry-narrow.png', fullPage: true })
        await page.getByRole('searchbox', { name: 'Search registry' }).fill('no match')
        await page.getByRole('heading', { name: 'No matching libraries' }).waitFor()
        await page.evaluate((state) => window.postMessage({ type: 'librariesState', state: { ...state, registry: [], projectDependencies: [], global: [] } }, '*'), display)
        await page.getByRole('heading', { name: 'No matching libraries' }).waitFor()
        await page.getByRole('tab', { name: 'Project', exact: true }).click()
        await page.getByRole('button', { name: 'Browse Registry' }).click()
        assert.equal(await page.getByRole('tab', { name: 'Registry', exact: true }).getAttribute('aria-selected'), 'true')
    } finally {
        await browser.close()
    }
})


test('Local tabs refresh once per entry and Global operations follow the selected cached version', async () => {
    const browser = await chromium.launch({ channel: process.env.SCAD_BROWSER_CHANNEL || undefined })
    try {
        const page = await browser.newPage({ viewport: { width: 1120, height: 860 } })
        await page.setContent(await libraryFixtureHtml())
        await page.evaluate(() => {
            window.__actions = []
            let saved = { libraryTab: 'global' }
            window.acquireVsCodeApi = () => ({
                postMessage: (value) => window.__actions.push(value),
                getState: () => saved,
                setState: (value) => { saved = value },
            })
        })
        await page.addStyleTag({ path: root + 'media/panels/main.css' })
        await page.addScriptTag({ path: root + 'media/panels/main.js' })
        assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), { action: 'ready', tab: 'global' }, 'A restored local tab must not request the remote Registry')
        await page.addScriptTag({ path: root + 'media/panels/libraries.js' })
        const display = structuredClone(state)
        display.global.push({ ...display.global[0], versions: ['v2'], commit: 'b'.repeat(40), key: 'unused-version', references: { projects: [], unavailable: [], externalReferencesUnknown: true } })
        const publish = async () => {
            await page.evaluate((state) => new Promise((resolve) => {
                window.addEventListener('message', function received(event) {
                    if (event.data?.type !== 'librariesState') return
                    window.removeEventListener('message', received)
                    resolve()
                })
                window.postMessage({ type: 'librariesState', state }, '*')
            }), display)
            await page.locator('#library-panel-global .library-card').waitFor()
        }
        await publish()
        const global = page.locator('#library-panel-global')
        assert.equal(await global.locator('.library-card').count(), 1, 'Cached commits are grouped by library and repository')
        assert.equal(await global.locator('.library-description').textContent(), state.registry[0].description)
        assert.equal(await global.getByRole('heading', { name: state.registry[0].name, exact: true }).count(), 1)
        assert.equal(await global.getByRole('link', { name: 'Repository', exact: true }).getAttribute('href'), state.registry[0].repositoryUrl)
        assert.equal(await global.getByRole('link', { name: 'Documentation', exact: true }).count(), 1)
        assert.ok((await global.locator('.library-section-description').textContent()).includes('shared by all projects'))
        await global.getByRole('button', { name: 'Verify All', exact: true }).click()
        assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), { action: 'libraries.verifyAll' })
        const cleanupToggle = global.getByRole('button', { name: 'Cache cleanup options', exact: true })
        await cleanupToggle.focus()
        await page.keyboard.press('ArrowDown')
        assert.equal(await cleanupToggle.getAttribute('aria-expanded'), 'true')
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), { action: 'libraries.cleanupAll', mode: 'unused' })
        assert.equal(await cleanupToggle.getAttribute('aria-expanded'), 'false')
        await page.setViewportSize({ width: 320, height: 900 })
        await cleanupToggle.click()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Open cleanup menu fits a narrow editor')
        await page.keyboard.press('Escape')
        await page.setViewportSize({ width: 1120, height: 860 })
        await cleanupToggle.click()
        await page.keyboard.press('Escape')
        assert.equal(await cleanupToggle.getAttribute('aria-expanded'), 'false')
        await global.getByRole('button', { name: 'Delete All Global Dependencies', exact: true }).click()
        assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), { action: 'libraries.cleanupAll', mode: 'all' })
        await global.getByRole('button', { name: 'Install to Project', exact: true }).click()
        assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), { action: 'libraries.install', id: 'fixture', version: 'v1' })

        assert.equal(await page.getByRole('button', { name: 'Refresh', exact: true }).count(), 0)
        assert.equal(await global.locator('.library-metadata, details').count(), 0)
        assert.equal(await global.getByText('ready', { exact: true }).count(), 0)
        assert.equal(await global.getByText('Storage & project references', { exact: true }).count(), 0)
        const picker = global.getByRole('combobox', { name: 'fixture version' })
        assert.equal(await picker.inputValue(), 'opaque-host-key')
        await picker.selectOption('unused-version')
        assert.equal(await global.getByRole('button', { name: 'Preview Cleanup…' }).isEnabled(), true)
        for (const [label, action] of [['Verify', 'verify'], ['Repair', 'repairGlobal'], ['Preview Cleanup…', 'previewCleanup']]) {
            await global.getByRole('button', { name: label, exact: true }).click()
            assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), { action: `libraries.${action}`, key: 'unused-version' })
        }
        await publish()
        assert.equal(await picker.inputValue(), 'unused-version', 'A local refresh preserves the selection')
        await picker.selectOption('opaque-host-key')
        assert.equal(await global.getByRole('button', { name: 'Preview Cleanup…' }).isDisabled(), true)
        await page.evaluate(() => { window.__actions = [] })
        await page.getByRole('tab', { name: 'Global', exact: true }).click()
        assert.deepEqual(await page.evaluate(() => window.__actions), [], 'Clicking the current tab does not refresh again')
        await page.getByRole('tab', { name: 'Project', exact: true }).click()
        assert.deepEqual(await page.evaluate(() => window.__actions), [{ action: 'libraries.selectTab', tab: 'project' }])
        const project = page.locator('#library-panel-project')
        assert.equal(await page.getByRole('button', { name: 'Refresh', exact: true }).count(), 0)
        assert.equal(await project.locator('.library-metadata').count(), 0)
        assert.equal(await project.getByText('Ready', { exact: true }).count(), 0)
        assert.equal(await project.locator('.library-description').textContent(), state.registry[0].description)
        assert.equal(await project.getByRole('link', { name: 'Repository', exact: true }).count(), 1)
        assert.equal(await project.getByRole('link', { name: 'Documentation', exact: true }).count(), 1)
        assert.ok((await project.locator('.library-section-description').textContent()).includes('lockfile'))
        assert.equal(await project.getByText('Current Project', { exact: true }).count(), 0)
        const pathStyle = await project.locator('.library-current-project').evaluate((node) => ({ border: getComputedStyle(node).borderTopWidth, background: getComputedStyle(node).backgroundColor }))
        assert.deepEqual(pathStyle, { border: '0px', background: 'rgba(0, 0, 0, 0)' })

        await page.getByRole('tab', { name: 'Global', exact: true }).click()
        await publish()
        assert.deepEqual(await page.evaluate(() => window.__actions), [{ action: 'libraries.selectTab', tab: 'project' }, { action: 'libraries.selectTab', tab: 'global' }], 'Rendering does not trigger another refresh')
        display.registry = []
        await publish()
        assert.equal(await global.getByRole('link', { name: 'Repository', exact: true }).count(), 1, 'Source links survive missing Registry metadata')
        assert.equal(await global.getByRole('button', { name: 'Install to Project', exact: true }).isDisabled(), true)
        await page.getByRole('tab', { name: 'Project', exact: true }).click()
        assert.equal(await project.getByRole('button', { name: 'Switch Version', exact: true }).isDisabled(), true)
        assert.equal(await project.getByRole('link', { name: 'Repository', exact: true }).count(), 1)
        await page.getByRole('tab', { name: 'Global', exact: true }).click()
        display.global[0].status = 'corrupted'
        await publish()
        await global.getByText('corrupted', { exact: true }).waitFor()
        await page.getByRole('tab', { name: 'Registry', exact: true }).click()
        assert.equal(await page.getByRole('button', { name: 'Refresh', exact: true }).isVisible(), true)
    } finally {
        await browser.close()
    }
})


test('More exposes cache tools only in development, supports keyboard navigation and exact clear actions', async () => {
    const browser = await chromium.launch({ channel: process.env.SCAD_BROWSER_CHANNEL || undefined })
    try {
        const page = await browser.newPage({ viewport: { width: 1120, height: 860 } })
        const errors = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.setContent((await libraryFixtureHtml()).replace('data-page="libraries"', 'data-page="more"'))
        await page.evaluate(() => {
            document.querySelector('header h1').textContent = 'More'
            window.__actions = []
            let saved = {}
            window.acquireVsCodeApi = () => ({ getState: () => saved, setState: (value) => { saved = value }, postMessage: (value) => window.__actions.push(value) })
        })
        await page.addStyleTag({ content: ':root { --vscode-font-family: system-ui; --vscode-font-size: 13px; --vscode-foreground: #cccccc; --vscode-editor-background: #1f1f1f; --vscode-descriptionForeground: #999999; --vscode-panel-border: #343434; --vscode-focusBorder: #007fd4; --vscode-button-background: #0078d4; --vscode-button-foreground: #ffffff; --vscode-button-secondaryBackground: #313131; --vscode-button-secondaryForeground: #cccccc; }' })
        await page.addStyleTag({ path: root + 'media/panels/main.css' })
        await page.addStyleTag({ path: root + 'dist/panel-scrollbar.css' })
        await page.addScriptTag({ path: root + 'dist/panel-scrollbar.js' })
        await page.addScriptTag({ path: root + 'media/panels/main.js' })
        await page.evaluate(() => window.postMessage({ type: 'developmentMode', enabled: false }, '*'))
        assert.equal(await page.getByRole('tab', { name: 'Development', exact: true }).count(), 0)
        await page.evaluate(() => window.postMessage({ type: 'developmentMode', enabled: true }, '*'))
        await page.getByRole('tab', { name: 'GitHub', exact: true }).focus()
        await page.keyboard.press('ArrowRight')
        assert.equal(await page.getByRole('tab', { name: 'Development', exact: true }).getAttribute('aria-selected'), 'true')
        assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), { action: 'development.refreshCaches' })
        const state = { globalDirectory: '/extension/global', entries: [
            { id: 'globalState:runtime.catalog', scope: 'globalState', name: 'runtime.catalog', value: { builds: [123], enabled: true, absent: null, text: 'escaped \"quote\"' } },
            { id: 'workspaceState:unsafe', scope: 'workspaceState', name: '<img src=x onerror=alert(1)>', value: { unsafe: '<script>alert(1)</script>' } },
        ] }
        const publish = async () => {
            await page.evaluate((state) => window.postMessage({ type: 'developmentState', state }, '*'), state)
            await page.getByRole('button', { name: 'Clear globalState runtime.catalog', exact: true }).waitFor()
        }
        await publish()
        assert.equal(await page.locator('.cache-entry img, .cache-entry script').count(), 0)
        assert.equal(await page.getByRole('table').count(), 2)
        assert.deepEqual(await page.locator('.cache-table thead th').allTextContents(), ['Field', 'Value', 'Action', 'Field', 'Value', 'Action'])
        assert.equal(await page.locator('.cache-table tbody tr').count(), 2)
        assert.equal(await page.locator('article.cache-entry').count(), 0)
        await page.getByRole('button', { name: 'Open Global Folder', exact: true }).click()
        assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), { action: 'development.openGlobalFolder' })
        await publish()

        await page.getByRole('button', { name: 'Clear globalState runtime.catalog', exact: true }).click()
        assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), { action: 'development.clearCache', id: 'globalState:runtime.catalog' })
        assert.equal(await page.getByRole('button', { name: 'Clear All Caches', exact: true }).isDisabled(), true)
        await publish()
        await page.getByRole('button', { name: 'Clear All Caches', exact: true }).click()
        assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), { action: 'development.clearAllCaches' })
        await publish()
        assert.equal(await page.locator('#summary').isVisible(), false)
        assert.equal(await page.locator('#panel-development > .section-toolbar .actions button').last().textContent(), 'Open Global Folder')
        await page.getByRole('button', { name: 'View globalState runtime.catalog', exact: true }).click()
        assert.equal(await page.getByRole('dialog').isVisible(), true)
        assert.match(await page.locator('#cache-value-content').textContent(), /123/)
        const highlightRequest = await page.evaluate(() => window.__actions.at(-1))
        assert.equal(highlightRequest.action, 'development.inspectCache')
        const text = JSON.stringify(state.entries[0].value, null, 2)
        await page.evaluate(({ request, text }) => window.postMessage({ type: 'cacheValue', id: request.id, requestId: request.requestId, tokens: [{ text: text.slice(0, 5), color: '#123456', font: 2 }, { text: text.slice(5), color: '#abcdef', font: 1 }] }, '*'), { request: highlightRequest, text })
        await page.waitForFunction(() => document.querySelector('#cache-value-content span'))
        assert.equal(await page.locator('#cache-value-content').textContent(), text)
        assert.equal(await page.locator('#cache-value-content span').first().evaluate((node) => node.style.color), 'rgb(18, 52, 86)')
        const singleLineAlignment = await page.locator('#cache-value-title').evaluate((node) => {
            const title = node.getBoundingClientRect(), actions = node.nextElementSibling.getBoundingClientRect()
            return Math.abs(title.y + title.height / 2 - actions.y - actions.height / 2)
        })
        assert.ok(singleLineAlignment < 1)
        await page.evaluate(() => { document.getElementById('cache-value-content').textContent = Array.from({ length: 300 }, (_, i) => `  "field-${i}": ${i},`).join('\n') })
        await page.locator('#cache-value-scroll-host .has-vertical-scrollbar').waitFor()
        assert.equal(await page.locator('#cache-value-scroll-host .monaco-scrollable-element').count(), 1)
        await page.locator('#cache-value-viewport').hover()
        await page.mouse.wheel(0, 400)
        await page.waitForFunction(() => document.getElementById('cache-value-viewport').scrollTop > 0)
        await page.mouse.move(0, 0)
        await page.waitForFunction(() => document.querySelector('#cache-value-scroll-host .scrollbar.vertical').classList.contains('invisible'))
        await page.locator('#cache-value-viewport').focus()
        await page.keyboard.press('Home')
        assert.equal(await page.locator('#cache-value-viewport').evaluate((node) => node.scrollTop), 0)
        const dialogBounds = await page.getByRole('dialog').boundingBox()
        assert.ok(Math.abs(dialogBounds.width - Math.min(1200, 1120 - 48)) < 1 && Math.abs(dialogBounds.height - 860 * 0.8) < 1)
        await page.evaluate(() => { document.getElementById('cache-value-title').textContent = 'workspaceState: ' + 'cache.long-path.'.repeat(12) })
        for (const width of [320, 720, 1120]) {
            await page.setViewportSize({ width, height: 860 })
            const header = await page.locator('#cache-value-dialog > .section-heading').boundingBox()
            const title = await page.locator('#cache-value-title').boundingBox()
            const actions = await page.locator('#cache-value-dialog .actions').boundingBox()
            assert.ok(title.x + title.width <= actions.x, 'Long title wraps before the buttons')
            assert.ok(Math.abs(actions.x + actions.width - header.x - header.width) < 1, 'Buttons remain right aligned')
            assert.ok(Math.abs(actions.y + actions.height / 2 - title.y - title.height / 2) < 1, 'Title and buttons remain vertically centered')
        }

        await page.getByRole('button', { name: 'Open in Editor', exact: true }).click()
        assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), { action: 'development.openCacheEditor', id: 'globalState:runtime.catalog' })
        await page.getByRole('button', { name: 'Close', exact: true }).click()
        assert.equal(await page.getByRole('dialog').isVisible(), false)
        await publish()
        await page.getByRole('button', { name: 'Clear workspaceState caches', exact: true }).click()
        assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), { action: 'development.clearScopeCaches', scope: 'workspaceState' })
        await publish()
        await page.getByRole('button', { name: 'View workspaceState <img src=x onerror=alert(1)>', exact: true }).click()
        assert.equal(await page.locator('#cache-value-dialog script').count(), 0)
        await page.keyboard.press('Escape')
        assert.equal(await page.getByRole('dialog').isVisible(), false)
        await page.screenshot({ path: root + '.build/more-development-caches.png', fullPage: true })
        await page.setViewportSize({ width: 320, height: 900 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        await page.getByRole('tab', { name: 'GitHub', exact: true }).click()
        assert.equal(await page.locator('#panel-development').isVisible(), false)
        assert.equal(await page.locator('#panel-github').isVisible(), true)
        assert.deepEqual(errors, [])
    } finally {
        await browser.close()
    }
})

async function publishPanelState(page, type, state) {
    await page.evaluate(({ type, state }) => new Promise((resolve) => {
        window.addEventListener('message', function received(event) {
            if (event.data?.type !== type) return
            window.removeEventListener('message', received)
            resolve()
        })
        window.postMessage({ type, state }, '*')
    }), { type, state })
}

test('Libraries keeps all cached lists mounted through silent refresh and updates changed data', async () => {
    const browser = await chromium.launch({ channel: process.env.SCAD_BROWSER_CHANNEL || undefined })
    try {
        const page = await browser.newPage({ viewport: { width: 1120, height: 860 } })
        await page.setContent(await libraryFixtureHtml())
        await page.evaluate(() => {
            let saved = {}
            window.acquireVsCodeApi = () => ({ getState: () => saved, setState: (value) => { saved = value }, postMessage() {} })
        })
        await page.addScriptTag({ path: root + 'media/panels/main.js' })
        await page.addScriptTag({ path: root + 'media/panels/libraries.js' })
        const display = structuredClone(state)
        display.global.push({ ...display.global[0], versions: ['v2'], commit: 'b'.repeat(40), key: 'second-version' })
        await publishPanelState(page, 'librariesState', display)
        await page.getByRole('combobox', { name: '<Fixture Library> version' }).selectOption('v2')
        await page.getByRole('searchbox', { name: 'Search registry' }).fill('fixture')
        await page.getByRole('searchbox', { name: 'Search registry' }).press('Tab')
        await page.waitForTimeout(350)
        await page.evaluate(() => {
            window.__lists = [...document.querySelectorAll('.library-list')]
            window.__cards = [...document.querySelectorAll('.library-card')]
            window.__listMutations = 0
            const observer = new MutationObserver((records) => { window.__listMutations += records.length })
            for (const list of window.__lists) observer.observe(list.parentElement, { childList: true, subtree: true })
            window.__listObserver = observer
        })
        for (const extra of [{ registryBusy: true }, { registryBusy: true }, {}, { registryError: 'Temporary refresh failure' }, {}]) {
            await publishPanelState(page, 'librariesState', { ...display, ...extra })
        }
        assert.equal(await page.evaluate(() => window.__listMutations), 0, 'Repeated states, warm loading and refresh errors must not replace cached cards')
        assert.equal(await page.evaluate(() => window.__cards.every((card) => card.isConnected)), true)
        assert.equal(await page.getByRole('combobox', { name: '<Fixture Library> version' }).inputValue(), 'v2')
        assert.equal(await page.getByRole('searchbox', { name: 'Search registry' }).inputValue(), 'fixture')
        assert.equal(await page.locator('#library-tab-global .count').textContent(), '1', 'A preserved Global list keeps its grouped count')
        await page.evaluate(() => window.__listObserver.disconnect())
        display.registry[0].description = 'Updated catalog description'
        await publishPanelState(page, 'librariesState', display)
        assert.equal(await page.locator('#library-panel-registry .library-description').textContent(), 'Updated catalog description')
        await page.getByRole('tab', { name: 'Project', exact: true }).click()
        display.projectDependencies[0].version = 'v2'
        await publishPanelState(page, 'librariesState', display)
        assert.equal(await page.locator('#library-panel-project select').inputValue(), 'v2')
        await publishPanelState(page, 'librariesState', { ...display, busy: true, cancellable: true, message: 'Installing…' })
        assert.equal(await page.getByRole('button', { name: 'Remove', exact: true }).isDisabled(), true, 'Real mutation state still updates actions')
    } finally {
        await browser.close()
    }
})

test('Runtime preserves identical version rows and cached counts while refreshing catalogs', async () => {
    const browser = await chromium.launch({ channel: process.env.SCAD_BROWSER_CHANNEL || undefined })
    try {
        const page = await browser.newPage({ viewport: { width: 1120, height: 860 } })
        await page.setContent((await libraryFixtureHtml()).replace('data-page="libraries"', 'data-page="runtime"'))
        await page.evaluate(() => {
            let saved = { runtimeTab: 'available' }
            window.acquireVsCodeApi = () => ({ getState: () => saved, setState: (value) => { saved = value }, postMessage() {} })
        })
        await page.addScriptTag({ path: root + 'media/panels/main.js' })
        const runtime = {
            busy: false, refreshingSilently: false, message: '', buildsError: '', buildsBusy: false, buildsLoaded: true,
            activeId: 'local', system: { name: 'macOS', version: '15', architecture: 'arm64' },
            runtimes: [{ id: 'local', version: '2026.11', channel: 'Stable', source: 'managed', command: { executable: '/runtime/openscad', argsPrefix: [] } }],
            builds: [{ id: 42, release: 'OpenSCAD 2026.11', tag: 'openscad-2026.11', channel: 'Stable', size: 123456 }],
            installedBuildIds: [],
        }
        await publishPanelState(page, 'runtimeState', runtime)
        const action = page.locator('#builds button')
        await action.focus()
        await page.evaluate(() => {
            window.__runtimeRows = [...document.querySelectorAll('#runtimes > *, #builds > *')]
            window.__runtimeMutations = 0
            const observer = new MutationObserver((records) => { window.__runtimeMutations += records.length })
            for (const id of ['runtimes', 'builds']) observer.observe(document.getElementById(id), { childList: true, subtree: true })
            window.__runtimeObserver = observer
        })
        for (const extra of [{ buildsBusy: true }, { buildsBusy: true }, {}, { buildsError: 'Temporary refresh failure' }, {}]) {
            await publishPanelState(page, 'runtimeState', { ...runtime, ...extra })
            assert.equal(await page.locator('#available-count').textContent(), '1')
            assert.equal(await page.locator('#refresh-builds').textContent(), 'Refresh')
            assert.equal(await page.locator('#builds-loading').isVisible(), false)
        }
        assert.equal(await page.evaluate(() => window.__runtimeMutations), 0)
        assert.equal(await page.evaluate(() => window.__runtimeRows.every((row) => row.isConnected)), true)
        assert.equal(await action.evaluate((node) => node === document.activeElement), true)
        await page.evaluate(() => window.__runtimeObserver.disconnect())
        await publishPanelState(page, 'runtimeState', { ...runtime, installedBuildIds: [42] })
        assert.equal(await page.locator('#builds button').textContent(), 'Reinstall', 'Actual installation state replaces changed rows')
        await publishPanelState(page, 'runtimeState', { ...runtime, builds: [], buildsBusy: true, buildsLoaded: false })
        assert.equal(await page.locator('#builds-loading').isVisible(), true, 'Cold startup still indicates loading')
    } finally {
        await browser.close()
    }
})
