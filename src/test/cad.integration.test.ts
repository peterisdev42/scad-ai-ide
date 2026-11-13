import { PreviewProblems } from '../features/preview/extension/services/PreviewProblems'
import * as assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, rm, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import * as vscode from 'vscode'
import type { activate } from '../extension'
import type { VerificationReport } from '../core/cad/types'

const wait = async (check: () => boolean | Promise<boolean>, message: string) => {
    const deadline = Date.now() + 12000
    while (!(await check())) {
        assert.ok(Date.now() < deadline, message)
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
}

suite('CAD verification Extension Host', () => {
    let api: Awaited<ReturnType<typeof activate>>, root: string
    suiteSetup(async function () {
        if (!process.env.SCAD_OPENSCAD_EXECUTABLE || !vscode.workspace.workspaceFolders?.[0]) {
            this.skip()
            return
        }
        this.timeout(30000)
        root = join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'cad-host-fixtures')
        await mkdir(root, { recursive: true })
        await vscode.workspace.getConfiguration('scad-ai-ide').update('openscadPath', process.env.SCAD_OPENSCAD_EXECUTABLE, vscode.ConfigurationTarget.Global)
        const extension = vscode.extensions.all.find((e) => e.packageJSON.name === 'scad-ai-ide')!
        api = await extension.activate()
        await wait(() => api.cad.availability().enabled, 'Selected runtime must become available')
        await vscode.workspace.getConfiguration('chat').update('saveBeforeSend', false, vscode.ConfigurationTarget.Global)
        await vscode.workspace.getConfiguration('files').update('autoSave', 'off', vscode.ConfigurationTarget.Global)
    })
    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        api?.cad.problems.invalidateAll()
    })
    suiteTeardown(async () => {
        if (root) await rm(root, { recursive: true, force: true })
    })
    const diagnostics = (uri: vscode.Uri) => vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'OpenSCAD CLI')
    const analyzeTool = async (uri: vscode.Uri, expectedSnapshotId?: string) => {
        const reply = await vscode.lm.invokeTool('scad_ai_ide_model_analyze', { input: { uri: uri.toString(), mode: 'diagnostics', ...(expectedSnapshotId ? { expectedSnapshotId } : {}) }, toolInvocationToken: undefined })
        return JSON.parse(
            reply.content
                .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
                .map((p) => p.value)
                .join(''),
        )
    }
    test('tools diagnose and repair a dirty root without Preview and reject the old snapshot', async () => {
        const file = join(root, 'dirty.scad'),
            uri = vscode.Uri.file(file)
        await writeFile(file, 'cube(1);')
        const document = await vscode.workspace.openTextDocument(uri)
        const replace = async (text: string) => {
            const edit = new vscode.WorkspaceEdit()
            edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text)
            assert.equal(await vscode.workspace.applyEdit(edit), true)
        }
        await replace('// dirty line\nassert(false, "dirty assertion"); cube(1);')
        const failed = await analyzeTool(uri)
        assert.equal(failed.ok, true, JSON.stringify(failed))
        assert.equal(failed.data.overallStatus, 'FAIL')
        assert.equal(failed.data.document.dirty, true)
        assert.equal(await readFile(file, 'utf8'), 'cube(1);')
        await wait(() => diagnostics(uri).some((d) => d.code === 'SCAD_CLI_ASSERT_FAILED'), 'Host Problems should expose actual CLI assertion')
        assert.equal(diagnostics(uri).find((d) => d.code === 'SCAD_CLI_ASSERT_FAILED')?.range.start.line, 1)
        const issue = failed.data.issues.find((i: { code: string }) => i.code === 'SCAD_CLI_ASSERT_FAILED')
        const detail = await api.cad.issueDetails(failed.data.reportId, issue.id, true)
        assert.equal(detail.current, true)
        assert.match(detail.evidence!.text, /dirty assertion/)
        const report = await vscode.workspace.openTextDocument(vscode.Uri.parse(failed.data.reportUri))
        assert.equal(JSON.parse(report.getText()).reportId, failed.data.reportId)
        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', uri, diagnostics(uri)[0].range)
        const navigation = actions?.find((a) => a.command?.command === 'scad-ai-ide.preview.openProblemSource')?.command
        assert.ok(navigation)
        await replace('cube(3);')
        await wait(() => diagnostics(uri).length === 0, 'Buffer edits must invalidate old Problems')
        assert.equal(await vscode.commands.executeCommand(navigation.command, ...navigation.arguments!), false, 'Stale navigation must be rejected')
        const stale = await analyzeTool(uri, failed.data.snapshotId)
        assert.equal(stale.ok, false)
        assert.equal(stale.error.code, 'SNAPSHOT_CHANGED')
        const repaired = await analyzeTool(uri)
        assert.equal(repaired.ok, true)
        assert.equal(repaired.data.overallStatus, 'PASS')
        assert.notEqual(repaired.data.snapshotId, failed.data.snapshotId)
        assert.equal(diagnostics(uri).length, 0)
        assert.equal(repaired.data.notExamined.includes('mesh-validity'), true)
        assert.equal((await api.cad.issueDetails(failed.data.reportId, issue.id)).current, false)
        assert.equal(await readFile(file, 'utf8'), 'cube(1);')
    })
    test('unsaved included buffers are reported UNRESOLVED and external closed-file edits invalidate Problems', async () => {
        const file = join(root, 'includes.scad'),
            include = join(root, 'include.scad'),
            uri = vscode.Uri.file(file),
            includeUri = vscode.Uri.file(include)
        await writeFile(file, 'include <include.scad>\npart();')
        await writeFile(include, 'module part(){cube(2);}')
        const good = await api.cad.analyze({ uri: uri.toString() })
        assert.equal(good.overallStatus, 'PASS', JSON.stringify(good))
        assert.equal(good.snapshot.dependencies[0].uri, vscode.Uri.file(await realpath(include)).toString())
        const document = await vscode.workspace.openTextDocument(includeUri)
        const edit = new vscode.WorkspaceEdit()
        edit.insert(includeUri, new vscode.Position(0, 0), '// unsaved dependency\n')
        assert.equal(await vscode.workspace.applyEdit(edit), true)
        const dirty = await api.cad.analyze({ uri: uri.toString() })
        assert.equal(dirty.overallStatus, 'UNRESOLVED')
        assert.ok(dirty.incomplete.some((x) => x.startsWith('DIRTY_DEPENDENCY_NOT_EVALUATED')))
        assert.equal(document.isDirty, true)
        assert.equal(await readFile(include, 'utf8'), 'module part(){cube(2);}')
        await vscode.window.showTextDocument(document)
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
        await writeFile(file, 'assert(false);cube(2);')
        await wait(async () => {
            try {
                return (await api.cad.analyze({ uri: uri.toString() })).overallStatus === 'FAIL'
            } catch {
                return false
            }
        }, 'Fresh disk report should be available')
        await wait(() => diagnostics(uri).some((d) => d.code === 'SCAD_CLI_ASSERT_FAILED'), 'Closed root failure should publish')
        await writeFile(file, 'cube(2);')
        await wait(() => diagnostics(uri).length === 0, 'External writes to closed models must invalidate old Problems')
    })
    test('shared owners deduplicate the same issue and survive unrelated owner cleanup', async () => {
        const file = join(root, 'owners.scad'),
            uri = vscode.Uri.file(file)
        await writeFile(file, 'assert(false);cube(1);')
        const report = await api.cad.analyze({ uri: uri.toString() })
        const assertions = () => diagnostics(uri).filter((d) => d.code === 'SCAD_CLI_ASSERT_FAILED')
        const valid = () => api.cad.current(report)
        await api.cad.problems.reportVerification(report, valid, 'preview-owner')
        assert.equal(assertions().length, 1)
        api.cad.problems.clear(uri, 'preview-owner')
        assert.equal(assertions().length, 1, 'Agent owner remains valid')
        const bad = structuredClone(report) as VerificationReport
        bad.reportId = 'different-root'
        bad.snapshot.document.uri = vscode.Uri.file(join(root, 'missing.scad')).toString()
        await api.cad.problems.reportVerification(bad, async () => false, 'wrong-owner')
        assert.equal(assertions().length, 1)
    })
    test('actual Preview CLI and Agent share report projection without duplicate source collections', async () => {
        const file = join(root, 'preview-cli.scad'),
            uri = vscode.Uri.file(file)
        await writeFile(file, 'assert(false, "shared preview failure");cube(1);')
        const document = await vscode.workspace.openTextDocument(uri)
        const agent = await api.cad.analyze({ uri: uri.toString() })
        const reporter = new PreviewProblems(uri, api.cad.problems)
        try {
            const details = await api.cad.issueDetails(agent.reportId, agent.issues.find(i => i.code === 'SCAD_CLI_ASSERT_FAILED')!.id, true)
            const raw = details.evidence!.text.split(/\r?\n/).find(line => /^ERROR:/.test(line))!
            reporter.report(new Error(raw), 'render')
            assert.equal(vscode.languages.getDiagnostics(uri).filter(d => d.message.includes('shared preview failure')).length, 1, 'Known legacy compiler errors share the canonical semantic projection')
            const session = api.preview.getOrCreateSession(document)
            const error = await new Promise<Error>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    subscription.dispose()
                    reject(new Error('Preview CLI did not return its failure'))
                }, 12000)
                const subscription = session.onRenderError((error) => {
                    if (/cancel/i.test(error.message)) return
                    clearTimeout(timeout)
                    subscription.dispose()
                    resolve(error)
                })
                session.setPreviewMode('render')
                session.refreshRender()
            })
            assert.equal((error as { cadReported?: boolean }).cadReported, true, error.stack)
            reporter.report(error, 'render')
            api.preview.removeSession(uri)
            const assertions = () => diagnostics(uri).filter((d) => d.code === 'SCAD_CLI_ASSERT_FAILED')
            assert.equal(assertions().length, 1, JSON.stringify(assertions().map(d => ({ code: d.code, source: d.source, message: d.message, range: d.range }))))
            reporter.dispose()
            api.cad.problems.clear(uri, 'preview-cli')
            assert.equal(assertions().length, 1, 'Disposing a view and clearing Preview cannot remove the Agent owner')
            assert.equal((await api.cad.issueDetails(agent.reportId, agent.issues.find((i) => i.code === 'SCAD_CLI_ASSERT_FAILED')!.id)).current, true)
        } finally {
            reporter.dispose()
        }
    })
    test('two roots sharing an included error retain independent owners and reject stale navigation', async () => {
        const shared = join(root, 'shared.scad'),
            includeUri = vscode.Uri.file(shared)
        const first = vscode.Uri.file(join(root, 'root-a.scad')),
            second = vscode.Uri.file(join(root, 'root-b.scad'))
        await writeFile(shared, 'assert(false, "included failure");cube(1);')
        for (const uri of [first, second]) await writeFile(uri.fsPath, 'include <shared.scad>')
        const a = await api.cad.analyze({ uri: first.toString() }),
            b = await api.cad.analyze({ uri: second.toString() })
        assert.equal(a.overallStatus, 'FAIL')
        assert.equal(b.overallStatus, 'FAIL')
        assert.ok(a.snapshot.dependencies.some((d) => d.uri === includeUri.toString()))
        assert.equal(diagnostics(includeUri).filter((d) => d.code === 'SCAD_CLI_ASSERT_FAILED').length, 1)
        const document = await vscode.workspace.openTextDocument(first)
        const change = new vscode.WorkspaceEdit()
        change.insert(first, new vscode.Position(0, 0), '// root a changed\n')
        assert.equal(await vscode.workspace.applyEdit(change), true)
        assert.equal(diagnostics(includeUri).filter((d) => d.code === 'SCAD_CLI_ASSERT_FAILED').length, 1, 'Root B still owns the shared error')
        assert.equal(await api.cad.problems.open(first), false)
        assert.equal(document.isDirty, true)
    })
    test('identical external diagnostics suppress only the CAD projection and restore on owner removal', async () => {
        const file = join(root, 'lsp.scad'),
            uri = vscode.Uri.file(file)
        await writeFile(file, 'assert(false, "duplicate source");cube(1);')
        await api.cad.analyze({ uri: uri.toString() })
        const original = diagnostics(uri).find((d) => d.code === 'SCAD_CLI_ASSERT_FAILED')!
        const external = vscode.languages.createDiagnosticCollection('cad-test-lsp')
        try {
            const diagnostic = new vscode.Diagnostic(original.range, original.message, original.severity)
            diagnostic.source = 'CAD test LSP'
            diagnostic.code = original.code
            external.set(uri, [diagnostic])
            await wait(() => !diagnostics(uri).some((d) => d.code === original.code), 'Exact LSP diagnostic should own the editor projection')
            assert.equal(vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'CAD test LSP').length, 1)
            external.clear()
            await wait(() => diagnostics(uri).some((d) => d.code === original.code), 'Removing external owner must restore the valid CAD projection')
        } finally {
            external.dispose()
        }
    })
    test('analysis rejects out-of-workspace targets and malformed geometry mode rather than expanding permissions', async () => {
        const outside = vscode.Uri.file(join(root, '..', '..', 'outside.scad'))
        await assert.rejects(api.cad.analyze({ uri: outside.toString() }))
        const reply = await vscode.lm.invokeTool('scad_ai_ide_model_analyze', { input: { uri: vscode.Uri.file(join(root, 'owners.scad')).toString(), mode: 'verify' }, toolInvocationToken: undefined })
        const result = JSON.parse((reply.content[0] as vscode.LanguageModelTextPart).value)
        assert.equal(result.ok, false)
        assert.equal(result.error.code, 'INVALID_INPUT')
        assert.equal(api.cad.verification.reports.get('missing'), undefined)
        await assert.rejects(api.cad.issueDetails('missing', 'a'.repeat(64)), /expired|evicted/)
    })
    test('new higher-priority dependency invalidates cached PASS and executes the replacement', async () => {
        const project = join(root, 'shadow-project'), lib = join(project, '.scad', 'lib')
        await mkdir(lib, { recursive: true })
        await writeFile(join(lib, 'nested.scad'), 'module nested(){cube(2);}')
        await writeFile(join(lib, 'part.scad'), 'use <nested.scad> module part(){nested();}')
        const file = join(project, 'model.scad')
        await writeFile(join(project, 'entry.txt'), 'include <part.scad>')
        await writeFile(file, 'use <entry.txt>\npart();')
        let uri = vscode.Uri.file(file)
        if (process.platform !== 'win32') {
            const alias = join(root, 'shadow-project-alias')
            await symlink(project, alias, 'dir')
            uri = vscode.Uri.file(join(alias, 'model.scad'))
            const doc = await vscode.workspace.openTextDocument(uri)
            const edit = new vscode.WorkspaceEdit()
            edit.insert(uri, new vscode.Position(0, 0), '// dirty alias root\n')
            assert.equal(await vscode.workspace.applyEdit(edit), true)
            assert.equal(doc.isDirty, true)
        }
        const good = await api.cad.analyze({ uri: uri.toString() })
        assert.equal(good.overallStatus, 'PASS', JSON.stringify(good))
        await writeFile(join(project, 'part.scad'), 'module part(){assert(false,"shadow replacement");cube(1);}')
        assert.equal(await api.cad.current(good), false)
        const bad = await api.cad.analyze({ uri: uri.toString() })
        assert.equal(bad.overallStatus, 'FAIL', JSON.stringify(bad))
        assert.notEqual(bad.snapshot.id, good.snapshot.id)
        assert.ok(bad.issues.some(i => i.title.includes('shadow replacement')))
    })
    test('unreadable constraints cannot revive a cached PASS and unresolved report stays readable', async () => {
        const project = join(root, 'evidence-project')
        await mkdir(join(project, '.scad'), { recursive: true })
        const uri = vscode.Uri.file(join(project, 'model.scad'))
        await writeFile(uri.fsPath, 'cube(1);')
        const good = await api.cad.analyze({ uri: uri.toString() })
        assert.equal(good.overallStatus, 'PASS')
        await mkdir(join(project, '.scad', 'verification.json'))
        assert.equal(await api.cad.current(good), false)
        const partial = await api.cad.analyze({ uri: uri.toString() })
        assert.equal(partial.overallStatus, 'UNRESOLVED')
        assert.ok(partial.incomplete.includes('CONSTRAINTS_UNREADABLE'))
        assert.equal(JSON.parse(await api.cad.reportText(partial.reportId)).current, true)
        if (process.platform !== 'win32') {
            const link = join(project, 'closed-link.scad')
            await symlink(uri.fsPath, link)
            await assert.rejects(api.cad.analyze({ uri: vscode.Uri.file(link).toString() }), /Symbolic-link targets are not allowed/)
        }
    })

})
