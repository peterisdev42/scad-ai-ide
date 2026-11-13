import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runtimeExecutableFiles } from '../../platform/openscad/runtimeIdentity'

test('managed wrapper identity includes the underlying binary and detects replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cad-runtime-identity-'))
    try {
        const executable = join(root, 'bin', 'openscad'),
            binary = join(root, 'OpenSCAD.app', 'Contents', 'MacOS', 'OpenSCAD')
        await mkdir(join(root, 'bin'))
        await mkdir(join(root, 'OpenSCAD.app', 'Contents', 'MacOS'), { recursive: true })
        await writeFile(executable, '#!/bin/sh\nbase=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexec "$base/OpenSCAD.app/Contents/MacOS/OpenSCAD" "$@"\n')
        await writeFile(binary, 'first executable')
        const first = await runtimeExecutableFiles({ executable, argsPrefix: [] })
        assert.equal(first.complete, true)
        assert.equal(first.files.length, 2)
        await writeFile(binary, 'new executable')
        assert.notEqual((await runtimeExecutableFiles({ executable, argsPrefix: [] })).key, first.key)
        await writeFile(executable, '#!/bin/sh\nexec unknown-runtime "$@"\n')
        assert.equal((await runtimeExecutableFiles({ executable, argsPrefix: [] })).complete, false)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
