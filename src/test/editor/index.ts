import * as assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { activate } from '../../extension'
import { ModelFormat } from '../../features/preview/shared/types/ModelFormat'
import * as vscode from 'vscode'

const viewType = 'scad-ai-ide.preview.editor'

async function waitFor(check: () => boolean | Promise<boolean>) {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
        if (await check()) return
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.fail('Timed out waiting for preview editor')
}

export async function run() {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'scad-editor-test-')))
    const uri = vscode.Uri.file(path.join(directory, 'model.scad'))
    const trace = path.join(directory, 'render.json')
    const cli = path.join(directory, 'openscad.cjs')
    const config = vscode.workspace.getConfiguration('scad-ai-ide')
    const oldExecutable = config.inspect('runtimeCommand')?.globalValue
    const oldFormat = config.inspect('preview.format')?.globalValue
    try {
        // Exercise the real extension host and subprocess boundary without needing
        // OpenSCAD installed. Record stdin/cwd and produce a minimal STL fixture.
        await writeFile(
            cli,
            `#!/bin/sh
if [ "$1" = "--fixture-prefix" ] && [ "$2" = "--version" ]; then echo "OpenSCAD version 2026.10.TEST"; exit 0; fi
/bin/cat > '${trace}'
/bin/pwd > '${trace}.cwd'
for arg in "$@"; do /usr/bin/printf '%s\\n' "$arg"; done > '${trace}.args'
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; output="$1"; fi
  shift
done
/usr/bin/printf 'solid test\\nfacet normal 0 0 1\\nouter loop\\nvertex 0 0 0\\nvertex 1 0 0\\nvertex 0 1 0\\nendloop\\nendfacet\\nendsolid test\\n' > "$output"
`,
            { mode: 0o755 },
        )
        await writeFile(uri.fsPath, 'width = 1;\ncube(width);\n')
        await config.update('runtimeCommand', { executable: cli, argsPrefix: ['--fixture-prefix'] }, vscode.ConfigurationTarget.Global)
        await config.update('preview.format', 'stl', vscode.ConfigurationTarget.Global)
        const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')
        assert.ok(extension)
        const api = (await extension.activate()) as ReturnType<typeof activate>
        await api.refresh()
        const document = await vscode.workspace.openTextDocument(uri)
        await vscode.window.showTextDocument(document, { preview: false })
        const group = vscode.window.tabGroups.activeTabGroup
        const count = group.tabs.length
        const edit = new vscode.WorkspaceEdit()
        edit.insert(uri, new vscode.Position(0, 0), '// unsaved source\n')
        await vscode.workspace.applyEdit(edit)
        assert.equal(document.isDirty, true)

        for (let i = 0; i < 3; i++) {
            await rm(trace, { force: true })
            await vscode.commands.executeCommand('scad-ai-ide.togglePreview')
            await waitFor(() => {
                const input = group.activeTab?.input
                return input instanceof vscode.TabInputCustom && input.viewType === viewType
            })
            assert.equal(group.tabs.length, count, 'Preview must replace the source tab')
            assert.equal(vscode.window.tabGroups.activeTabGroup, group)
            await waitFor(async () => {
                try {
                    return (await readFile(trace, 'utf8')) === document.getText() && (await readFile(trace + '.cwd', 'utf8')).trim() === directory && (await readFile(trace + '.args', 'utf8')).trim().endsWith('\n-')
                } catch {
                    return false
                }
            })
            await vscode.commands.executeCommand('scad-ai-ide.togglePreview')
            await waitFor(() => vscode.window.activeTextEditor?.document.uri.toString() === uri.toString())
            assert.equal(group.tabs.length, count, 'Source must replace the preview tab')
            assert.equal(document.isDirty, true, 'Switching must preserve unsaved edits')
            assert.equal(await readFile(uri.fsPath, 'utf8'), 'width = 1;\ncube(width);\n')
        }
        await document.save()
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
        await vscode.commands.executeCommand('vscode.openWith', uri, viewType)
        await waitFor(() => group.activeTab?.input instanceof vscode.TabInputCustom)
        await vscode.commands.executeCommand('scad-ai-ide.showSource')
        await waitFor(() => vscode.window.activeTextEditor?.document.uri.toString() === uri.toString())
        // Sidebar and preview share overrides, including values restored after toggling.
        const shared = api.preview.getOrCreateSession(document)
        await waitFor(() => shared.currentParameters.some((parameter) => parameter.name === 'width'))
        await vscode.window.showTextDocument(document)
        api.customizer.set('width', 7)
        assert.equal(shared.currentOverrides.width, 7)
        shared.updateParameterValue('width', 9)
        assert.equal(api.customizer.getOverrides(uri.toString()).width, 9)
        const buffer = await shared.exportFormat(ModelFormat.STL)
        assert.match(buffer.toString(), /solid test/)
        assert.match(await readFile(trace + '.args', 'utf8'), /--fixture-prefix/)
        assert.match(await readFile(trace + '.args', 'utf8'), /width=9/)
        await shared.saveParameterSet('Wide')
        shared.updateParameterValue('width', 3)
        shared.applyParameterSet('Wide')
        assert.equal(shared.currentOverrides.width, 9)
        assert.equal(api.customizer.getOverrides(uri.toString()).width, 9)
        await shared.deleteParameterSet('Wide')
        assert.equal(shared.currentOverrides.width, undefined)
        if (process.env.SCAD_OPENSCAD_EXECUTABLE) {
            await config.update('runtimeCommand', { executable: process.env.SCAD_OPENSCAD_EXECUTABLE, argsPrefix: [] }, vscode.ConfigurationTarget.Global)
            await api.refresh()
            const stl = await shared.exportFormat(ModelFormat.STL)
            assert.ok(stl.length > 84, 'Real OpenSCAD must produce STL geometry')
            const threeMF = await shared.exportFormat(ModelFormat.ThreeMF)
            assert.equal(threeMF.subarray(0, 2).toString(), 'PK', 'Real OpenSCAD must produce a 3MF archive')
            console.log('PASS: real selected OpenSCAD runtime exports STL and 3MF')
        }
        api.preview.removeSession(uri)
        console.log('PASS: tab replacement, repeated toggles, dirty text, CLI stdin/cwd/prefix, Open With, shared Customizer, presets and export')
    } catch (error) {
        for (const file of [trace, trace + '.cwd', trace + '.args']) {
            console.error(file, await readFile(file, 'utf8').catch(String))
        }
        throw error
    } finally {
        await config.update('runtimeCommand', oldExecutable, vscode.ConfigurationTarget.Global)
        await config.update('preview.format', oldFormat, vscode.ConfigurationTarget.Global)
        await vscode.commands.executeCommand('workbench.action.files.revert')
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        await rm(directory, { recursive: true, force: true })
    }
}
