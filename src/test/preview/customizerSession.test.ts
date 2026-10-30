import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import { CustomizerService } from '../../core/customizer/CustomizerService'
import { ScadParser } from '../../features/preview/extension/services/ScadParser'
import { ScadParameters } from '../../features/preview/extension/core/ScadParameters'

function fixture() {
    let backend!: (state: { kind: 'pending' | 'csg' | 'mesh' | 'fallback'; reason?: string }) => void
    const service = new CustomizerService()
    const source = 'width=0.5; // [0:0.1:1]'
    service.load('file:///model.scad', source)
    const watchers = new Map<string, () => void>()
    const renders: { width?: number }[] = []
    const disposable = { dispose() {} }
    const module = { exports: {} as { ScadSession: new (document: unknown, customizer: CustomizerService) => { dispose(): void; currentOverrides: Record<string, unknown>; setPreviewMode(mode: 'preview' | 'render'): void } } }
    runInNewContext(transformSync(readFileSync(new URL('../../features/preview/extension/core/ScadSession.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
        module,
        Buffer,
        setTimeout,
        clearTimeout,
        require: (name: string) => {
            if (name === 'vscode')
                return {
                    EventEmitter: class {
                        event = () => disposable
                        fire() {}
                        dispose() {}
                    },
                    Uri: { file: (path: string) => ({ fsPath: path }) },
                    workspace: {
                        getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }),
                        onDidChangeTextDocument: () => disposable,
                        fs: {
                            readFile: async () => {
                                throw new Error('No presets')
                            },
                        },
                    },
                }
            if (name.endsWith('/ScadParser')) return { ScadParser }
            if (name.endsWith('/ScadParameters')) return { ScadParameters }
            if (name.endsWith('/ScadRenderer'))
                return {
                    ScadRenderer: class {
                        constructor(options: { onBackendChange: typeof backend }) {
                            backend = options.onBackendChange
                        }
                        renderLatest(_: string, values: { width?: number }) {
                            renders.push({ ...values })
                        }
                        render(_: string, values: { width?: number }) {
                            renders.push({ ...values })
                        }
                        dispose() {}
                    },
                }
            if (name.endsWith('/ScadClient')) return { ScadClient: { cancelRender() {} } }
            if (name.endsWith('/ScadWatcher'))
                return {
                    FileWatcher: class {
                        constructor(options: { path: string; onChange: () => void }) {
                            watchers.set(options.path, options.onChange)
                        }
                        close() {}
                    },
                }
            throw new Error(`Unexpected dependency: ${name}`)
        },
    })
    const session = new module.exports.ScadSession({ uri: { fsPath: '/model.scad', path: '/model.scad', toString: () => 'file:///model.scad' }, getText: () => source }, service)
    return { service, session, watchers, renders, backend: (state: Parameters<typeof backend>[0]) => backend(state) }
}

test('preset selection renders immediately before file initialization and ordinary edits always update Preview', () => {
    const { service, session, watchers, renders } = fixture()
    service.replaceOverrides('file:///model.scad', { width: 0.7 }, 'preset')
    assert.deepEqual(session.currentOverrides, { width: 0.7 })
    assert.deepEqual(renders, [{ width: 0.7 }], 'Preset selection before the file watcher must use parsed definitions')
    watchers.get('/model.scad')!()
    assert.deepEqual(renders.at(-1), { width: 0.7 })
    assert.equal(renders.length, 2)
    service.set('width', 0.8)
    assert.equal(renders.length, 3)
    assert.deepEqual(renders.at(-1), { width: 0.8 })
    service.replaceOverrides('file:///other.scad', { width: 0.9 }, 'preset')
    assert.equal(renders.length, 3, 'Other documents must not render this session')
    service.replaceOverrides('file:///model.scad', { width: 0.8 }, 'preset')
    assert.equal(renders.length, 4, 'Selecting the same preset must refresh the Preview')
    service.reset(undefined, 'preset')
    assert.equal(renders.length, 5)
    assert.deepEqual(renders.at(-1), {})
    session.dispose()
    service.replaceOverrides('file:///model.scad', { width: 0.9 }, 'preset')
    assert.equal(renders.length, 5)
})

test('continuous changes are accepted only for a proven CSG backend; release still renders after fallback', () => {
    const { service, session, renders, backend } = fixture()
    service.set('width', 0.6, 'input')
    assert.equal(renders.length, 0)
    service.set('width', 0.6, 'commit')
    assert.equal(renders.length, 1, 'Release must render even if the value was already synchronized')
    session.setPreviewMode('preview')
    backend({ kind: 'csg' })
    assert.equal(service.canPreviewContinuously(), true)
    service.set('width', 0.7, 'input')
    assert.equal(renders.length, 3)
    backend({ kind: 'fallback', reason: 'non-triangular polyhedron face' })
    assert.equal(service.canPreviewContinuously(), false)
    service.set('width', 0.8, 'input')
    assert.equal(renders.length, 3)
    service.set('width', 0.8, 'commit')
    assert.equal(renders.length, 4)
    backend({ kind: 'csg' })
    session.dispose()
    assert.equal(service.canPreviewContinuously(), false)
})
