import * as presetCore from '../../core/customizer/CustomizerPresets'
import { validPreviewTimings } from '../../core/preview/performance'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as path from 'node:path'
import { ModelFormat } from '../../features/preview/shared/types/ModelFormat'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import { CustomizerService } from '../../core/customizer/CustomizerService'
import { ScadParser } from '../../features/preview/extension/services/ScadParser'
import { ScadParameters } from '../../features/preview/extension/core/ScadParameters'

function fixture(domain?: unknown) {
    let backend!: (state: { kind: 'pending' | 'csg' | 'mesh'; reason?: string; frameReady?: boolean }) => void
    const service = new CustomizerService()
    let source = 'width=0.5; // [0:0.1:1]'
    service.load('file:///model.scad', source)
    const watchers = new Map<string, () => void>()
    const renders: { width?: number }[] = []
    const disposable = { dispose() {} }
    const module = { exports: {} as { ScadSession: new (document: unknown, customizer: CustomizerService, domain?: unknown) => { dispose(): void; currentOverrides: Record<string, unknown>; setPreviewMode(mode: 'preview' | 'render'): void } } }
    runInNewContext(transformSync(readFileSync(new URL('../../features/preview/extension/core/ScadSession.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
        module,
        Buffer,
        performance,
        setTimeout,
        clearTimeout,
        require: (name: string) => {
            if (name.endsWith('/CustomizerPresets')) return presetCore
            if (name.endsWith('/preview/performance')) return { validPreviewTimings }
            if (name === 'node:path') return path
            if (name.endsWith('/ModelFormat')) return { ModelFormat }
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
    const session = new module.exports.ScadSession({ uri: { fsPath: '/model.scad', path: '/model.scad', toString: () => 'file:///model.scad' }, getText: () => source }, service, domain)
    return { service, session, watchers, renders, changeSource: (text: string) => { source = text; service.load('file:///model.scad', source) }, backend: (state: Parameters<typeof backend>[0]) => backend(state) }
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

test('continuous changes are accepted only for a proven CSG backend; release still renders after changing to mesh', () => {
    const { service, session, renders, backend } = fixture()
    service.set('width', 0.6, 'input')
    assert.equal(renders.length, 0)
    service.set('width', 0.6, 'commit')
    assert.equal(renders.length, 1, 'Release must render even if the value was already synchronized')
    session.setPreviewMode('preview')
    backend({ kind: 'csg', frameReady: true })
    assert.equal(service.canPreviewContinuously(), true)
    service.set('width', 0.7, 'input')
    assert.equal(renders.length, 3)
    backend({ kind: 'mesh' })
    assert.equal(service.canPreviewContinuously(), false)
    service.set('width', 0.8, 'input')
    assert.equal(renders.length, 3)
    service.set('width', 0.8, 'commit')
    assert.equal(renders.length, 4)
    backend({ kind: 'csg', frameReady: true })
    session.dispose()
    assert.equal(service.canPreviewContinuously(), false)
})


test('Preview routes preset mutations to the shared host domain and refuses a changed target', async () => {
    const calls: unknown[][] = []
    let revision = 0
    let target = 'file:///model.scad'
    const domain = {
        service: { target },
        onDidChange: () => ({ dispose() {} }),
        presets: { state: () => ({ path: 'file:///bound.json', active: 'A' }), parameterSets: () => ({ A: { width: '0.7' } }) },
        snapshot: () => ({ target, revision, presets: { path: 'file:///bound.json', names: ['A'] } }),
        assertTarget: (expected: string, version: number) => { if (expected !== target || version !== revision) throw new Error('TARGET_CHANGED') },
        preset: async (...args: unknown[]) => { calls.push(args); revision++ },
    }
    const { session, renders } = fixture(domain)
    const actions = session as unknown as { applyParameterSet(name?: string): Promise<void>; saveParameterSet(name: string): Promise<void>; deleteParameterSet(name: string): Promise<void> }
    await actions.applyParameterSet('A')
    await actions.saveParameterSet('A')
    await actions.saveParameterSet('B')
    await actions.deleteParameterSet('A')
    await actions.applyParameterSet(undefined)
    assert.deepEqual(calls.map(call => call.slice(0, 4)), [
        [target, 0, 'select', 'A'], [target, 1, 'save', 'A'], [target, 2, 'new', 'B'], [target, 3, 'delete', 'A'], [target, 4, 'select', undefined],
    ])
    assert.equal(renders.length, 0, 'Preset metadata mirroring must not apply values or render before the domain commits')
    target = 'file:///other.scad'
    await assert.rejects(actions.applyParameterSet('A'), /TARGET_CHANGED/)
    assert.equal(calls.length, 5)
    session.dispose()
})

test('renderer-only sessions cannot fall back to independent preset writes', async () => {
    const { session } = fixture()
    const actions = session as unknown as { saveParameterSet(name: string): Promise<void> }
    await assert.rejects(actions.saveParameterSet('A'), /domain is unavailable/)
    session.dispose()
})


test('Preview incomplete source never prunes stored overrides and resumes with complete definitions', () => {
    const { service, session, watchers, changeSource, renders } = fixture()
    service.set('width', 0.7)
    watchers.get('/model.scad')!()
    changeSource('width="unfinished')
    watchers.get('/model.scad')!()
    assert.deepEqual(service.getOverrides('file:///model.scad'), { width: 0.7 })
    assert.deepEqual(session.currentOverrides, { width: 0.7 })
    assert.deepEqual(renders.at(-1), { width: 0.7 })
    assert.equal((session as unknown as { parameterAnalysisComplete: boolean }).parameterAnalysisComplete, false)
    assert.throws(() => service.set('width', 0.8), /incomplete/)
    changeSource('width=0.5; // [0:0.1:1]')
    watchers.get('/model.scad')!()
    assert.equal((session as unknown as { parameterAnalysisComplete: boolean }).parameterAnalysisComplete, true)
    assert.deepEqual(session.currentOverrides, { width: 0.7 })
    assert.deepEqual(service.getOverrides('file:///model.scad'), { width: 0.7 })
    session.dispose()
})
