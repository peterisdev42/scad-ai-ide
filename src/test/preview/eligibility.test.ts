import type { PreviewTimings } from '../../core/preview/performance'
import type { ScadClient } from '../../features/preview/extension/services/ScadClient'
import * as cliDependencies from '../../core/formats/dependencies'
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
    const mesh = Buffer.alloc(134)
    mesh.writeUInt32LE(1, 80)
    for (const [index, value] of [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0].entries()) mesh.writeFloatLE(value, 84 + index * 4)
    const sourceFile = readFileSync(new URL('../../features/preview/extension/services/ScadClient.ts', import.meta.url), 'utf8')
    const module = { exports: {} as { ScadClient: typeof ScadClient } }
    const require = createRequire(import.meta.url)
    vm.runInNewContext(transformSync(sourceFile, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
        module,
        Buffer,
        performance,
        require: (id: string) => {
            if (id.endsWith('/dependencies')) return cliDependencies
            if (id.endsWith('/previewExporter/runtime')) return {}
            if (id.endsWith('/PreviewExporter')) return {}
            if (id.endsWith('/previewFile')) return previewFiles
            if (id === 'vscode')
                return {
                    window: { createOutputChannel: () => ({ append() {}, appendLine() {} }) },
                    workspace: { isTrusted: true, textDocuments: [{ uri: { fsPath: path }, isDirty: true, getText: () => source }], getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) },
                }
            if (id === './previewEligibility') return { canPreviewSource, EmptyModelError, isEmptyModelOutput }
            if (id.endsWith('/ModelFormat')) return { ModelFormat }
            if (id.endsWith('/runtime/errors')) return { RuntimeUnavailableError: Error }
            if (id.endsWith('/libraries/LibraryEnvironment')) return { libraryEnvironment: { getEnvironment: async () => ({ ...process.env }), getDependencyFingerprint: async () => '' } }
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
        await writeFile(cli, `const fs = require('node:fs'); const assert = require('node:assert/strict'); const mode = process.argv[2]; process.stdin.resume(); process.stdin.on('end', () => { assert.equal(process.argv[process.argv.indexOf('--export-format')+1], 'binstl'); const output = process.argv[process.argv.indexOf('-o')+1]; assert.equal(require('node:path').extname(output), '.stl'); if (mode === 'geometry') { fs.writeFileSync(output, Buffer.from(${JSON.stringify(mesh.toString('base64'))}, 'base64')); } else { process.stderr.write(${JSON.stringify(empty)}); if (mode === 'error') process.stderr.write('ERROR: assertion failed\\n'); process.exitCode = 1; } });`)
        await assert.rejects(client.render(path), EmptyModelError)
        mode = 'error'
        await assert.rejects(client.render(path), (error: Error) => error.name !== 'EmptyModelError' && error.message.includes('assertion failed'))
        mode = 'geometry'
        source = 'cube(1);'
        const timings: PreviewTimings = {}
        assert.deepEqual(await client.render(path, {}, ModelFormat.STL, undefined, path, undefined, undefined, (value) => Object.assign(timings, value)), mesh)
        for (const phase of ['sourceMs', 'runtimeSelectionMs', 'meshExportMs', 'meshReadMs', 'dependenciesMs', 'cleanupMs'] as const) assert.ok(Number.isFinite(timings[phase]), phase)
        assert.equal(timings.exporterMs, undefined)
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
        performance,
        require: (id: string) => {
            if (id.endsWith('/dependencies')) return cliDependencies
            if (id.endsWith('/previewExporter/runtime')) return {}
            if (id.endsWith('/PreviewExporter')) return {}
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
