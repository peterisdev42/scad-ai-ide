import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import { readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join, dirname, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import MarkdownIt from 'markdown-it'
import { Worker } from 'node:worker_threads'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const { darkMarkdownTheme, lightMarkdownTheme } = require('../out/test/fixtures/markdownTheme.js')
let model
let browser
before(async () => {
    const worker = new Worker(join(root, 'dist/csg-worker.mjs'))
    try {
        const result = await new Promise((resolve, reject) => {
            worker.once('message', resolve)
            worker.once('error', reject)
            worker.postMessage('difference(){cube(size=[20,20,20],center=true);cylinder(h=30,r1=5,r2=5,center=true,$fn=32);}')
        })
        if (result.error) throw new Error(result.error)
        model = JSON.stringify({ format: 'csg', content: Buffer.from(JSON.stringify(result.scene)).toString('base64') })
    } finally {
        await worker.terminate()
    }
    browser = await chromium.launch({ headless: true, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [], executablePath: process.env.SCAD_CHROMIUM_EXECUTABLE || undefined })
})
after(async () => browser?.close())

async function fixture(t, { trusted = true, broken = false, sourceText } = {}) {
    const { ScadHighlighter } = require('../out/features/markdown/ScadHighlighter.js')
    const highlighter = new ScadHighlighter()
    await highlighter.initialize(require.resolve('vscode-oniguruma/release/onig.wasm'))
    const subscriptions = []
    const disposable = { dispose() {} }
    const noop = () => disposable
    let theme = darkMarkdownTheme
    let themeChanged
    const file = join(root, 'out/features/markdown/registerMarkdown.js')
    const sandbox = {
        exports: {},
        setTimeout,
        clearTimeout,
        require: (name) => {
            if (name === './ScadTheme') return { loadScadTheme: async () => theme }
            if (name === './ScadHighlighter')
                return {
                    ScadHighlighter: class {
                        constructor() {
                            return highlighter
                        }
                    },
                }
            if (name === 'vscode')
                return {
                    window: {
                        onDidChangeActiveColorTheme: (callback) => {
                            themeChanged = callback
                            return disposable
                        },
                    },
                    commands: { executeCommand: async () => {} },
                    workspace: {
                        isTrusted: trusted,
                        getConfiguration: () => ({ get: () => true }),
                        onDidGrantWorkspaceTrust: noop,
                        onDidChangeConfiguration: noop,
                        onDidChangeTextDocument: noop,
                        onDidCloseTextDocument: noop,
                        onDidSaveTextDocument: noop,
                    },
                }
            if (name === './ScadModelRenderer')
                return {
                    renderScadModel: async () => {
                        if (broken) throw new Error('Parser error: <unsafe>')
                        return model
                    },
                }
            return name.startsWith('.') ? require(resolve(dirname(file), name)) : require(name)
        },
    }
    runInNewContext(readFileSync(file, 'utf8'), sandbox, { filename: file })
    const api = sandbox.exports.registerMarkdown(
        { subscriptions, extensionPath: root },
        {
            whenReady: async () => {},
            getActiveRuntime: () => ({ command: { executable: '/test/openscad', argsPrefix: [] } }),
            getState: () => ({}),
            onDidChange: noop,
        },
    )
    const md = api.extendMarkdownIt(new MarkdownIt())
    await api.ready
    const source = sourceText ?? '# OpenSCAD\n\n```openscad\ncube(20);\n```\n\n```scad\nsphere(10);\n```'
    const uri = { scheme: 'file', fsPath: '/workspace/readme.md', toString: () => 'file:///workspace/readme.md' }
    const render = () => md.render(source, { currentDocument: uri })
    render()
    await new Promise((resolve) => setImmediate(resolve))
    const html = render()
    const server = createServer((request, response) => {
        const pathname = new URL(request.url, 'http://fixture').pathname
        if (pathname === '/') {
            response.setHeader('Content-Type', 'text/html')
            response.end(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-test'; style-src 'self' 'unsafe-inline'; img-src data:;"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/preview.css"><script nonce="test" src="/preview.js"></script><script nonce="test" src="/dist/markdown-preview.js"></script></head><body class="vscode-dark"><main>${html}</main></body></html>`)
        } else if (pathname === '/theme.css') {
            response.setHeader('Content-Type', 'text/css')
            response.end(`
:root { --vscode-font-family: sans-serif; --vscode-font-size: 13px; --vscode-editor-background: #1f1f1f; --vscode-foreground: #ccc; --vscode-descriptionForeground: #9d9d9d; --vscode-tab-activeBackground: #1f1f1f; --vscode-tab-activeForeground: #fff; --vscode-tab-inactiveBackground: #181818; --vscode-tab-inactiveForeground: #9d9d9d; --vscode-editorGroupHeader-tabsBackground: #181818; --vscode-panel-border: #2b2b2b; --vscode-focusBorder: #0078d4; --vscode-tab-activeBorderTop: #0078d4; }
body { margin: 24px; background: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
pre { padding: 16px; background: var(--vscode-editor-background); }
/* Reproduce Markdown's stock palette: function names/parameters look like text. */
.hljs-title, .hljs-params { color: #dcdcdc; }
.vscode-light .hljs-title, .vscode-light .hljs-params { color: #000; }
body.light { --vscode-editor-background: #fff; --vscode-foreground: #333; --vscode-tab-activeBackground: #fff; --vscode-tab-activeForeground: #333; --vscode-tab-inactiveBackground: #ececec; --vscode-tab-inactiveForeground: #666; --vscode-editorGroupHeader-tabsBackground: #f3f3f3; --vscode-panel-border: #ddd; }
body.contrast { --vscode-contrastBorder: #f38518; --vscode-focusBorder: #f38518; --vscode-tab-activeBorderTop: #f38518; }
`)
        } else if (pathname === '/dist/markdown-preview.js') {
            response.setHeader('Content-Type', 'text/javascript')
            response.end(readFileSync(join(root, 'dist/markdown-preview.js')))
        } else if (pathname === '/preview.js' || pathname === '/preview.css') {
            response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'text/css')
            response.end(readFileSync(join(root, 'media/markdown', pathname.slice(1))))
        } else {
            response.statusCode = 404
            response.end()
        }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } })
    const errors = []
    await page.addInitScript(() => {
        window.cspViolations = []
        document.addEventListener('securitypolicyviolation', (event) => window.cspViolations.push(event.violatedDirective))
    })
    page.on('pageerror', (error) => errors.push(error.message))
    t.after(async () => {
        subscriptions.forEach((item) => item.dispose())
        assert.deepEqual(await page.evaluate(() => window.cspViolations), [])
        await page.close()
        await new Promise((resolve) => server.close(resolve))
        assert.deepEqual(errors, [])
    })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    const blocks = page.locator('[data-scad-block]')
    return {
        page,
        blocks,
        html,
        async setTheme(next) {
            theme = next
            themeChanged()
            await new Promise((resolve) => setImmediate(resolve))
            await page.evaluate((html) => {
                document.querySelector('main').innerHTML = html
                window.dispatchEvent(new CustomEvent('vscode.markdown.updateContent'))
            }, render())
        },
    }
}

test('tabs switch independently with mouse and keyboard and survive Markdown refresh and script reload', async (t) => {
    const { page, blocks, html } = await fixture(t)
    const first = blocks.nth(0)
    const second = blocks.nth(1)
    assert.equal(await first.locator('[data-scad-panel="preview"]').isVisible(), true)
    assert.equal(await first.locator('[data-scad-panel="source"]').isVisible(), false)
    await first.getByRole('tab', { name: 'Source', exact: true }).click()
    assert.equal(await first.locator('[data-scad-panel="preview"]').isVisible(), false)
    assert.equal(await first.locator('pre').isVisible(), true)
    assert.equal(await second.locator('[data-scad-panel="preview"]').isVisible(), true)
    assert.equal(await first.getByRole('tab', { name: 'Source' }).getAttribute('aria-selected'), 'true')
    await page.evaluate((html) => {
        document.querySelector('main').innerHTML = html
        window.dispatchEvent(new CustomEvent('vscode.markdown.updateContent'))
    }, html)
    assert.equal(await first.locator('pre').isVisible(), true, 'CLI completion refresh must retain the Source tab')
    await page.evaluate(() => {
        const script = document.createElement('script')
        script.nonce = 'test'
        script.src = '/preview.js'
        document.body.append(script)
    })
    assert.equal(await first.locator('pre').isVisible(), true)
    await page.evaluate(
        () =>
            new Promise((resolve) => {
                const script = document.createElement('script')
                script.nonce = 'test'
                script.src = '/dist/markdown-preview.js'
                script.onload = resolve
                document.body.append(script)
            }),
    )
    await first.getByRole('tab', { name: 'Source' }).focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await first.getByRole('tab', { name: 'Preview' }).evaluate((tab) => document.activeElement === tab), true)
    assert.equal(await first.locator('pre').isVisible(), false)
    await page.keyboard.press('End')
    assert.equal(await first.locator('pre').isVisible(), true)
    await page.keyboard.press('Home')
    assert.equal(await first.locator('pre').isVisible(), false)
    await page.keyboard.press('ArrowLeft')
    assert.equal(await first.locator('pre').isVisible(), true)
    assert.equal(await first.locator('[tabindex="0"][role="tab"]').count(), 1)
})

test('previews keep a 4:3 aspect ratio, fit narrow windows and use live VS Code theme variables', async (t) => {
    const { page, blocks } = await fixture(t)
    for (const width of [1200, 600, 320]) {
        await page.setViewportSize({ width, height: 1000 })
        const box = await blocks.nth(0).locator('[data-scad-panel="preview"]').boundingBox()
        assert.ok(box.width <= 800 && box.height <= 600)
        assert.ok(Math.abs((box.width * 3) / 4 - box.height) < 1)
        assert.ok(box.x + box.width <= width)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    }
    await page.setViewportSize({ width: 1000, height: 1000 })
    const active = blocks.nth(0).getByRole('tab', { name: 'Preview' })
    assert.equal(await active.evaluate((tab) => getComputedStyle(tab).color), 'rgb(255, 255, 255)')
    await page.evaluate(() => document.body.classList.add('light'))
    assert.equal(await active.evaluate((tab) => getComputedStyle(tab).color), 'rgb(51, 51, 51)')
    await page.evaluate(() => document.body.classList.add('contrast'))
    assert.equal(await blocks.nth(0).evaluate((block) => getComputedStyle(block).borderTopColor), 'rgb(243, 133, 24)')
    if (process.env.SCAD_MARKDOWN_SCREENSHOTS) {
        mkdirSync(process.env.SCAD_MARKDOWN_SCREENSHOTS, { recursive: true })
        await page.evaluate(() => document.body.classList.remove('contrast'))
        await blocks.nth(0).screenshot({ path: join(process.env.SCAD_MARKDOWN_SCREENSHOTS, 'preview-light.png') })
        await page.evaluate(() => document.body.classList.remove('light'))
        await blocks.nth(0).screenshot({ path: join(process.env.SCAD_MARKDOWN_SCREENSHOTS, 'preview-dark.png') })
        await blocks.nth(0).getByRole('tab', { name: 'Source' }).click()
        await blocks.nth(0).screenshot({ path: join(process.env.SCAD_MARKDOWN_SCREENSHOTS, 'source-dark.png') })
    }
})

test('Source tabs display distinct OpenSCAD token colors in dark and light themes', async (t) => {
    const code = 'module part(size = 20) {\n  // comment\n  label = "text";\n  cube(size, center = true);\n}\n'
    const { page, blocks, setTheme } = await fixture(t, { sourceText: `\`\`\`openscad\n${code}\`\`\`\n\n\`\`\`scad\n${code}\`\`\`` })
    for (const block of await blocks.all()) await block.getByRole('tab', { name: 'Source', exact: true }).click()
    const colors = async () =>
        blocks
            .nth(0)
            .locator('.scad-markdown-code')
            .evaluate((code) => Object.fromEntries(['keyword', 'title', 'params', 'number', 'string', 'comment'].map((kind) => [kind, getComputedStyle(code.querySelector(`.hljs-${kind}`)).color])))
    assert.deepEqual(await colors(), { keyword: 'rgb(86, 156, 214)', title: 'rgb(220, 220, 170)', params: 'rgb(156, 220, 254)', number: 'rgb(181, 206, 168)', string: 'rgb(206, 145, 120)', comment: 'rgb(106, 153, 85)' })
    assert.equal(
        await blocks
            .nth(1)
            .locator('.hljs-title')
            .first()
            .evaluate((span) => getComputedStyle(span).color),
        'rgb(220, 220, 170)',
    )
    await page.evaluate(() => {
        document.body.classList.add('light', 'vscode-light')
        document.body.classList.remove('vscode-dark')
    })
    await setTheme(lightMarkdownTheme)
    assert.deepEqual(await colors(), { keyword: 'rgb(0, 0, 255)', title: 'rgb(121, 94, 38)', params: 'rgb(0, 16, 128)', number: 'rgb(9, 134, 88)', string: 'rgb(163, 21, 21)', comment: 'rgb(0, 128, 0)' })
    await setTheme({ settings: [...lightMarkdownTheme.settings, { scope: 'entity.name.function.call.openscad', settings: { foreground: '#123456', fontStyle: 'bold italic underline' } }] })
    assert.equal(await blocks.nth(0).locator('pre').isVisible(), true)
    const call = blocks.nth(0).locator('.hljs-title').filter({ hasText: 'cube' })
    assert.deepEqual(
        await call.evaluate((node) => {
            const style = getComputedStyle(node)
            return [style.color, style.fontStyle, style.fontWeight, style.textDecorationLine]
        }),
        ['rgb(18, 52, 86)', 'italic', '700', 'underline'],
    )
})

for (const mode of [{ trusted: false }, { broken: true }]) {
    test(`source remains accessible with ${mode.trusted === false ? 'an untrusted workspace' : 'a compiler error'}`, async (t) => {
        const { blocks } = await fixture(t, mode)
        assert.match(await blocks.nth(0).locator('[role="status"]').innerText(), mode.trusted === false ? /Trust/ : /Parser error: <unsafe>/)
        await blocks.nth(0).getByRole('tab', { name: 'Source' }).click()
        assert.equal(await blocks.nth(0).locator('pre').isVisible(), true)
        assert.equal(await blocks.nth(0).locator('[role="status"]').isVisible(), false)
    })
}

test('embedded native Preview rotates independently, pauses outside the viewport, disposes and restores its camera', async (t) => {
    const { page, blocks } = await fixture(t)
    const first = blocks.nth(0)
    await first.locator('scad-preview canvas.main-canvas').waitFor()
    await page.waitForFunction(() => document.querySelector('scad-app')?.shadowRoot.querySelector('scad-preview')?.stage?.modelGroup.children.length > 0)
    assert.equal(await first.locator('iframe, img').count(), 0)
    assert.equal(await first.getByRole('switch', { name: 'CSG preview', exact: true }).count(), 1)
    const second = blocks.nth(1)
    await second.locator('scad-preview canvas.main-canvas').waitFor()
    await page.waitForFunction(() => Array.from(document.querySelectorAll('scad-app')).every((app) => app.shadowRoot.querySelector('scad-preview')?.stage?.modelGroup.children.length > 0))
    const secondCamera = await second.locator('scad-preview').evaluate((preview) => preview.stage.serializeProperties().get('camera-default'))
    const before = await first.locator('scad-preview').evaluate((preview) => preview.stage.serializeProperties().get('camera-default'))
    const box = await first.locator('canvas.main-canvas').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30)
    await page.mouse.up({ button: 'middle' })
    const camera = await first.locator('scad-preview').evaluate((preview) => {
        window.embeddedStage = preview.stage
        return preview.stage.serializeProperties().get('camera-default')
    })
    assert.notDeepEqual(camera, before)
    assert.deepEqual(await second.locator('scad-preview').evaluate((preview) => preview.stage.serializeProperties().get('camera-default')), secondCamera)
    await first.getByRole('tab', { name: 'Source', exact: true }).click()
    const frames = await page.evaluate(() => window.embeddedStage.renderer.info.calls)
    await page.waitForTimeout(150)
    assert.equal(await page.evaluate(() => window.embeddedStage.renderer.info.calls), frames)
    await page.waitForFunction(() => window.embeddedStage.disposed)
    assert.equal(await first.locator('scad-app').count(), 0)
    await first.getByRole('tab', { name: 'Preview', exact: true }).click()
    await first.locator('scad-preview canvas.main-canvas').waitFor()
    await page.waitForFunction((camera) => {
        const app = document.querySelector('scad-app')
        const current = app?.shadowRoot.querySelector('scad-preview')?.stage?.serializeProperties().get('camera-default')
        return JSON.stringify(current) === JSON.stringify(camera)
    }, camera)
    await first.locator('scad-preview').evaluate((preview) => {
        window.embeddedStage = preview.stage
    })
    await page.evaluate(() => {
        const spacer = document.createElement('div')
        spacer.style.height = '2000px'
        document.body.append(spacer)
        window.scrollTo(0, document.body.scrollHeight)
    })
    await page.waitForFunction(() => window.embeddedStage.paused)
    const offscreenFrames = await page.evaluate(() => window.embeddedStage.renderer.info.calls)
    await page.waitForTimeout(150)
    assert.equal(await page.evaluate(() => window.embeddedStage.renderer.info.calls), offscreenFrames)
    await page.waitForFunction(() => window.embeddedStage.disposed)
    await page.evaluate(() => window.scrollTo(0, 0))
    await first.locator('scad-preview canvas.main-canvas').waitFor()
    assert.ok((await page.locator('scad-app').count()) <= 2)
})

test('three visible Markdown blocks never allocate more than two native viewer instances', async (t) => {
    const { page, blocks } = await fixture(t, { sourceText: Array.from({ length: 3 }, (_, i) => `\`\`\`scad\ncube(${i + 1});\n\`\`\``).join('\n\n') })
    await page.setViewportSize({ width: 800, height: 2100 })
    await page.locator('scad-app').nth(1).waitFor()
    assert.equal(await page.locator('scad-app').count(), 2)
    await blocks.nth(0).getByRole('tab', { name: 'Source', exact: true }).click()
    await blocks.nth(2).locator('scad-app').waitFor()
    assert.equal(await page.locator('scad-app').count(), 2)
    assert.equal(await blocks.nth(0).locator('scad-app').count(), 0)
})

test('late Markdown DOM replacement mounts ready previews without an updateContent event', async (t) => {
    const { page, blocks, html } = await fixture(t)
    await blocks.nth(0).locator('scad-preview canvas.main-canvas').waitFor()
    await page.evaluate(() => {
        document.querySelector('main').replaceChildren()
    })
    await page.waitForFunction(() => document.querySelectorAll('scad-app').length === 0)
    await page.evaluate((html) => {
        document.querySelector('main').innerHTML = html
    }, html)
    await blocks.nth(0).locator('scad-preview canvas.main-canvas').waitFor()
    await page.waitForFunction(() => document.querySelector('scad-app')?.shadowRoot.querySelector('scad-preview')?.stage?.modelGroup?.children.length > 0)
})
