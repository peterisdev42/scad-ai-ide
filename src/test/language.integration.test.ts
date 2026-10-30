import * as assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { activate } from '../extension'

async function eventually(check: () => boolean | Promise<boolean>) {
    const deadline = Date.now() + 5000
    while (!(await check())) {
        if (Date.now() > deadline) {
            assert.ok(await check(), 'Timed out waiting for VS Code editor state')
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
    }
}

suite('OpenSCAD language integration', () => {
    test('native Enter indents unbraced bodies once, nested vectors and block comments', async () => {
        const settings = vscode.workspace.getConfiguration('editor')
        const previous = settings.inspect<string>('autoIndent')?.globalValue
        await settings.update('autoIndent', 'full', vscode.ConfigurationTarget.Global)
        try {
            for (const header of ['if (enabled)', 'else', 'for (i = [0:2])', 'translate([1, 2, 3])', 'translate([1, 2, 3]) rotate([0, 90, 0])']) {
                const document = await vscode.workspace.openTextDocument({ language: 'openscad', content: header })
                const editor = await vscode.window.showTextDocument(document)
                editor.options = { insertSpaces: true, tabSize: 4 }
                editor.selection = new vscode.Selection(document.positionAt(header.length), document.positionAt(header.length))
                await vscode.commands.executeCommand('editor.action.forceRetokenize')
                await vscode.commands.executeCommand('type', { text: '\n' })
                assert.equal(document.getText(), `${header}\n    `, header)
                await vscode.commands.executeCommand('type', { text: 'cube(1);' })
                assert.equal(document.lineAt(1).text, '    cube(1);')
                // Rapid API typing can otherwise hit VS Code's temporary
                // keep-indent fallback before background tokenization catches up.
                await vscode.commands.executeCommand('editor.action.forceRetokenize')
                await vscode.commands.executeCommand('type', { text: '\n' })
                assert.equal(document.lineAt(2).text, '', header)
                await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
            }
            for (const [source, expected] of [
                ['points = [ [1, 2],', '    '],
                ['echo("(");', ''],
                ['/* notes', ' * '],
                ['/* notes\n * first', ' * '],
            ]) {
                const document = await vscode.workspace.openTextDocument({ language: 'openscad', content: source })
                const editor = await vscode.window.showTextDocument(document)
                editor.options = { insertSpaces: true, tabSize: 4 }
                editor.selection = new vscode.Selection(document.positionAt(source.length), document.positionAt(source.length))
                await vscode.commands.executeCommand('editor.action.forceRetokenize')
                await vscode.commands.executeCommand('type', { text: '\n' })
                assert.equal(document.lineAt(document.lineCount - 1).text, expected, source)
                await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
            }
        } finally {
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
            await settings.update('autoIndent', previous, vscode.ConfigurationTarget.Global)
        }
    })

    test('VS Code folds explicit region markers', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'openscad', content: '// #region Geometry\ncube(10);\n// #endregion\n' })
        await vscode.window.showTextDocument(document)
        // VS Code loads contributed language configuration asynchronously on first use.
        await eventually(async () => {
            const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', document.uri)
            return ranges?.some((range) => range.start === 0 && range.end === 2) ?? false
        })
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
    })

    test('real LSP supplies completion, hover, definition, rename, symbols, formatting and diagnostics', async function () {
        // Use the bundled server by default; an explicit executable can test a different build.
        const executable = process.env.SCAD_LSP_EXECUTABLE
        const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')!
        const bundled = path.join(extension.extensionPath, 'server', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'openscad-lsp.exe' : 'openscad-lsp')
        if (!executable && !existsSync(bundled)) {
            this.skip()
        }
        const api = (await extension.activate()) as Awaited<ReturnType<typeof activate>>
        const configuration = vscode.workspace.getConfiguration('scad-ai-ide.languageServer')
        const previous = configuration.inspect<string>('path')?.globalValue
        const previousEnabled = configuration.inspect<boolean>('enabled')?.globalValue
        const directory = await mkdtemp(path.join(os.tmpdir(), 'scad-language-'))
        const file = path.join(directory, 'test.scad')
        try {
            await configuration.update('path', executable ?? '', vscode.ConfigurationTarget.Global)
            await writeFile(file, 'module widget(size = 10) { cube(size); }\nwidget();\ncu\n')
            const document = await vscode.workspace.openTextDocument(file)
            const editor = await vscode.window.showTextDocument(document)
            await api.language.ready()
            assert.ok(api.language.isRunning())
            const completion = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, new vscode.Position(2, 2))
            assert.ok(completion?.items.some((item) => (typeof item.label === 'string' ? item.label : item.label.label).startsWith('cube')))
            assert.equal(
                completion?.items.some((item) => item.kind === vscode.CompletionItemKind.Keyword && item.label === 'module'),
                false,
            )
            assert.ok(completion?.items.some((item) => item.kind === vscode.CompletionItemKind.Keyword && item.label === 'let'))
            assert.ok(completion?.items.some((item) => (typeof item.label === 'string' ? item.label : item.label.label).startsWith('difference') && item.kind !== vscode.CompletionItemKind.Keyword))
            const editorSettings = vscode.workspace.getConfiguration('editor')
            const previousSnippets = editorSettings.inspect<string>('snippetSuggestions')?.globalValue
            try {
                await editorSettings.update('snippetSuggestions', 'none', vscode.ConfigurationTarget.Global)
                const withoutTemplates = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, new vscode.Position(2, 2))
                assert.ok(withoutTemplates?.items.some((item) => item.kind === vscode.CompletionItemKind.Keyword && item.label === 'module'))
            } finally {
                await editorSettings.update('snippetSuggestions', previousSnippets, vscode.ConfigurationTarget.Global)
            }
            const hover = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, new vscode.Position(1, 3))
            assert.ok(hover?.length)
            const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', document.uri, new vscode.Position(1, 3))
            assert.ok(definitions?.length)
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri)
            assert.ok(symbols?.some((symbol) => symbol.name === 'widget'))
            const rename = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', document.uri, new vscode.Position(1, 3), 'part')
            assert.ok(rename?.entries().some(([, edits]) => edits.some((edit) => edit.newText === 'part')))
            await editor.edit((edit) => edit.replace(new vscode.Range(2, 0, 2, 2), 'cube(  2  );'))
            await eventually(() => document.getText().includes('cube(  2  );'))
            const formatting = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', document.uri, { tabSize: 4, insertSpaces: true })
            assert.ok(formatting?.length)
            const diagnostic = new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    subscription.dispose()
                    reject(new Error('No LSP diagnostics received'))
                }, 10000)
                const subscription = vscode.languages.onDidChangeDiagnostics(() => {
                    if (vscode.languages.getDiagnostics(document.uri).length) {
                        clearTimeout(timeout)
                        subscription.dispose()
                        resolve()
                    }
                })
            })
            await editor.edit((edit) => edit.insert(document.positionAt(document.getText().length), '\ninclude <missing-library-for-test.scad>\n'))
            await diagnostic
            await configuration.update('enabled', false, vscode.ConfigurationTarget.Global)
            await api.language.ready()
            assert.equal(api.language.isRunning(), false)
            await configuration.update('enabled', true, vscode.ConfigurationTarget.Global)
            await api.language.ready()
            assert.equal(api.language.isRunning(), true)
        } finally {
            await configuration.update('path', previous, vscode.ConfigurationTarget.Global)
            await configuration.update('enabled', previousEnabled, vscode.ConfigurationTarget.Global)
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
            await rm(directory, { recursive: true, force: true })
        }
    })

    test('real LSP folds unindented structure and regions, including unsaved edits', async function () {
        const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')!
        const executable = process.env.SCAD_LSP_EXECUTABLE
        const bundled = path.join(extension.extensionPath, 'server', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'openscad-lsp.exe' : 'openscad-lsp')
        if (!executable && !existsSync(bundled)) {
            this.skip()
        }
        const api = (await extension.activate()) as Awaited<ReturnType<typeof activate>>
        const configuration = vscode.workspace.getConfiguration('scad-ai-ide.languageServer')
        const previous = configuration.inspect<string>('path')?.globalValue
        const directory = await mkdtemp(path.join(os.tmpdir(), 'scad-folding-'))
        try {
            await configuration.update('path', executable ?? '', vscode.ConfigurationTarget.Global)
            const source = '// #region Model\nmodule shape() {\ndifference() {\ncube(10);\nsphere(4);\n}\n}\nfunction scale(x) =\nx * 2;\n/* notes\nsecond\n*/\n// #endregion\n'
            const file = path.join(directory, 'folding.scad')
            await writeFile(file, source)
            const document = await vscode.workspace.openTextDocument(file)
            const editor = await vscode.window.showTextDocument(document)
            await api.language.ready()
            assert.ok(api.language.isRunning())
            const ranges = () => vscode.commands.executeCommand<vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', document.uri)
            await eventually(async () => {
                const folds = await ranges()
                return [
                    [0, 12],
                    [1, 5],
                    [2, 4],
                    [7, 8],
                    [9, 11],
                ].every(([start, end]) => folds?.some((r) => r.start === start && r.end === end))
            })
            const folds = (await ranges())!
            assert.equal(folds.find((r) => r.start === 0)?.kind, vscode.FoldingRangeKind.Region)
            assert.equal(folds.find((r) => r.start === 9)?.kind, vscode.FoldingRangeKind.Comment)
            await editor.edit((edit) => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(source.length)), 'module revised() {\ncube(2);\n}\n'))
            assert.ok(document.isDirty)
            await eventually(async () => {
                const folds = await ranges()
                return folds?.length === 1 && folds[0].start === 0 && folds[0].end === 1
            })
        } finally {
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
            await configuration.update('path', previous, vscode.ConfigurationTarget.Global)
            await rm(directory, { recursive: true, force: true })
        }
    })
})
