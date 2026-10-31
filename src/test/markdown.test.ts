import { renderOwnedMarkdown } from '../features/markdown/OwnedMarkdownRenderer'
import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import MarkdownIt from 'markdown-it'
import { ScadModelCache } from '../features/markdown/ScadModelCache'
import { renderScadModel } from '../features/markdown/ScadModelRenderer'
import type { PreviewMode } from '../features/preview/shared/types/PreviewMode'
import type { LaunchCommand } from '../core/runtime/types'
import type { registerMarkdown } from '../features/markdown/registerMarkdown'
import { ScadHighlighter } from '../features/markdown/ScadHighlighter'
import { darkMarkdownTheme } from './fixtures/markdownTheme'

const mesh = Buffer.from('solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 20 0 0\nvertex 0 20 0\nendloop\nendfacet\nendsolid test\n')

async function waitFor(check: () => boolean | Promise<boolean>) {
    for (let i = 0; i < 200; i++) {
        if (await check()) return
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.fail('Timed out waiting for Markdown rendering')
}

test('model cache deduplicates blocks, serializes CLI work and caches errors until invalidated', async () => {
    const calls: string[] = []
    let changed = 0
    const cache = new ScadModelCache(
        async (source) => {
            calls.push(source)
            await new Promise((resolve) => setImmediate(resolve))
            if (source === 'broken') throw new Error('Parser error')
            return 'cached-model'
        },
        () => changed++,
    )
    try {
        assert.equal(cache.request('doc', 'cube(20);', '/docs').status, 'pending')
        cache.request('doc', 'cube(20);', '/docs')
        cache.request('doc', 'broken', '/docs')
        await waitFor(() => changed === 2)
        assert.deepEqual(calls, ['cube(20);', 'broken'])
        assert.equal(cache.request('doc', 'cube(20);', '/docs').status, 'ready')
        assert.deepEqual(cache.request('doc', 'broken', '/docs'), { status: 'error', message: 'Parser error' })
        cache.request('other', 'cube(20);', '/other')
        await waitFor(() => changed === 3)
        cache.invalidate('doc')
        assert.equal(cache.request('other', 'cube(20);', '/other').status, 'ready')
        cache.request('doc', 'cube(20);', '/docs')
        await waitFor(() => changed === 4)
        assert.equal(calls.length, 4)
    } finally {
        cache.dispose()
    }
})

test('invalidating a running model aborts it, skips queued work and suppresses stale updates', async () => {
    let started = 0
    let changed = 0
    const cache = new ScadModelCache(
        (_source, _cwd, signal) =>
            new Promise((resolve) => {
                started++
                signal.addEventListener('abort', () => resolve('stale-model'), { once: true })
            }),
        () => changed++,
    )
    cache.request('doc', 'cube(1);', '/docs')
    cache.request('doc', 'sphere(1);', '/docs')
    await waitFor(() => started === 1)
    cache.invalidate('doc')
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(changed, 0)
    assert.equal(started, 1)
    cache.dispose()
    assert.equal(cache.request('doc', 'cube(2);', '/docs').status, 'error')
})

test('Mesh CLI rendering preserves command prefixes, stdin and relative working directory; cleans up on errors and cancellation', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'scad-markdown-test-'))
    const script = path.join(directory, 'cli.cjs')
    const trace = path.join(directory, 'trace.json')
    await writeFile(
        script,
        `
const fs = require('node:fs');
const args = process.argv.slice(2);
const output = args[args.indexOf('-o') + 1];
let source = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => source += chunk);
process.stdin.on('end', () => {
    fs.writeFileSync(${JSON.stringify(trace)}, JSON.stringify({ args, output, source, cwd: process.cwd() }));
    if (source === 'hang') { setInterval(() => {}, 1000); return; }
    if (source === 'broken') { process.stderr.write('ERROR: Parser error <unsafe>'); process.exitCode = 1; return; }
    fs.writeFileSync(output, source === 'invalid' ? Buffer.alloc(0) : Buffer.from(${JSON.stringify(mesh.toString('base64'))}, 'base64'));
});
`,
    )
    const command: LaunchCommand = { executable: process.execPath, argsPrefix: [script, '--fixture-prefix'] }
    const render = (source: string, signal = new AbortController().signal, mode: PreviewMode = 'render') => renderScadModel(command, source, directory, signal, mode)
    const readTrace = async () => JSON.parse(await readFile(trace, 'utf8')) as { args: string[]; output: string; source: string; cwd: string }
    const assertCleaned = async () => {
        const { output } = await readTrace()
        await assert.rejects(readFile(output), { code: 'ENOENT' })
    }
    try {
        const model = JSON.parse(await render('cube(20);'))
        assert.equal(model.format, 'stl')
        assert.equal(model.content, mesh.toString('base64'))
        assert.equal(model.backend.kind, 'mesh')
        assert.ok(model.backend.elapsedMs >= 0)
        const result = await readTrace()
        assert.equal(result.source, 'cube(20);')
        assert.equal(result.cwd, await import('node:fs/promises').then((fs) => fs.realpath(directory)))
        assert.deepEqual(result.args, ['--fixture-prefix', '-d', path.join(path.dirname(result.output), 'model.d'), '--export-format', 'stl', '-o', result.output, '-'])
        await render('cube(20);', undefined, 'render')
        const full = await readTrace()
        assert.ok(full.args.includes('stl'))
        assert.ok(!full.args.includes('$preview=true'))
        await assertCleaned()
        await assert.rejects(render('broken'), /Parser error <unsafe>/)
        await assertCleaned()
        await assert.rejects(render('invalid'), /empty preview/)
        await assertCleaned()
        const controller = new AbortController()
        const pending = assert.rejects(render('hang', controller.signal))
        await waitFor(async () => (await readTrace()).source === 'hang')
        controller.abort()
        await pending
        await assertCleaned()
        await assert.rejects(render('cube(20);', controller.signal))
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

async function mockMarkdown() {
    const highlighter = new ScadHighlighter()
    await highlighter.initialize(require.resolve('vscode-oniguruma/release/onig.wasm'))
    const file = path.join(__dirname, '../features/markdown/registerMarkdown.js')
    const subscriptions: { dispose(): void }[] = []
    const listeners = new Map<string, (event?: any) => void>()
    const listen = (name: string) => (handler: (event: any) => void) => {
        listeners.set(name, handler)
        return { dispose() {} }
    }
    const renders: { command: LaunchCommand; source: string; cwd: string; mode: PreviewMode }[] = []
    const state = { trusted: true, enabled: true, renderMode: 'preview' as PreviewMode, active: { id: 'managed', version: '1', command: { executable: '/managed/openscad', argsPrefix: ['--prefix'] } }, runtime: { busy: false } }
    let refreshes = 0
    const mock = {
        window: { onDidChangeActiveColorTheme: listen('theme') },
        commands: {
            executeCommand: async () => {
                refreshes++
            },
        },
        workspace: {
            get isTrusted() {
                return state.trusted
            },
            getConfiguration: () => ({ get: (key: string) => (key === 'renderMode' ? state.renderMode : state.enabled) }),
            onDidGrantWorkspaceTrust: listen('trust'),
            onDidChangeConfiguration: listen('config'),
            onDidChangeTextDocument: listen('edit'),
            onDidCloseTextDocument: listen('close'),
            onDidSaveTextDocument: listen('save'),
        },
    }
    const sandbox = {
        exports: {} as { registerMarkdown: typeof registerMarkdown },
        setTimeout,
        clearTimeout,
        require: (id: string) => {
            if (id === 'vscode') return mock
            if (id === './ScadTheme') return { loadScadTheme: async () => darkMarkdownTheme }
            if (id === './ScadHighlighter')
                return {
                    ScadHighlighter: class {
                        constructor() {
                            return highlighter
                        }
                    },
                }
            if (id === './ScadModelRenderer')
                return {
                    renderScadModel: async (command: LaunchCommand, source: string, cwd: string, _signal: AbortSignal, mode: PreviewMode) => {
                        renders.push({ command, source, cwd, mode })
                        if (source.includes('broken')) throw new Error('Parser error: <script>alert(1)</script>')
                        return JSON.stringify({ format: 'stl', content: mesh.toString('base64') })
                    },
                }
            return id.startsWith('.') ? require(path.resolve(path.dirname(file), id)) : require(id)
        },
    }
    vm.runInNewContext(await readFile(file, 'utf8'), sandbox, { filename: file })
    const api = sandbox.exports.registerMarkdown(
        { subscriptions, extensionPath: path.resolve(__dirname, '../..') } as any,
        {
            whenReady: async () => {},
            getActiveRuntime: () => state.active,
            getState: () => state.runtime,
            onDidChange: listen('runtime'),
        } as any,
    )
    const md = api.extendMarkdownIt(new MarkdownIt())
    await api.ready
    const uri = { scheme: 'file', fsPath: '/workspace/docs/readme.md', path: '/workspace/docs/readme.md', toString: () => 'file:///workspace/docs/readme.md' }
    return { md, state, renders, listeners, uri, refreshes: () => refreshes, dispose: () => subscriptions.forEach((item) => item.dispose()) }
}

test('Markdown fences support both aliases and capitalization, preserve code and other languages, and embed cached interactive models', async () => {
    const mock = await mockMarkdown()
    try {
        const source = '```openscad\ncube(20);\n```\n\n```scad\ncube(20);\n```\n\n```OpenSCAD title\nsphere(10);\n```\n\n```js\ncube(20);\n```'
        const render = () => mock.md.render(source, { currentDocument: mock.uri })
        const initial = render()
        assert.equal((initial.match(/Rendering OpenSCAD/g) ?? []).length, 3)
        assert.match(initial, /language-openscad/)
        assert.match(initial, /language-js/)
        const groups = [...initial.matchAll(/data-scad-block="([^"]+)"/g)]
        assert.equal(groups.length, 3)
        assert.equal(new Set(groups.map((match) => match[1])).size, 3, 'Identical snippets need independent tab groups')
        assert.equal((initial.match(/data-scad-tab="preview" aria-selected="true"/g) ?? []).length, 3)
        assert.equal((initial.match(/data-scad-panel="source"[^>]* hidden/g) ?? []).length, 3)
        await waitFor(() => mock.refreshes() === 1)
        const ready = render()
        assert.equal((ready.match(/data-scad-model=/g) ?? []).length, 3)
        assert.match(ready, /class="scad-markdown-viewer"/)
        assert.match(ready, /class="hljs-title"[^>]*>cube<\/span>/)
        assert.match(ready, /class="hljs-number"[^>]*>20<\/span>/)
        assert.equal(mock.renders.length, 2, 'Identical source in the same document shares a render')
        assert.equal(mock.renders[0].cwd, '/workspace/docs')
        assert.equal(mock.renders[0].command, mock.state.active.command)
        assert.equal(mock.renders[0].mode, 'preview')
        mock.listeners.get('runtime')!()
        render()
        assert.equal(mock.renders.length, 2, 'Unchanged Runtime does not invalidate cached models')
        mock.state.active = { ...mock.state.active, version: '2' }
        mock.listeners.get('runtime')!()
        assert.match(render(), /Rendering OpenSCAD/)
        await waitFor(() => mock.renders.length === 4)
        mock.listeners.get('edit')!({ document: { languageId: 'markdown', uri: mock.uri }, contentChanges: [] })
        await new Promise((resolve) => setImmediate(resolve))
        assert.match(render(), /data-scad-model=/, 'Dirty-state changes do not invalidate renders')
        mock.listeners.get('edit')!({ document: { languageId: 'markdown', uri: mock.uri }, contentChanges: [{}] })
        assert.match(render(), /Rendering OpenSCAD/)
    } finally {
        mock.dispose()
    }
})

test('preview highlighting reuses OpenSCAD scopes, preserves multiline state and escapes code', async () => {
    const highlighter = new ScadHighlighter()
    const md = new MarkdownIt()
    try {
        await highlighter.initialize(require.resolve('vscode-oniguruma/release/onig.wasm'))
        const source = 'module part(size = 20) {\n  /* comment\n  cube(99); */\n  label = "<script>";\n  if (true) cube(size, center = false);\n}\n'
        const html = highlighter.highlight(source, md.utils.escapeHtml)
        assert.match(html, /hljs-keyword"[^>]*>module<\/span>/)
        assert.match(html, /hljs-title"[^>]*>part<\/span>/)
        assert.match(html, /hljs-params"[^>]*>size<\/span>/)
        assert.match(html, /hljs-comment"[^>]*>  cube\(99\); <\/span>/)
        assert.match(html, /hljs-string"[^>]*>&lt;script&gt;/)
        assert.match(html, /hljs-literal"[^>]*>true<\/span>/)
        assert.doesNotMatch(html, /<script>/)
        assert.equal(md.utils.unescapeAll(html.replace(/<\/?span[^>]*>/g, '')), source)
        assert.match(highlighter.highlight('cube(2);', md.utils.escapeHtml), /hljs-title/, 'Each code block starts with fresh multiline state')
    } finally {
        highlighter.dispose()
    }
})

test('preview resolves the selected theme includes and user token overrides instead of hard-coded colors', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'scad-theme-'))
    const highlighter = new ScadHighlighter()
    try {
        await writeFile(path.join(directory, 'base.json'), '{ // JSONC theme\n "colors": {"editor.foreground":"#ccc"}, "tokenColors": [{"scope":"keyword.control","settings":{"foreground":"#987654"}}, {"scope":"comment","settings":{"foreground":"#111111"}}], }')
        await writeFile(path.join(directory, 'theme.json'), JSON.stringify({ include: './base.json', tokenColors: [{ scope: 'entity.name.function', settings: { foreground: '#654321' } }] }))
        const mock = {
            window: { activeColorTheme: { kind: 2 } },
            ColorThemeKind: { Light: 1, HighContrastLight: 4 },
            extensions: { all: [{ extensionPath: directory, packageJSON: { contributes: { themes: [{ id: 'Custom SCAD', label: 'Custom', path: './theme.json' }] } } }] },
            workspace: {
                getConfiguration: (section: string) => ({
                    get: (key: string, fallback: unknown) => {
                        if (key === 'colorTheme') return 'Custom SCAD'
                        if (key === 'colorCustomizations') return { '[Custom*]': { 'editor.foreground': '#123' } }
                        if (key === 'tokenColorCustomizations') return { comments: '#778899', '[Custom SCAD]': { textMateRules: [{ scope: 'entity.name.function.call.openscad', settings: { foreground: '#ABCDEF', fontStyle: 'italic bold underline' } }] }, '[Other]': { comments: '#FF0000' } }
                        return fallback
                    },
                }),
            },
        }
        const sandbox = { exports: {} as typeof import('../features/markdown/ScadTheme'), require: (id: string) => (id === 'vscode' ? mock : require(id)) }
        const file = path.join(__dirname, '../features/markdown/ScadTheme.js')
        vm.runInNewContext(await readFile(file, 'utf8'), sandbox, { filename: file })
        const theme = await sandbox.exports.loadScadTheme()
        assert.equal(theme.settings[0].settings.foreground, '#112233')
        await highlighter.initialize(require.resolve('vscode-oniguruma/release/onig.wasm'))
        highlighter.setTheme(theme)
        const html = highlighter.highlight('if (true) cube(20); // comment', new MarkdownIt().utils.escapeHtml)
        assert.match(html, /style="color:#987654;[^>]*>if<\/span>/)
        assert.match(html, /style="color:#ABCDEF;font-style:italic;font-weight:bold;text-decoration:underline">cube<\/span>/)
        assert.match(html, /style="color:#778899;[^>]*>\/\//)
        assert.doesNotMatch(html, /color:#FF0000/i)
    } finally {
        highlighter.dispose()
        await rm(directory, { recursive: true, force: true })
    }
})

test('Markdown rendering respects trust, disabled settings and document context; compiler errors are escaped', async () => {
    const mock = await mockMarkdown()
    try {
        const source = '```scad\nbroken();\n```'
        const render = () => mock.md.render(source, { currentDocument: mock.uri })
        assert.doesNotMatch(mock.md.render(source), /scad-markdown-(block|preview|status)/)
        mock.state.trusted = false
        assert.match(render(), /Trust this workspace/)
        assert.equal(mock.renders.length, 0)
        mock.state.trusted = true
        mock.state.enabled = false
        assert.doesNotMatch(render(), /scad-markdown-(block|preview|status)/)
        mock.state.enabled = true
        assert.match(render(), /Rendering OpenSCAD/)
        await waitFor(() => mock.refreshes() === 1)
        const error = render()
        assert.match(error, /&lt;script&gt;/)
        assert.doesNotMatch(error, /<script>/)
        render()
        assert.equal(mock.renders.length, 1, 'Errors are cached instead of causing a render loop')
        mock.listeners.get('save')!({ languageId: 'openscad', uri: { path: '/workspace/docs/part.scad' } })
        assert.match(render(), /Rendering OpenSCAD/)
    } finally {
        mock.dispose()
    }
})

test('tab containers keep the Markdown source mapping visible without changing cached fence tokens', async () => {
    const mock = await mockMarkdown()
    try {
        const env = { currentDocument: mock.uri }
        const tokens = mock.md.parse('```scad\ncube(20);\n```', env)
        const token = tokens[0]
        token.attrSet('data-line', '0')
        token.attrSet('class', 'code-line hljs')
        const originalAttrs = JSON.stringify(token.attrs)
        const html = mock.md.renderer.render(tokens, mock.md.options, env)
        assert.match(html, /class="scad-markdown-block code-line"[^>]*data-line="0"/)
        assert.doesNotMatch(html, /<pre[^>]*(data-line|code-line)/)
        assert.match(html, /<code[^>]*class="hljs language-scad"/)
        assert.equal(JSON.stringify(token.attrs), originalAttrs)
    } finally {
        mock.dispose()
    }
})

test('switching CLI preview mode invalidates model results and recompiles with the selected mode', async () => {
    const mock = await mockMarkdown()
    try {
        const render = () => mock.md.render('```scad\ncube(20);\n```', { currentDocument: mock.uri })
        render()
        await waitFor(() => mock.refreshes() === 1)
        assert.equal(mock.renders[0].mode, 'preview')
        assert.match(render(), /data-scad-model=/)
        mock.state.renderMode = 'render'
        mock.listeners.get('config')!({ affectsConfiguration: (section: string) => section === 'scad-ai-ide.markdown.preview' })
        assert.match(render(), /Rendering OpenSCAD/)
        await waitFor(() => mock.renders.length === 2)
        assert.equal(mock.renders[1].mode, 'render')
    } finally {
        mock.dispose()
    }
})

test('owned Markdown escapes source and diagnostics while preserving stable model slots', () => {
    const source = '# Heading\n\n```scad\ncube(20); // <script>\n```\n\n![part](part.png)'
    const render = (text: string) =>
        renderOwnedMarkdown(
            text,
            (id) => ({ message: `<unsafe ${id}>` }),
            (text) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
            (url) => `webview:${url}`,
        )
    const before = render(source),
        after = render(`Paragraph before heading\n\n${source}`)
    assert.match(before, /data-scad-block="scad-owned-0"/)
    assert.match(after, /data-scad-block="scad-owned-0"/)
    assert.ok(!before.includes('<script>'))
    assert.ok(!before.includes('<unsafe'))
    assert.match(before, /src="webview:part.png"/)
})

test('editing Markdown keeps unchanged source cache entries and cancels removed work', async () => {
    let calls = 0
    const cache = new ScadModelCache(
        async () => `model-${++calls}`,
        () => {},
    )
    try {
        cache.request('doc', 'cube(20);', '/docs')
        cache.request('doc', 'sphere(5);', '/docs')
        await waitFor(() => calls === 2)
        cache.retainDocumentSources('doc', ['cube(20);'], '/docs')
        assert.equal(cache.request('doc', 'cube(20);', '/docs').status, 'ready')
        assert.equal(cache.request('doc', 'sphere(5);', '/docs').status, 'pending')
        await waitFor(() => calls === 3)
    } finally {
        cache.dispose()
    }
})
