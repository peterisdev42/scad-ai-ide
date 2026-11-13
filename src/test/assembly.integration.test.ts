import * as assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import * as vscode from 'vscode'
import type { activate } from '../extension'
import { stl, box } from './mesh/fixtures'
const wait = async (test: () => Promise<boolean> | boolean) => {
    const end = Date.now() + 15000
    while (!(await test())) {
        assert.ok(Date.now() < end, 'Host observation timeout')
        await new Promise((r) => setTimeout(r, 50))
    }
}
suite('Static assembly Extension Host', () => {
    let api: Awaited<ReturnType<typeof activate>>, root: string, manifestUri: vscode.Uri
    const invoke = async (name: string, input: Record<string, unknown>) => {
        const result = await vscode.lm.invokeTool('scad_ai_ide_model_' + name, { input, toolInvocationToken: undefined })
        const value = JSON.parse(
            result.content
                .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
                .map((p) => p.value)
                .join(''),
        )
        assert.equal(value.ok, true, JSON.stringify(value))
        return value.data
    }
    const config = () => ({
        schemaVersion: 1,
        units: 'mm',
        parts: [
            { id: 'a', selector: { type: 'file', path: 'assembly-host/a.stl' } },
            { id: 'b', selector: { type: 'file', path: 'assembly-host/b.stl' } },
        ],
        checks: [{ id: 'gap', type: 'clearance', parts: ['a', 'b'], min: 0.25, max: 0.35 }],
    })
    suiteSetup(async function () {
        if (!vscode.workspace.workspaceFolders?.[0]) {
            this.skip()
            return
        }
        api = await vscode.extensions.all.find((e) => e.packageJSON.name === 'scad-ai-ide')!.activate()
        root = vscode.workspace.workspaceFolders[0].uri.fsPath
        await mkdir(join(root, 'assembly-host'), { recursive: true })
        await mkdir(join(root, '.scad'), { recursive: true })
        manifestUri = vscode.Uri.file(join(root, '.scad/verification.json'))
        await vscode.workspace.getConfiguration('files').update('autoSave', 'off', vscode.ConfigurationTarget.Global)
    })
    suiteTeardown(async () => {
        for (const d of vscode.workspace.textDocuments.filter((d) => d.uri.toString() === manifestUri?.toString() || d.uri.fsPath.includes('/assembly-host/'))) {
            await vscode.window.showTextDocument(d)
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
        }
        if (root) {
            await rm(join(root, 'assembly-host'), { recursive: true, force: true })
            await rm(manifestUri.fsPath, { force: true })
        }
    })
    test('declaration metadata, dirty Manifest, raw-only assembly, measure, issue, history and Problems', async () => {
        await writeFile(join(root, 'assembly-host/a.stl'), stl())
        await writeFile(join(root, 'assembly-host/b.stl'), stl(box([1, 1, 1], [1.18, 0, 0]), true))
        await writeFile(manifestUri.fsPath, JSON.stringify(config(), null, 2))
        const declarations = await invoke('listParts', { uri: manifestUri.toString() })
        assert.equal(declarations.items.length, 2)
        assert.equal(api.cad.assembly!.core.has('not-a-report'), false)
        const bad = await invoke('checkAssembly', { uri: manifestUri.toString(), expectedManifestDigest: declarations.manifestDigest })
        assert.equal(bad.overallStatus, 'FAIL', JSON.stringify(bad))
        assert.ok(bad.checks.some((c: { id: string; status: string }) => c.id === 'gap' && c.status === 'FAIL'))
        assert.ok(vscode.languages.getDiagnostics(manifestUri).some((d) => d.source === 'CAD Assembly'))
        const issue = await invoke('getIssue', { reportId: bad.reportId, issueId: bad.issues[0].id, includeEvidence: true })
        assert.ok(issue.geometryEvidence.items.length)
        await writeFile(join(root, 'assembly-host/b.stl'), stl(box([1, 1, 1], [1.3, 0, 0]), true))
        await wait(async () => !(await api.cad.assembly!.core.current(api.cad.assembly!.core.get(bad.reportId))))
        const good = await invoke('checkAssembly', { uri: manifestUri.toString(), expectedManifestDigest: declarations.manifestDigest })
        assert.equal(good.overallStatus, 'PASS', JSON.stringify(good))
        assert.notEqual(good.snapshotId, bad.snapshotId)
        assert.equal(vscode.languages.getDiagnostics(manifestUri).filter((d) => d.source === 'CAD Assembly').length, 0)
        api.cad.assembly!.invalidateScad()
        assert.equal(await api.cad.assembly!.core.current(api.cad.assembly!.core.get(good.reportId)), true)
        const measure = await invoke('measure', { reportId: good.reportId, partIds: ['b'] })
        assert.equal(measure.parts.length, 1)
        assert.ok(Math.abs(measure.parts[0].physicalVolumeBound.lower - 1) < 1e-12)
        assert.equal(measure.assemblyPhysicalVolume.value, null)
        const historical = await invoke('checkAssembly', { reportId: bad.reportId })
        assert.equal(historical.current, false)
        assert.equal(historical.overallStatus, 'FAIL')
        const doc = await vscode.workspace.openTextDocument(manifestUri),
            edit = new vscode.WorkspaceEdit()
        edit.replace(
            manifestUri,
            new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
            JSON.stringify({ ...config(), checks: [{ id: 'gap', type: 'clearance', parts: ['a', 'b'], min: 0.1, max: 0.4 }] }),
        )
        await vscode.workspace.applyEdit(edit)
        assert.equal(doc.isDirty, true)
        const changed = await api.capabilities.invoke('cad.checkAssembly', { uri: manifestUri.toString(), expectedManifestDigest: declarations.manifestDigest }, { actor: 'agent' })
        assert.equal(changed.ok, false)
        if (!changed.ok) assert.equal(changed.error.code, 'CONSTRAINT_BASELINE_CHANGED')
        const buffer = await invoke('checkAssembly', { uri: manifestUri.toString() })
        assert.equal(buffer.overallStatus, 'PASS')
        assert.equal(api.cad.assembly!.core.get(buffer.reportId).snapshot.document.dirty, true)
        await vscode.window.showTextDocument(doc)
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
        // Focus-independent fixture reset; never leave a dirty Manifest for the next case.
        if (doc.isDirty) {
            const reset = new vscode.WorkspaceEdit()
            reset.replace(manifestUri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), JSON.stringify(config()))
            await vscode.workspace.applyEdit(reset)
            assert.ok(await doc.save())
        }
    })
    test('official selector export has isolated identities, dirty root support and exact frozen images', async function () {
        this.timeout(180000)
        if (!process.env.SCAD_OPENSCAD_EXECUTABLE) {
            this.skip()
            return
        }
        await vscode.workspace.getConfiguration('scad-ai-ide').update('openscadPath', process.env.SCAD_OPENSCAD_EXECUTABLE, vscode.ConfigurationTarget.Global)
        await wait(() => api.cad.availability().enabled)
        const file = join(root, 'assembly-host/model.scad'),
            uri = vscode.Uri.file(file)
        await writeFile(file, 'part="a";\ngap=0.18;\nif(part=="a")cube(1);else translate([1+gap,0,0])cube(1);\n')
        const m = {
            ...config(),
            entry: 'assembly-host/model.scad',
            parts: [
                { id: 'a', selector: { type: 'define', name: 'part', value: 'a' } },
                { id: 'b', selector: { type: 'define', name: 'part', value: 'b' } },
            ],
        }
        await writeFile(manifestUri.fsPath, JSON.stringify(m))
        const baseline = (await invoke('listParts', { uri: manifestUri.toString() })).manifestDigest
        const bad = await invoke('checkAssembly', { uri: manifestUri.toString(), expectedManifestDigest: baseline })
        assert.equal(bad.overallStatus, 'FAIL', JSON.stringify(bad))
        const doc = await vscode.workspace.openTextDocument(uri),
            edit = new vscode.WorkspaceEdit()
        const at = doc.getText().indexOf('0.18')
        edit.replace(uri, new vscode.Range(doc.positionAt(at), doc.positionAt(at + 4)), '0.30')
        await vscode.workspace.applyEdit(edit)
        assert.equal(doc.isDirty, true)
        const good = await invoke('checkAssembly', { uri: manifestUri.toString(), expectedManifestDigest: baseline })
        assert.equal(good.overallStatus, 'PASS', JSON.stringify(good))
        const report = api.cad.assembly!.core.get(good.reportId)
        assert.notEqual(report.snapshot.sources[0].sourceReport.snapshot.id, report.snapshot.sources[1].sourceReport.snapshot.id)
        assert.equal(report.snapshot.sources[0].sourceReport.snapshot.document.dirty, true)
        assert.ok((await readFile(file, 'utf8')).includes('0.18'))
        const images = await invoke('renderViews', { reportId: good.reportId, partIds: ['b'], cameras: ['iso'], imageSize: [128, 128], delivery: 'metadata' })
        assert.equal(images.renderStatus, 'AVAILABLE', JSON.stringify(images))
        assert.equal(images.snapshotId, good.snapshotId)
        assert.equal(images.frames.length, 1)
        assert.ok(images.frames[0].sourceMeshSha256)
    })
})
