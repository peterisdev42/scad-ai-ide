import { NotificationCenter } from '../../core/notifications/NotificationCenter'
import { createNotifications } from '../../core/notifications/createNotifications'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import * as vm from 'node:vm'
import { transformSync } from 'esbuild'
import { RuntimeUnavailableError } from '../../core/runtime/errors'

function mockRenderError(selectAction = true) {
    const notices: { message: string; action: string }[] = []
    const commands: unknown[][] = []
    let outputShown = 0
    const module = { exports: {} as { showRenderError: (error: Error, showOutput: () => void) => Promise<void> } }
    const source = readFileSync(new URL('../../features/preview/extension/services/renderError.ts', import.meta.url), 'utf8')
    const notifications = createNotifications(
        new NotificationCenter(
            async (notice) => {
                const action = notice.actions?.[0]?.label ?? ''
                notices.push({ message: notice.message, action })
                return selectAction ? action : undefined
            },
            (error) => {
                throw error
            },
        ),
        (command, ...args) => {
            commands.push([command, ...args])
        },
    )
    const sandbox = {
        module,
        require: (id: string) => {
            if (id.endsWith('/platform/notifications')) return { notifications }
            throw new Error(`Unexpected dependency: ${id}`)
        },
    }
    vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, sandbox)
    return {
        notifications,
        notices,
        commands,
        show: (error: Error) => module.exports.showRenderError(error, () => outputShown++),
        outputShown: () => outputShown,
    }
}

test('missing Runtime offers simple installation guidance and opens Available', async () => {
    const mock = mockRenderError()
    const error = new RuntimeUnavailableError()
    await mock.show(error)
    assert.equal(mock.notices[0].action, 'Install OpenSCAD CLI')
    assert.equal(mock.notices[0].message, 'No OpenSCAD runtime is available.')
    assert.deepEqual(mock.commands, [['scad-ai.runtime.open', 'available']])
    assert.equal(mock.outputShown(), 0)
})

test('compiler failures still show output and do not open Runtime management', async () => {
    const mock = mockRenderError()
    await mock.show(new Error('OpenSCAD exited with code 1\nParser error: line 3'))
    assert.equal(mock.notices[0].action, 'Show Output')
    assert.equal(mock.notices[0].message, 'OpenSCAD render failed: OpenSCAD exited with code 1')
    assert.deepEqual(mock.commands, [])
    assert.equal(mock.outputShown(), 1)
})

test('dismissing missing-Runtime guidance does not open another panel', async () => {
    const mock = mockRenderError(false)
    await mock.show(new RuntimeUnavailableError())
    assert.deepEqual(mock.commands, [])
    assert.equal(mock.outputShown(), 0)
})

test('startup and multiple preview failures share one unresolved Runtime problem', async () => {
    const mock = mockRenderError()
    await Promise.all([mock.notifications.runtimeUnavailable(), mock.show(new RuntimeUnavailableError()), mock.show(new RuntimeUnavailableError())])
    await mock.show(new RuntimeUnavailableError())
    assert.equal(mock.notices.length, 1)
    assert.equal(mock.commands.length, 1)
    mock.notifications.runtimeAvailable()
    await mock.show(new RuntimeUnavailableError())
    assert.equal(mock.notices.length, 2)
})
