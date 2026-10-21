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
        const api = (await extension.activate()) as ReturnType<typeof activate>
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
})
