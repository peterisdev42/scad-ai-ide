import assert from 'node:assert/strict'
import test from 'node:test'
import { NotificationCenter, type Notification } from '../core/notifications/NotificationCenter'
import { createNotifications } from '../core/notifications/createNotifications'
import { RuntimeUnavailableError } from '../core/runtime/errors'

const problem: Notification = { id: 'test.failure', severity: 'error', message: 'Failed', policy: 'until-resolved' }

test('concurrent producers and dismissed persistent issues aggregate until recovery', async () => {
    const shown: Notification[] = []
    let close!: (choice: string | undefined) => void
    let actions = 0
    const center = new NotificationCenter(
        (notice) => {
            shown.push(notice)
            return new Promise((resolve) => {
                close = resolve
            })
        },
        (error) => {
            throw error
        },
    )
    const notice = {
        ...problem,
        actions: [
            {
                label: 'Fix',
                run: () => {
                    actions++
                },
            },
        ],
    }
    const first = center.notify(notice)
    const second = center.notify({ ...notice, message: 'Same cause, another producer' })
    assert.equal(first, second)
    await Promise.resolve()
    assert.equal(shown.length, 1)
    close('Fix')
    await Promise.all([first, second])
    await center.notify(notice)
    assert.equal(actions, 1)
    assert.equal(shown.length, 1)
    center.resolve(problem.id)
    const again = center.notify(notice)
    await Promise.resolve()
    close(undefined)
    await again
    await center.notify(notice)
    assert.equal(shown.length, 2)
})

test('transient notifications distinguish file and error and reappear after cooldown', async () => {
    let now = 0
    const shown: Notification[] = []
    const center = new NotificationCenter(
        async (notice) => {
            shown.push(notice)
            return undefined
        },
        (error) => {
            throw error
        },
        () => now,
        100,
    )
    const notice: Notification = { ...problem, policy: 'cooldown', scope: 'file-a' }
    await center.notify(notice)
    await center.notify(notice)
    await center.notify({ ...notice, scope: 'file-b' })
    await center.notify({ ...notice, message: 'Different failure' })
    assert.equal(shown.length, 3)
    now = 100
    await center.notify(notice)
    assert.equal(shown.length, 4)
})

test('UI and action failures are contained and permit retry', async () => {
    const errors: unknown[] = []
    let count = 0
    const center = new NotificationCenter(
        async () => {
            if (++count === 1) throw new Error('UI failure')
            return 'Fix'
        },
        (error) => errors.push(error),
    )
    const notice = {
        ...problem,
        actions: [
            {
                label: 'Fix',
                run: () => {
                    throw new Error('Action failure')
                },
            },
        ],
    }
    await center.notify(notice)
    await center.notify(notice)
    assert.equal(count, 2)
    assert.equal(errors.length, 2)
})

test('recovery and disposal invalidate actions in old UI prompts', async () => {
    const choices: ((choice: string) => void)[] = []
    let actions = 0
    const center = new NotificationCenter(
        () => new Promise((resolve) => choices.push(resolve)),
        (error) => {
            throw error
        },
    )
    const notice = {
        ...problem,
        actions: [
            {
                label: 'Fix',
                run: () => {
                    actions++
                },
            },
        ],
    }
    const old = center.notify(notice)
    await Promise.resolve()
    center.resolve(problem.id)
    const current = center.notify(notice)
    await Promise.resolve()
    choices[0]('Fix')
    await old
    center.dispose()
    choices[1]('Fix')
    await current
    await center.notify(notice)
    assert.equal(actions, 0)
    assert.equal(choices.length, 2)
    center.reset()
    const next = center.notify(notice)
    await Promise.resolve()
    choices[2]('Fix')
    await next
    assert.equal(actions, 1)
})

test('catalog merges missing Runtime from startup, rendering, export and slicer', async () => {
    const shown: Notification[] = []
    const commands: unknown[][] = []
    const notifications = createNotifications(
        new NotificationCenter(
            async (notice) => {
                shown.push(notice)
                return notice.actions?.[0]?.label
            },
            (error) => {
                throw error
            },
        ),
        (...args) => commands.push(args),
    )
    const missing = new RuntimeUnavailableError()
    await Promise.all([notifications.runtimeUnavailable(), notifications.renderFailed(missing, () => assert.fail('must not show compiler output'), 'file-a'), notifications.exportFailed(missing, 'STL', 'file-b'), notifications.slicerFailed(missing, 'file-c'), notifications.previewError(missing, 'file-d')])
    assert.equal(shown.length, 1)
    assert.equal(shown[0].message, 'No OpenSCAD runtime is available.')
    assert.deepEqual(commands, [['scad-ai.runtime.open', 'available']])
    notifications.runtimeAvailable()
    await notifications.runtimeUnavailable()
    assert.equal(shown.length, 2)
})

test('language failure is aggregated independently and resets on successful start', async () => {
    const shown: Notification[] = []
    const notifications = createNotifications(
        new NotificationCenter(
            async (notice) => {
                shown.push(notice)
                return undefined
            },
            (error) => {
                throw error
            },
        ),
        () => {},
    )
    await notifications.languageUnavailable()
    await notifications.languageUnavailable()
    await notifications.runtimeUnavailable()
    assert.equal(shown.length, 2)
    notifications.languageAvailable()
    await notifications.languageUnavailable()
    assert.equal(shown.length, 3)
})

test('compiler failures preserve full error identity even when their visible summary matches', async () => {
    const shown: Notification[] = []
    const notifications = createNotifications(
        new NotificationCenter(
            async (notice) => {
                shown.push(notice)
                return undefined
            },
            (error) => {
                throw error
            },
        ),
        () => {},
    )
    const first = new Error('OpenSCAD exited with code 1\nParser error: line 3')
    const second = new Error('OpenSCAD exited with code 1\nParser error: line 8')
    await notifications.renderFailed(first, () => {}, 'file-a')
    await notifications.renderFailed(first, () => {}, 'file-a')
    await notifications.renderFailed(second, () => {}, 'file-a')
    await notifications.renderFailed(first, () => {}, 'file-b')
    assert.equal(shown.length, 3)
    assert.equal(shown[0].message, shown[1].message)
})

test('transient problem remains aggregated while its UI is open beyond the cooldown', async () => {
    let now = 0
    let close!: (choice: undefined) => void
    let shown = 0
    const center = new NotificationCenter(
        () => {
            shown++
            return new Promise((resolve) => {
                close = resolve
            })
        },
        (error) => {
            throw error
        },
        () => now,
        100,
    )
    const notice: Notification = { ...problem, policy: 'cooldown' }
    const first = center.notify(notice)
    await Promise.resolve()
    now = 1000
    assert.equal(center.notify(notice), first)
    assert.equal(shown, 1)
    close(undefined)
    await first
    now = 1099
    await center.notify(notice)
    assert.equal(shown, 1)
    now = 1100
    const next = center.notify(notice)
    await Promise.resolve()
    assert.equal(shown, 2)
    close(undefined)
    await next
})
