import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

// Diagnostic, not an acceptance gate. Preserve actual Unicode/junction/native
// failures while comparing equivalent path representations before redesigning.
assert.equal(process.platform, 'win32', 'This diagnostic requires actual Windows')
const binary = process.argv[2]
assert.ok(binary, 'Supply an explicit native CLI')
const require = createRequire(import.meta.url)
const { buildLibraryEnvironment } = require('../out/platform/libraries/LibraryEnvironment.js')
const root = await mkdtemp(path.join(os.tmpdir(), 'scad-env-probe-'))
const outcomes = []
try {
    const store = path.join(root, 'store')
    await mkdir(store)
    await writeFile(path.join(store, 'smoke.scad'), 'module test_shape() { cube(10); }\n')
    for (const [label, name, linked] of [['ascii', 'ascii', false], ['unicode-direct', '项目 A', false], ['unicode-junction', '项目 B', true]]) {
        const project = path.join(root, name), lib = path.join(project, '.scad/lib')
        const mount = path.join(lib, 'fixture-library')
        await mkdir(lib, { recursive: true })
        if (linked) await symlink(store, mount, 'junction')
        else { await mkdir(mount); await writeFile(path.join(mount, 'smoke.scad'), 'module test_shape() { cube(10); }\n') }
        const source = path.join(project, 'main.scad')
        await writeFile(source, 'include <fixture-library/smoke.scad>; test_shape();\n')
        assert.match(await readFile(path.join(mount, 'smoke.scad'), 'utf8'), /cube\(10\)/, 'Node must observe the real linked/direct source')
        for (const representation of ['absolute', 'relative']) {
            const searchPath = representation === 'absolute' ? lib : path.relative(project, lib)
            const output = path.join(root, `${label}-${representation}.stl`)
            const native = spawnSync(binary, ['--export-format', 'asciistl', '-o', output, source], { cwd: project, env: buildLibraryEnvironment([searchPath], process.env), encoding: 'utf8', timeout: 30000 })
            let width = null
            try {
                const stl = await readFile(output, 'utf8')
                const vertices = [...stl.matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)].map(match => Number(match[1]))
                if (vertices.length) width = Math.max(...vertices) - Math.min(...vertices)
            } catch { /* Missing output remains an observed failure, never PASS. */ }
            outcomes.push({ label, representation, cwd: project, searchPath, status: native.status, signal: native.signal, error: native.error?.message, stderr: native.stderr?.slice(-3000), geometryWidth: width, expectedWidth: 10 })
        }
    }
} finally { await rm(root, { recursive: true, force: true }) }
const report = { scope: 'Actual Windows diagnostic; no test acceptance inferred', binary, outcomes }
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
