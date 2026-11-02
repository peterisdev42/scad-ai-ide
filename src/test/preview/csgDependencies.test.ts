import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCliDependencies } from '../../core/formats/dependencies'
import { compileCsg, configureCsgWorker } from '../../core/csg/compile'

configureCsgWorker(join(process.cwd(), 'dist/csg-worker.mjs'))
test('CLI include dependencies preserve escaped filenames and reject stale resource stamps', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scad-include-'))
    try {
        const file = join(directory, 'library name.scad'),
            depfile = join(directory, 'model.d')
        await writeFile(file, 'module part(){cube(5);}')
        await writeFile(depfile, `model.csg: \\\n\tlibrary\\ name.scad\n`)
        const dependencies = await readCliDependencies(depfile, directory)
        const info = await stat(file)
        assert.deepEqual(dependencies, [{ path: file, stamp: `${info.mtimeMs}:${info.size}` }])
        const scene = JSON.parse((await compileCsg('cube(size=[5,5,5]);', undefined, { dependencies })).toString())
        assert.deepEqual(scene.dependencies, dependencies)
        await writeFile(file, 'module part(){sphere(15);}')
        await assert.rejects(compileCsg('cube(size=[5,5,5]);', undefined, { dependencies }), /resource changed during compilation/)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
