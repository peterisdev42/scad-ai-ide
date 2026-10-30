import * as assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { activate } from '../extension'

suite('Markdown preview integration', () => {
    test('Source follows the active editor theme and theme-specific token customizations', async () => {
        const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')!
        await extension.activate()
        const workbench = vscode.workspace.getConfiguration('workbench')
        const editor = vscode.workspace.getConfiguration('editor')
        const previousTheme = workbench.inspect('colorTheme')?.globalValue
        const previousTokens = editor.inspect('tokenColorCustomizations')?.globalValue
        const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: '```scad\nif (true) cube(20);\n```' })
        const themes = vscode.extensions.all.flatMap((extension) => extension.packageJSON.contributes?.themes ?? []) as { id?: string; label?: string; path: string }[]
        const dark = themes.find((theme) => theme.path.endsWith('/dark_plus.json'))!
        const light = themes.find((theme) => theme.path.endsWith('/light_plus.json'))!
        assert.ok(dark && light)
        const renderUntil = async (pattern: RegExp) => {
            const deadline = Date.now() + 5000
            let html = ''
            do {
                html = (await vscode.commands.executeCommand<string>('markdown.api.render', document)) ?? ''
                if (pattern.test(html)) return html
                await new Promise((resolve) => setTimeout(resolve, 25))
            } while (Date.now() < deadline)
            assert.match(html, pattern)
            return html
        }
        try {
            await editor.update('tokenColorCustomizations', {}, vscode.ConfigurationTarget.Global)
            await workbench.update('colorTheme', dark.id ?? dark.label, vscode.ConfigurationTarget.Global)
            await renderUntil(/color:#C586C0;[^>]*>if<\/span>/)
            await workbench.update('colorTheme', light.id ?? light.label, vscode.ConfigurationTarget.Global)
            await renderUntil(/color:#AF00DB;[^>]*>if<\/span>/)
            await editor.update('tokenColorCustomizations', { [`[${light.id ?? light.label}]`]: { textMateRules: [{ scope: 'entity.name.function.call.openscad', settings: { foreground: '#123456', fontStyle: 'bold italic' } }] } }, vscode.ConfigurationTarget.Global)
            await renderUntil(/color:#123456;font-style:italic;font-weight:bold;[^>]*>cube<\/span>/)
        } finally {
            await workbench.update('colorTheme', previousTheme, vscode.ConfigurationTarget.Global)
            await editor.update('tokenColorCustomizations', previousTokens, vscode.ConfigurationTarget.Global)
        }
    })

    test('the built-in Markdown engine renders both fence aliases through the selected CLI', async function () {
        if (process.platform === 'win32') this.skip()
        const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'scad-markdown-editor-')))
        const uri = vscode.Uri.file(path.join(directory, 'readme.md'))
        const cli = path.join(directory, 'openscad')
        const trace = path.join(directory, 'source.scad')
        const config = vscode.workspace.getConfiguration('scad-ai-ide')
        const previousPath = config.inspect('openscadPath')?.globalValue
        const previousCommand = config.inspect('runtimeCommand')?.globalValue
        const previousEnabled = config.inspect('markdown.preview.enabled')?.globalValue
        const previousMode = config.inspect('markdown.preview.renderMode')?.globalValue
        const source = '```openscad\ncube(20);\n```\n\n```scad\ncube(20);\n```\n'
        const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

        try {
            await writeFile(
                cli,
                `#!/bin/sh
if [ "$1" = "--fixture-prefix" ] && [ "$2" = "--version" ]; then echo "OpenSCAD version 2026.10.TEST"; exit 0; fi
/bin/cat > ${shellQuote(trace)}
/bin/pwd > ${shellQuote(trace + '.cwd')}
for arg in "$@"; do printf '%s\\n' "$arg"; done > ${shellQuote(trace + '.args')}
while [ "$#" -gt 0 ]; do
    if [ "$1" = "-o" ]; then shift; output="$1"; fi
    shift
done
printf 'cube(size=[20,20,20],center=false);' > "$output"
`,
                { mode: 0o755 },
            )
            await writeFile(uri.fsPath, source)
            await config.update('openscadPath', '', vscode.ConfigurationTarget.Global)
            await config.update('runtimeCommand', { executable: cli, argsPrefix: ['--fixture-prefix'] }, vscode.ConfigurationTarget.Global)
            await config.update('markdown.preview.enabled', true, vscode.ConfigurationTarget.Global)
            await config.update('markdown.preview.renderMode', 'preview', vscode.ConfigurationTarget.Global)
            const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')
            assert.ok(extension)
            const api = (await extension.activate()) as Awaited<ReturnType<typeof activate>>
            await api.refresh()
            const document = await vscode.workspace.openTextDocument(uri)
            const firstHtml = await vscode.commands.executeCommand<string>('markdown.api.render', document)
            assert.match(firstHtml ?? '', /class="scad-markdown-code"/, 'The very first render must already be highlighted without waiting for a preview refresh')
            await vscode.window.showTextDocument(document)
            await vscode.commands.executeCommand('markdown.showPreviewToSide', uri)
            let html = ''
            const deadline = Date.now() + 10000
            do {
                html = (await vscode.commands.executeCommand<string>('markdown.api.render', document)) ?? ''
                if ((html.match(/data-scad-model=/g) ?? []).length === 2 && html.includes('class="hljs-title"')) break
                await new Promise((resolve) => setTimeout(resolve, 50))
            } while (Date.now() < deadline)
            assert.equal((html.match(/data-scad-model=/g) ?? []).length, 2, html)
            assert.equal((html.match(/role="tablist"/g) ?? []).length, 2)
            assert.equal((html.match(/data-scad-tab="preview" aria-selected="true"/g) ?? []).length, 2)
            assert.equal((html.match(/data-scad-panel="source"[^>]* hidden/g) ?? []).length, 2)
            assert.match(html, /class="scad-markdown-viewer"/)
            assert.equal((html.match(/class="hljs-title"[^>]*>cube<\/span>/g) ?? []).length, 2, 'Both aliases must highlight model calls in Source tabs')
            assert.equal((html.match(/class="hljs-number"[^>]*>20<\/span>/g) ?? []).length, 2)
            assert.equal(await readFile(trace, 'utf8'), 'cube(20);\n')
            assert.equal((await readFile(trace + '.cwd', 'utf8')).trim(), directory)
            assert.match(await readFile(trace + '.args', 'utf8'), /^--fixture-prefix\n/)
            assert.match(await readFile(trace + '.args', 'utf8'), /--export-format\ncsg\n/)
            assert.match(await readFile(trace + '.args', 'utf8'), /\$preview=true/)
            assert.doesNotMatch(await readFile(trace + '.args', 'utf8'), /--render\n/)
            assert.ok(extension.packageJSON.contributes['markdown.previewScripts'].includes('./dist/markdown-preview.js'))
            assert.equal(await readFile(uri.fsPath, 'utf8'), source, 'Preview must preserve the Markdown source')
        } finally {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors')
            await config.update('openscadPath', previousPath, vscode.ConfigurationTarget.Global)
            await config.update('runtimeCommand', previousCommand, vscode.ConfigurationTarget.Global)
            await config.update('markdown.preview.enabled', previousEnabled, vscode.ConfigurationTarget.Global)
            await config.update('markdown.preview.renderMode', previousMode, vscode.ConfigurationTarget.Global)
            await rm(directory, { recursive: true, force: true })
        }
    })

    test('Markdown editor injects OpenSCAD tokens for both fence aliases and restores Markdown after the fence', async () => {
        const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'scad-markdown-highlight-')))
        const uri = vscode.Uri.file(path.join(directory, 'syntax.md'))
        try {
            const source = '# Before\n\n```openscad\nmodule part(size = 20) { cube(size); }\n```\n\n~~~SCAD\n/* multiline\ncomment */\nsphere(10);\n~~~\n\n# After\n'
            await writeFile(uri.fsPath, source)
            const document = await vscode.workspace.openTextDocument(uri)
            await vscode.window.showTextDocument(document)
            const captured = JSON.stringify(await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', uri))
            assert.match(captured, /storage.type.function.openscad/)
            assert.match(captured, /entity.name.function.call.openscad/)
            assert.match(captured, /variable.parameter.openscad/)
            assert.match(captured, /comment.block.openscad/)
            assert.match(captured, /constant.numeric.openscad/)
            assert.match(captured, /meta.embedded.block.openscad/)
            const last = JSON.parse(captured).at(-1)
            assert.doesNotMatch(JSON.stringify(last), /\.openscad/)
        } finally {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors')
            await rm(directory, { recursive: true, force: true })
        }
    })
})
