import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dependencyResolution } from '../../platform/openscad/dependencyResolution'

test('dependency resolution fingerprints missing shadow targets and skips comment/string lookalikes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cad-resolution-')), lib = join(root, 'lib')
    try {
        await mkdir(lib)
        await writeFile(join(lib, 'part.scad'), 'module part(){cube(1);}')
        const source = { path: join(root, 'model.scad'), text: 'use <part.scad>\n// include <fake.scad>\necho("use <string.scad>");\n/* use <other.scad> */' }
        const before = await dependencyResolution([source], [lib], () => true)
        assert.deepEqual(before.paths.sort(), [join(root, 'part.scad'), join(lib, 'part.scad')].sort())
        await writeFile(join(root, 'part.scad'), 'module part(){assert(false);}')
        const after = await dependencyResolution([source], [lib], () => true)
        assert.notEqual(after.hash, before.hash)
        assert.deepEqual(after.unresolved, [])
        await rm(join(root, 'part.scad'))
        const restored = await dependencyResolution([source], [lib], () => true)
        assert.equal(restored.hash, before.hash)
        if (process.platform !== 'win32') {
            await symlink(join(lib, 'part.scad'), join(root, 'part.scad'))
            const linked = await dependencyResolution([source], [lib], () => true)
            assert.ok(linked.unresolved.includes('DEPENDENCY_FILE_SYMLINK_RESOLUTION_UNPROVEN'))
        }
    } finally { await rm(root, { recursive: true, force: true }) }
})
