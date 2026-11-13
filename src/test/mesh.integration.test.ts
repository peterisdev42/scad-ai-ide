import * as assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import * as vscode from 'vscode'
import type { activate } from '../extension'
import { MeshWorkspaceService } from '../features/cad-verification/MeshWorkspaceService'
import { stl, box, threeMf } from './mesh/fixtures'
import type { Quantity } from '../core/mesh/types'
const wait = async (check: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 12000
    while (!(await check())) {
        assert.ok(Date.now() < deadline, 'Host observation timeout')
        await new Promise((r) => setTimeout(r, 50))
    }
}
suite('Raw mesh verification Extension Host', () => {
    let api: Awaited<ReturnType<typeof activate>>, root: string, extension: vscode.Extension<Awaited<ReturnType<typeof activate>>>
    const invoke = async (name: string, input: Record<string, unknown>) => {
        const result = await vscode.lm.invokeTool('scad_ai_ide_model_' + name, { input, toolInvocationToken: undefined })
        const json = JSON.parse(
            result.content
                .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
                .map((p) => p.value)
                .join(''),
        )
        assert.equal(json.ok, true, JSON.stringify(json))
        return { data: json.data, content: result.content }
    }
    suiteSetup(async function () {
        if (!vscode.workspace.workspaceFolders?.[0]) {
            this.skip()
            return
        }
        extension = vscode.extensions.all.find((e) => e.packageJSON.name === 'scad-ai-ide')!
        api = await extension.activate()
        root = join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'mesh-host-fixtures')
        await mkdir(root, { recursive: true })
        await vscode.workspace.getConfiguration('files').update('autoSave', 'off', vscode.ConfigurationTarget.Global)
        if (process.env.SCAD_OPENSCAD_EXECUTABLE) {
            await vscode.workspace.getConfiguration('scad-ai-ide').update('openscadPath', process.env.SCAD_OPENSCAD_EXECUTABLE, vscode.ConfigurationTarget.Global)
            await wait(() => api.cad.availability().enabled)
        }
    })
    teardown(async () => {
        api?.cad.problems.invalidateAll()
    })
    suiteTeardown(async () => {
        if (root) await rm(root, { recursive: true, force: true })
    })
    test('raw STL/3MF verify, measure and readonly history work without Preview or a runtime', async () => {
        const file = join(root, 'standalone.stl'),
            uri = vscode.Uri.file(file)
        await writeFile(file, stl(box([2, 3, 4])))
        const first = (await invoke('analyze', { uri: uri.toString(), mode: 'verify' })).data
        assert.equal(first.schemaVersion, 2)
        assert.equal(first.overallStatus, 'PASS')
        assert.equal(first.units, 'modelUnits')
        const measured = (await invoke('measure', { reportId: first.reportId })).data
        assert.equal(measured.values.physicalVolume.value, 24)
        assert.deepEqual(measured.values.bounds.dimensions, [2, 3, 4])
        assert.equal(measured.snapshotId, first.snapshotId)
        const report = await vscode.workspace.openTextDocument(vscode.Uri.parse(first.reportUri))
        assert.equal(JSON.parse(report.getText()).current, true)
        const repeat = (await invoke('analyze', { uri: uri.toString(), mode: 'verify' })).data
        assert.equal(repeat.reportId, first.reportId)
        // Real Host adapter with no selected runtime; raw input path must never ask for one.
        const service = new MeshWorkspaceService({ extensionUri: extension.extensionUri, globalStorageUri: vscode.Uri.file(join(root, 'no-runtime-store')) } as vscode.ExtensionContext, api.cad, { whenReady: async () => {}, getActiveRuntime: () => undefined } as never)
        try {
            const raw = await service.verify({ uri: uri.toString() })
            assert.equal(raw.overallStatus, 'PASS')
            assert.deepEqual(raw.snapshot.runtime, { used: false })
            const views = await service.renderViews({ reportId: raw.reportId })
            assert.equal(views.renderStatus, 'UNAVAILABLE')
            assert.equal(views.reasonCode, 'RUNTIME_UNAVAILABLE')
            assert.equal(((await service.measure({ reportId: raw.reportId })).values.physicalVolume as Quantity).value, 24)
            const three = join(root, 'inch.3mf')
            await writeFile(three, threeMf({ unit: 'inch' }))
            const r = await service.verify({ uri: vscode.Uri.file(three).toString() })
            assert.equal(r.units, 'mm')
            assert.equal(r.snapshot.sourceUnit, 'inch')
            assert.ok(Math.abs(r.facts!.physicalVolume.value! - 25.4 ** 3) < 1e-8)
        } finally {
            service.dispose()
        }
        await writeFile(file, stl(box([1, 1, 1])))
        await wait(async () => !(await api.cad.geometry!.measure({ reportId: first.reportId })).current)
        assert.equal((await invoke('measure', { reportId: first.reportId })).data.values.physicalVolume.value, 24, 'Historical evidence must not rerender')
        const current = (await invoke('analyze', { uri: uri.toString(), mode: 'verify' })).data
        assert.notEqual(current.snapshotId, first.snapshotId)
    })
    test('dirty mesh buffers are explicitly unresolved and binary defects navigate by report', async () => {
        const file = join(root, 'dirty.stl'),
            uri = vscode.Uri.file(file)
        await writeFile(file, stl(box(), true))
        const doc = await vscode.workspace.openTextDocument(uri),
            edit = new vscode.WorkspaceEdit()
        edit.insert(uri, new vscode.Position(0, 0), 'dirty text\n')
        assert.equal(await vscode.workspace.applyEdit(edit), true)
        const r = (await invoke('analyze', { uri: uri.toString(), mode: 'verify' })).data
        assert.equal(r.overallStatus, 'UNRESOLVED')
        assert.ok(r.incomplete.includes('DIRTY_MESH_BUFFER_NOT_EVALUATED'))
        assert.equal(r.measurements.physicalVolume.value, 1)
        const broken = join(root, 'open.stl'),
            brokenUri = vscode.Uri.file(broken)
        await writeFile(broken, stl(box().slice(1), true))
        const fail = (await invoke('analyze', { uri: brokenUri.toString(), mode: 'verify' })).data
        assert.equal(fail.overallStatus, 'FAIL')
        const issue = fail.issues.find((i: { code: string }) => i.code === 'MESH_BOUNDARY_EDGE'),
            detail = (await invoke('getIssue', { reportId: fail.reportId, issueId: issue.id, includeEvidence: true, cursor: 0, limit: 1 })).data
        assert.equal(detail.current, true)
        assert.equal(detail.issue.location.confidence, 'fallback')
        assert.ok(detail.geometryEvidence)
        const diagnostics = vscode.languages.getDiagnostics(brokenUri).filter((d) => d.source === 'CAD Mesh')
        assert.ok(diagnostics.length > 0)
        await vscode.workspace.openTextDocument(brokenUri)
        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', brokenUri, diagnostics[0].range)
        assert.ok(actions?.some((a) => a.title === 'CAD: open verification report'))
    })
    test('official Full Render evaluates dirty root and dependencies, freezes images, supports inline and empty semantics', async function () {
        if (!process.env.SCAD_OPENSCAD_EXECUTABLE) {
            this.skip()
            return
        }
        this.timeout(120000)
        const file = join(root, 'full.scad'),
            dependency = join(root, 'full-part.scad'),
            uri = vscode.Uri.file(file)
        await writeFile(file, 'cube(1);')
        await writeFile(dependency, 'module part(){cube([2,3,4]);}')
        const document = await vscode.workspace.openTextDocument(uri),
            edit = new vscode.WorkspaceEdit()
        edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), 'include <full-part.scad>\npart();')
        assert.equal(await vscode.workspace.applyEdit(edit), true)
        const verified = (await invoke('analyze', { uri: uri.toString(), mode: 'verify', units: 'mm', tessellation: { fn: 24 } })).data
        assert.equal(verified.overallStatus, 'PASS', JSON.stringify(verified))
        assert.equal(verified.document.dirty, true)
        assert.equal(verified.measurements.physicalVolume.value, 24)
        assert.equal(verified.quality.effectiveOverrides.$preview, false)
        assert.equal(await readFile(file, 'utf8'), 'cube(1);')
        const report = api.cad.geometry!.get(verified.reportId)
        assert.ok(report.snapshot.dependencies.some((d) => d.uri.endsWith('/full-part.scad')))
        const metadata = (await invoke('renderViews', { reportId: verified.reportId })).data
        assert.equal(metadata.renderStatus, 'AVAILABLE', JSON.stringify(metadata))
        assert.equal(metadata.frames.length, 3)
        assert.equal(metadata.delivery, 'metadata')
        assert.ok(metadata.frames.every((f: { sourceMeshSha256: string }) => f.sourceMeshSha256 === report.snapshot.meshSha256))
        assert.ok((await vscode.workspace.fs.readFile(vscode.Uri.parse(metadata.frames[0].artifactUri))).length > 0)
        const inline = await invoke('renderViews', { reportId: verified.reportId, delivery: 'inline' })
        assert.equal(inline.data.delivery, 'inline')
        assert.equal(inline.content.filter((p) => p instanceof vscode.LanguageModelDataPart).length, 3)
        assert.doesNotMatch(JSON.stringify(inline.data), /base64/)
        await writeFile(dependency, 'module part(){cube(2);}')
        await wait(async () => !(await api.cad.geometry!.measure({ reportId: report.reportId })).current)
        const stale = await invoke('renderViews', { reportId: report.reportId })
        assert.equal(stale.data.current, false)
        assert.equal(stale.data.frames[0].sourceMeshSha256, report.snapshot.meshSha256)
        const next = (await invoke('measure', { uri: uri.toString(), units: 'mm' })).data
        assert.equal(next.values.physicalVolume.value, 8)
        const empty = join(root, 'empty.scad')
        await writeFile(empty, 'difference(){cube(1);cube(1);}')
        assert.equal((await invoke('analyze', { uri: vscode.Uri.file(empty).toString(), mode: 'verify' })).data.overallStatus, 'SKIPPED')
        assert.equal((await invoke('analyze', { uri: vscode.Uri.file(empty).toString(), mode: 'verify', requireNonEmpty: true })).data.overallStatus, 'FAIL')
        const bad = await vscode.lm.invokeTool('scad_ai_ide_model_measure', { input: { reportId: 'missing' }, toolInvocationToken: undefined })
        assert.equal(JSON.parse((bad.content[0] as vscode.LanguageModelTextPart).value).error.code, 'REPORT_NOT_FOUND')
        const destination = process.env.SCAD_MESH_EVIDENCE
        if (destination) {
            await mkdir(destination, { recursive: true })
            await writeFile(join(destination, 'host-geometry-' + vscode.version + '.json'), JSON.stringify({ vscode: vscode.version, report, metadata, inline: { delivery: inline.data.delivery, parts: inline.content.length }, next }, null, 2))
        }
    })
})
