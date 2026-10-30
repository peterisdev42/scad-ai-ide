import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as vm from 'node:vm'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { canPreviewSource, EmptyModelError, isEmptyModelOutput } from '../../features/preview/extension/services/previewEligibility'
import * as previewFiles from '../../features/preview/extension/services/previewFile'
import { ModelFormat } from '../../features/preview/shared/types/ModelFormat'

const empty = 'Current top level object is empty.\n'

test('configuration detection handles expressions, comments, strings and multiline vectors', () => {
    for (const source of ['', '// cube(1);', '/* cube(1); */', 'vTolerance = 0.2;\nvWidth = floor(sqrt(2*pow(20,2)))-5;', 'url = "https://example.org/a;/*cube();*/";\nx = [1,\n2,3];', '$fn = 64;']) {
        assert.equal(canPreviewSource(source), false, source)
    }
})

test('geometry, includes, module calls and unknown or incomplete syntax stay eligible', () => {
    for (const source of ['cube(1);', 'width=2; translate([1,0,0]) cube(width);', 'include <model.scad>', 'use <lib.scad>\npart();', 'module part() { cube(1); }', 'function value() = 1;', 'x = ;', 'x = (1;', 'x = 1', '/* unfinished']) {
        assert.equal(canPreviewSource(source), true, source)
    }
})

test('empty model classification preserves real compiler failures', () => {
    assert.equal(isEmptyModelOutput(empty), true)
    assert.equal(isEmptyModelOutput('WARNING: unknown module\n' + empty), true)
    for (const output of ['ERROR: assertion failed\n' + empty, 'Parser error: line 3\n' + empty, 'unknown export format', 'NoError']) {
        assert.equal(isEmptyModelOutput(output), false, output)
    }
})

test('CLI empty results are distinct from failures; configuration skips execution and dirty geometry is rendered', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'preview-eligibility-test-'))
    const path = join(directory, 'model.scad')
    const cli = join(directory, 'cli.cjs')
    let source = 'module unused() { cube(1); }'
    let mode = 'empty'
    let executions = 0
    const sourceFile = readFileSync(new URL('../../features/preview/extension/services/ScadClient.ts', import.meta.url), 'utf8')
    const module = { exports: {} as { ScadClient: { configure: (resolve: () => Promise<unknown>) => void; render: (path: string) => Promise<Buffer>; dispose: () => void } } }
    const require = createRequire(import.meta.url)
    vm.runInNewContext(transformSync(sourceFile, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
        module,
        Buffer,
        require: (id: string) => {
            if (id.endsWith('/previewFile')) return previewFiles
            if (id === 'vscode')
                return {
                    window: { createOutputChannel: () => ({ append() {}, appendLine() {} }) },
                    workspace: { isTrusted: true, textDocuments: [{ uri: { fsPath: path }, isDirty: true, getText: () => source }], getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) },
                }
            if (id === './previewEligibility') return { canPreviewSource, EmptyModelError, isEmptyModelOutput }
            if (id.endsWith('/ModelFormat')) return { ModelFormat }
            if (id.endsWith('/runtime/errors')) return { RuntimeUnavailableError: Error }
            return require(id)
        },
    })
    const client = module.exports.ScadClient
    client.configure(async () => {
        executions++
        return { executable: process.execPath, argsPrefix: [cli, mode] }
    })
    try {
        await writeFile(path, 'only_config = 1;')
        await writeFile(cli, `const fs = require('node:fs'); const mode = process.argv[2]; process.stdin.resume(); process.stdin.on('end', () => { if (mode === 'geometry') { fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1], 'solid fixture'); } else { process.stderr.write(${JSON.stringify(empty)}); if (mode === 'error') process.stderr.write('ERROR: assertion failed\\n'); process.exitCode = 1; } });`)
        await assert.rejects(client.render(path), EmptyModelError)
        mode = 'error'
        await assert.rejects(client.render(path), (error: Error) => error.name !== 'EmptyModelError' && error.message.includes('assertion failed'))
        mode = 'geometry'
        source = 'cube(1);'
        assert.equal((await client.render(path)).toString(), 'solid fixture')
        source = 'width=1;'
        const previous = executions
        await assert.rejects(client.render(path), EmptyModelError)
        assert.equal(executions, previous, 'Configuration detection must skip Runtime resolution and CLI execution')
    } finally {
        client.dispose()
        await rm(directory, { recursive: true, force: true })
    }
})

test('preview command opens configuration and model files without filtering or notifications', async () => {
    const handlers = new Map<string, () => Promise<void>>()
    const reopens: unknown[] = []
    let source = 'width = 2;'
    const document = { languageId: 'openscad', uri: { scheme: 'file', path: '/config.scad' }, getText: () => source }
    const disposable = { dispose() {} }
    const module = { exports: {} as { registerShowPanelCommand: () => unknown } }
    const code = readFileSync(new URL('../../features/preview/extension/commands/showPanel.ts', import.meta.url), 'utf8')
    vm.runInNewContext(transformSync(code, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
        module,
        require: (id: string) => {
            if (id.endsWith('/previewFile')) return previewFiles
            if (id === 'vscode')
                return {
                    Disposable: { from: () => disposable },
                    TabInputCustom: class {},
                    TabInputText: class {},
                    window: { activeTextEditor: { document }, tabGroups: { activeTabGroup: {} } },
                    commands: {
                        registerCommand: (name: string, handler: () => Promise<void>) => {
                            handlers.set(name, handler)
                            return disposable
                        },
                        executeCommand: (name: string, ...args: unknown[]) => {
                            reopens.push([name, ...args])
                            return Promise.resolve()
                        },
                    },
                }
            throw new Error(`Unexpected dependency: ${id}`)
        },
    })
    module.exports.registerShowPanelCommand()
    for (source of ['width=2;', 'cube(2);', '']) {
        await handlers.get('scad-ai-ide.showPreview')!()
        assert.deepEqual(Array.from(reopens.at(-1) as unknown[]), ['reopenActiveEditorWith', 'scad-ai-ide.preview.editor'])
    }
    assert.equal(reopens.length, 3)
})
