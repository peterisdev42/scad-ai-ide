import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import * as vm from 'node:vm'
import { transformSync } from 'esbuild'
import type { MeshPreviewDocument } from '../../features/preview/extension/core/MeshPreviewDocument'
import * as previewFiles from '../../features/preview/extension/services/previewFile'
import { ModelFormat } from '../../features/preview/shared/types/ModelFormat'

function fixture(format: ModelFormat) {
    let read: () => Promise<Uint8Array> = async () => Buffer.from([0, 255, 128, 3])
    let closed = false
    const watched = new Map<string, () => void>()
    class Emitter {
        private listeners = new Set<(value: unknown) => void>()
        event = (listener: (value: unknown) => void) => {
            this.listeners.add(listener)
            return { dispose: () => this.listeners.delete(listener) }
        }
        fire(value: unknown) {
            for (const listener of this.listeners) listener(value)
        }
        dispose() {
            this.listeners.clear()
        }
    }
    const subscribe = (key: string) => (listener: () => void) => {
        watched.set(key, listener)
        return { dispose: () => watched.delete(key) }
    }
    const watcher = {
        onDidChange: subscribe('change'),
        onDidCreate: subscribe('create'),
        onDidDelete: subscribe('delete'),
        dispose: () => {
            closed = true
        },
    }
    const module = { exports: {} as { MeshPreviewDocument: typeof MeshPreviewDocument } }
    const code = readFileSync(new URL('../../features/preview/extension/core/MeshPreviewDocument.ts', import.meta.url), 'utf8')
    vm.runInNewContext(transformSync(code, { loader: 'ts', format: 'cjs' }).code, {
        module,
        Buffer,
        require: (id: string) => {
            if (id === 'node:path') return { basename: (path: string) => path.split('/').at(-1), dirname: () => '/models' }
            if (id === 'vscode') return { EventEmitter: Emitter, RelativePattern: class {}, workspace: { fs: { readFile: () => read() }, createFileSystemWatcher: () => watcher } }
            throw new Error(`Mesh preview must not depend on a Runtime or text editor: ${id}`)
        },
    })
    const document = new module.exports.MeshPreviewDocument({ fsPath: `/models/model.${format}` } as never, format)
    return {
        document,
        setRead: (next: typeof read) => {
            read = next
        },
        trigger: (name: string) => watched.get(name)?.(),
        closed: () => closed,
        watchers: () => watched.size,
    }
}

for (const format of [ModelFormat.STL, ModelFormat.ThreeMF]) {
    test(`Mesh ${format} preview preserves raw bytes, reloads file changes and disposes its watcher without a Runtime`, async () => {
        const mock = fixture(format)
        const models: Buffer[] = []
        mock.document.onRenderCompleted((result) => {
            assert.equal(result.format, format)
            models.push(result.buffer)
        })
        await mock.document.refreshRender()
        assert.deepEqual([...models[0]], [0, 255, 128, 3])
        const replacement = Buffer.from([80, 75, 0, 255, 131])
        mock.setRead(async () => replacement)
        mock.trigger('change')
        await new Promise(setImmediate)
        assert.deepEqual(models.at(-1), replacement)
        assert.deepEqual(await mock.document.exportFormat(format), replacement)
        await assert.rejects(mock.document.exportFormat(format === ModelFormat.STL ? ModelFormat.ThreeMF : ModelFormat.STL), /original format/)
        mock.document.dispose()
        assert.equal(mock.closed(), true)
        assert.equal(mock.watchers(), 0)
    })
}

test('Older or disposed mesh reads cannot overwrite newer results, and read errors are reported', async () => {
    const mock = fixture(ModelFormat.STL)
    const models: Buffer[] = [],
        errors: Error[] = []
    mock.document.onRenderCompleted(({ buffer }) => models.push(buffer))
    mock.document.onRenderError((error) => errors.push(error))
    let finish!: (data: Uint8Array) => void
    mock.setRead(
        () =>
            new Promise((resolve) => {
                finish = resolve
            }),
    )
    const stale = mock.document.refreshRender()
    mock.setRead(async () => Buffer.from('new'))
    await mock.document.refreshRender()
    finish(Buffer.from('old'))
    await stale
    assert.equal(models.length, 1)
    assert.equal(models[0].toString(), 'new')
    mock.setRead(async () => {
        throw new Error('File removed')
    })
    await mock.document.refreshRender()
    assert.match(errors[0].message, /File removed/)
    mock.setRead(
        () =>
            new Promise((resolve) => {
                finish = resolve
            }),
    )
    const pending = mock.document.refreshRender()
    mock.document.dispose()
    finish(Buffer.from('disposed'))
    await pending
    assert.equal(models.length, 1)
})

test('Source, binary editors and both preview types share toggle commands', async () => {
    class TabInputText {
        constructor(readonly uri: unknown) {}
    }
    class TabInputCustom {
        constructor(
            readonly uri: unknown,
            readonly viewType: string,
        ) {}
    }
    const window = { activeTextEditor: undefined, tabGroups: { activeTabGroup: { activeTab: { input: undefined as unknown } } } }
    const handlers = new Map<string, () => Promise<void>>()
    const reopens: string[] = []
    const module = { exports: {} as { registerShowPanelCommand: () => unknown } }
    const code = readFileSync(new URL('../../features/preview/extension/commands/showPanel.ts', import.meta.url), 'utf8')
    vm.runInNewContext(transformSync(code, { loader: 'ts', format: 'cjs' }).code, {
        module,
        require: (id: string) => {
            if (id.endsWith('/previewFile')) return previewFiles
            if (id === 'vscode')
                return {
                    TabInputText,
                    TabInputCustom,
                    window,
                    Disposable: { from: () => ({ dispose() {} }) },
                    commands: {
                        registerCommand: (name: string, handler: () => Promise<void>) => {
                            handlers.set(name, handler)
                            return { dispose() {} }
                        },
                        executeCommand: async (name: string, arg?: string) => {
                            if (name === 'reopenActiveEditorWith') reopens.push(arg!)
                            else await handlers.get(name)?.()
                        },
                    },
                }
            throw new Error(`Unexpected dependency: ${id}`)
        },
    })
    module.exports.registerShowPanelCommand()
    for (const extension of ['scad', 'stl', 'STL', '3mf', '3MF']) {
        const uri = { path: `/models/model.${extension}`, scheme: 'file' }
        window.tabGroups.activeTabGroup.activeTab.input = new TabInputText(uri)
        await handlers.get('scad-ai-ide.togglePreview')!()
        const type = extension === 'scad' ? previewFiles.previewEditorViewType : previewFiles.meshPreviewEditorViewType
        assert.equal(reopens.at(-1), type)
        window.tabGroups.activeTabGroup.activeTab.input = new TabInputCustom(uri, type)
        await handlers.get('scad-ai-ide.togglePreview')!()
        assert.equal(reopens.at(-1), 'default')
    }
})
