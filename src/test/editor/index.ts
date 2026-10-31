import * as assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
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
    const oldMode = config.inspect('preview.renderMode')?.globalValue
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
# Put the invocation in its own valid STL solid name: concurrent preview jobs
# may overwrite the shared diagnostic trace after an export completes.
fixture_label="test"
for arg in "$@"; do fixture_label="$fixture_label $arg"; done
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; output="$1"; fi
  if [ "$1" = "--export-format" ]; then shift; format="$1"; fi
  shift
done
if [ "$format" = "csg" ]; then
  /usr/bin/printf 'cube(size=[20,20,20],center=false);' > "$output"
  exit 0
fi
/usr/bin/printf 'solid %s\\nfacet normal 0 0 1\\nouter loop\\nvertex 0 0 0\\nvertex 1 0 0\\nvertex 0 1 0\\nendloop\\nendfacet\\nendsolid %s\\n' "$fixture_label" "$fixture_label" > "$output"
`,
            { mode: 0o755 },
        )
        await writeFile(uri.fsPath, 'width = 1;\ncube(width);\n')
        await config.update('runtimeCommand', { executable: cli, argsPrefix: ['--fixture-prefix'] }, vscode.ConfigurationTarget.Global)
        await config.update('preview.format', 'stl', vscode.ConfigurationTarget.Global)
        await config.update('preview.renderMode', 'render', vscode.ConfigurationTarget.Global)
        const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')
        assert.ok(extension)
        const api = (await extension.activate()) as Awaited<ReturnType<typeof activate>>
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
        const vectorEdit = new vscode.WorkspaceEdit()
        vectorEdit.insert(uri, new vscode.Position(0, 0), 'size = [2, 4]; // [0:2:10]\n')
        await vscode.workspace.applyEdit(vectorEdit)
        await waitFor(() => shared.currentParameters.some((parameter) => parameter.name === 'size'))
        api.customizer.set('size', [4, 8])
        assert.deepEqual(shared.currentOverrides.size, [4, 8])
        shared.updateParameterValue('size', [6, 10])
        assert.deepEqual(api.customizer.getOverrides(uri.toString()).size, [6, 10])
        const buffer = await shared.exportFormat(ModelFormat.STL)
        assert.match(buffer.toString(), /solid test/)
        assert.match(await readFile(trace + '.args', 'utf8'), /--fixture-prefix/)
        assert.match(buffer.toString(), /width=9/)
        assert.match(buffer.toString(), /size=\[6,10\]/)
        await shared.saveParameterSet('Wide')
        shared.updateParameterValue('width', 3)
        shared.updateParameterValue('size', [8, 10])
        shared.applyParameterSet('Wide')
        assert.equal(shared.currentOverrides.width, 9)
        assert.deepEqual(shared.currentOverrides.size, [6, 10])
        assert.deepEqual(api.customizer.getOverrides(uri.toString()).size, [6, 10])
        assert.equal(api.customizer.getOverrides(uri.toString()).width, 9)
        await shared.deleteParameterSet('Wide')
        assert.equal(shared.currentOverrides.width, undefined)
        const results: { buffer: Buffer; format: ModelFormat }[] = []
        const renderSubscription = shared.onRenderCompleted((result) => results.push(result))
        for (let turn = 0; turn < 2; turn++) {
            results.length = 0
            shared.setPreviewMode('preview')
            await waitFor(() => results.some((result) => result.format === ModelFormat.CSG))
            assert.equal(JSON.parse(results.at(-1)!.buffer.toString()).meshes.length, 1)
            assert.match(await readFile(trace + '.args', 'utf8'), /--export-format\ncsg\n/)
            assert.match(await readFile(trace + '.args', 'utf8'), /\$preview=true/)
            await shared.exportFormat(ModelFormat.STL)
            assert.doesNotMatch(await readFile(trace + '.args', 'utf8'), /\$preview=true/)
            assert.equal(shared.previewMode, 'preview', 'Exporting must preserve the current quick-preview mode')
            results.length = 0
            shared.setPreviewMode('render')
            await waitFor(() => results.some((result) => result.format === ModelFormat.STL))
        }
        renderSubscription.dispose()
        console.log('PASS: SCAD sessions switch between CSG trees and interactive mesh, while exports keep full evaluation')
        const realExecutable = process.env.SCAD_OPENSCAD_EXECUTABLE || process.env.SCAD_OPENSCAD_CSG_EXECUTABLE
        if (realExecutable) {
            await config.update('runtimeCommand', { executable: realExecutable, argsPrefix: [] }, vscode.ConfigurationTarget.Global)
            await api.refresh()
            const stl = await shared.exportFormat(ModelFormat.STL)
            assert.ok(stl.length > 84, 'Real OpenSCAD must produce STL geometry')
            if (process.env.SCAD_OPENSCAD_EXECUTABLE) {
                const threeMF = await shared.exportFormat(ModelFormat.ThreeMF)
                assert.equal(threeMF.subarray(0, 2).toString(), 'PK', 'Real OpenSCAD must produce a 3MF archive')
            }
            const csg = await shared.exportFormat(ModelFormat.CSG)
            assert.match(csg.toString(), /cube\(/)
            const realResults: { buffer: Buffer; format: ModelFormat }[] = []
            const realSubscription = shared.onRenderCompleted((result) => realResults.push(result))
            shared.setPreviewMode('preview')
            await waitFor(() => realResults.some((result) => result.format === ModelFormat.CSG))
            assert.equal(JSON.parse(realResults.at(-1)!.buffer.toString()).meshes.length, 1)
            realSubscription.dispose()
            console.log('PASS: real selected OpenSCAD runtime exports STL and a CSG tree evaluated by the interactive preview worker')
            const polyhedronUri = vscode.Uri.file(path.join(directory, 'polyhedron.scad'))
            await writeFile(polyhedronUri.fsPath, 'polyhedron(points=[[0,0,0],[20,0,0],[20,20,0],[0,20,0],[0,0,20],[20,0,20],[20,20,20],[0,20,20]],faces=[[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]]);')
            const polyhedronDocument = await vscode.workspace.openTextDocument(polyhedronUri)
            const polyhedronSession = api.preview.getOrCreateSession(polyhedronDocument)
            const polyhedronResults: { buffer: Buffer; format: ModelFormat }[] = []
            const polyhedronSubscription = polyhedronSession.onRenderCompleted((result) => polyhedronResults.push(result))
            polyhedronSession.setPreviewMode('preview')
            await waitFor(() => polyhedronResults.some((result) => result.format === ModelFormat.CSG))
            assert.equal(polyhedronSession.renderBackend.kind, 'csg')
            assert.equal(JSON.parse(polyhedronResults.at(-1)!.buffer.toString()).version, 2)
            assert.equal(api.customizer.canPreviewContinuously(polyhedronUri.toString()), false)
            assert.ok(polyhedronSession.renderBackend.elapsedMs! >= 0)
            polyhedronSubscription.dispose()
            api.preview.removeSession(polyhedronUri)
            console.log('PASS: real quad polyhedron stays on the CSG path; continuous preview waits for a canvas acknowledgment')
        }
        const csgUri = vscode.Uri.file(path.join(directory, 'tree.CSG'))
        const csgSource = 'difference(){cube(size=[20,20,20],center=true);sphere(r=5,$fn=16);}'
        await writeFile(csgUri.fsPath, csgSource)
        const csgDocument = await vscode.workspace.openTextDocument(csgUri)
        const csgSession = api.preview.getOrCreateSession(csgDocument)
        const csgResults: { buffer: Buffer; format: ModelFormat }[] = []
        const csgSubscription = csgSession.onRenderCompleted((result) => csgResults.push(result))
        csgSession.refreshRender()
        await waitFor(() => csgResults.some((result) => result.format === ModelFormat.CSG))
        await vscode.window.showTextDocument(csgDocument)
        await vscode.commands.executeCommand('scad-ai-ide.togglePreview')
        await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom)
        await vscode.commands.executeCommand('scad-ai-ide.togglePreview')
        await waitFor(() => vscode.window.activeTextEditor?.document === csgDocument)
        assert.equal(await readFile(csgUri.fsPath, 'utf8'), csgSource)
        csgSubscription.dispose()
        api.preview.removeSession(csgUri)
        console.log('PASS: CSG files open directly as interactive previews and preserve their source')
        api.preview.removeSession(uri)
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        await rm(trace, { force: true })
        const stlBytes = Buffer.alloc(134)
        stlBytes.writeUInt32LE(1, 80)
        for (const [index, value] of [0, 0, 1, 0, 0, 0, 10, 0, 0, 0, 10, 0].entries()) stlBytes.writeFloatLE(value, 84 + index * 4)
        const modelXML = '<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>'
        const threeMF = zipSync({
            '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
            '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
            '3D/3dmodel.model': strToU8(modelXML),
        })
        const asciiSTL = Buffer.from('solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid test\n')
        for (const [name, bytes] of [
            ['mesh.stl', asciiSTL],
            ['binary.STL', stlBytes],
            ['mesh.3MF', threeMF],
        ] as const) {
            const meshUri = vscode.Uri.file(path.join(directory, name))
            await writeFile(meshUri.fsPath, bytes)
            await vscode.commands.executeCommand('vscode.openWith', meshUri, 'default', { preview: false })
            await waitFor(() => {
                const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
                return input instanceof vscode.TabInputText && input.uri.toString() === meshUri.toString()
            })
            const tabCount = vscode.window.tabGroups.activeTabGroup.tabs.length
            for (let turn = 0; turn < 2; turn++) {
                await vscode.commands.executeCommand('scad-ai-ide.togglePreview')
                await waitFor(() => {
                    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
                    return input instanceof vscode.TabInputCustom && input.viewType === 'scad-ai-ide.preview.mesh'
                })
                assert.equal(vscode.window.tabGroups.activeTabGroup.tabs.length, tabCount)
                await vscode.commands.executeCommand('scad-ai-ide.togglePreview')
                await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText)
                assert.equal(vscode.window.tabGroups.activeTabGroup.tabs.length, tabCount)
            }
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
            await vscode.commands.executeCommand('vscode.openWith', meshUri, 'scad-ai-ide.preview.mesh')
            await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom)
            assert.deepEqual(await readFile(meshUri.fsPath), Buffer.from(bytes), 'Preview must never modify mesh bytes')
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
        }
        await assert.rejects(readFile(trace), { code: 'ENOENT' }, 'Native mesh previews must not invoke OpenSCAD')
        console.log('PASS: ASCII STL, binary STL and 3MF share tab replacement, repeated toggles and Open With without invoking the CLI')
        console.log('PASS: tab replacement, repeated toggles, dirty text, CLI stdin/cwd/prefix, Open With, shared Customizer, presets and export')
    } catch (error) {
        for (const file of [trace, trace + '.cwd', trace + '.args']) {
            console.error(file, await readFile(file, 'utf8').catch(String))
        }
        throw error
    } finally {
        await config.update('runtimeCommand', oldExecutable, vscode.ConfigurationTarget.Global)
        await config.update('preview.format', oldFormat, vscode.ConfigurationTarget.Global)
        await config.update('preview.renderMode', oldMode, vscode.ConfigurationTarget.Global)
        await vscode.commands.executeCommand('workbench.action.files.revert')
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        await rm(directory, { recursive: true, force: true })
    }
}
