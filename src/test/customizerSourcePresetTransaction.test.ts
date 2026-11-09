import assert from 'node:assert/strict'
import test from 'node:test'
import { commitPresetFile, type PresetTransactionPort } from '../core/customizer/CustomizerPresetTransaction'

const bytes = (text: string) => new TextEncoder().encode(text)
function fixture() {
    let disk: Uint8Array | undefined = bytes('original')
    let temporary: Uint8Array | undefined
    const port: PresetTransactionPort = {
        read: async () => disk,
        stage: async content => { temporary = content },
        replace: async () => { disk = temporary; temporary = undefined },
        cleanup: async () => { temporary = undefined },
    }
    return { port, disk: () => disk, temporary: () => temporary, external: (text: string) => { disk = bytes(text) } }
}

test('preset storage stages and atomically replaces only the expected original', async () => {
    const f = fixture()
    await commitPresetFile('success', f.port, bytes('original'), bytes('new'), () => {})
    assert.deepEqual(f.disk(), bytes('new'))
    assert.equal(f.temporary(), undefined)
})

test('external edits before or during staging survive with STALE_PRESET and no temp leak', async () => {
    for (const during of [false, true]) {
        const f = fixture()
        if (during) {
            const stage = f.port.stage
            f.port.stage = async content => { await stage(content); f.external('external') }
        } else f.external('external')
        await assert.rejects(commitPresetFile(`race-${during}`, f.port, bytes('original'), bytes('new'), () => {}), { code: 'STALE_PRESET' })
        assert.deepEqual(f.disk(), bytes('external'))
        assert.equal(f.temporary(), undefined)
    }
})

test('failed staging, rename and final target guard preserve the original and clean temporary data', async () => {
    for (const failure of ['stage', 'rename', 'target']) {
        const f = fixture()
        if (failure === 'stage') {
            const stage = f.port.stage
            f.port.stage = async content => { await stage(content); throw new Error('write failed') }
        }
        if (failure === 'rename') f.port.replace = async () => { throw new Error('rename failed') }
        let checks = 0
        await assert.rejects(commitPresetFile(failure, f.port, bytes('original'), bytes('new'), () => {
            if (failure === 'target' && ++checks === 4) throw new Error('target changed')
        }))
        assert.deepEqual(f.disk(), bytes('original'))
        assert.equal(f.temporary(), undefined)
    }
})

test('concurrent extension writers cannot overwrite a completed transaction with an old snapshot', async () => {
    const f = fixture()
    const results = await Promise.allSettled([
        commitPresetFile('concurrent', f.port, bytes('original'), bytes('first'), () => {}),
        commitPresetFile('concurrent', f.port, bytes('original'), bytes('second'), () => {}),
    ])
    assert.equal(results[0].status, 'fulfilled')
    assert.equal(results[1].status, 'rejected')
    assert.deepEqual(f.disk(), bytes('first'))
    assert.equal(f.temporary(), undefined)
    await commitPresetFile('concurrent', f.port, bytes('first'), bytes('third'), () => {})
    assert.deepEqual(f.disk(), bytes('third'), 'Lock must be released after a stale writer rejects')
})

test('file creation detects another writer creating the previously missing destination', async () => {
    const f = fixture()
    await assert.rejects(commitPresetFile('create', f.port, undefined, bytes('new'), () => {}), { code: 'STALE_PRESET' })
    assert.deepEqual(f.disk(), bytes('original'))
})
