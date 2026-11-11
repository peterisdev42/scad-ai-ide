import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, cp, lstat, stat, realpath } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

// Diagnostic, not an acceptance gate. No user source or complete environment is collected.
assert.equal(process.platform, 'win32', 'This diagnostic requires actual Windows')
const binary = process.argv[2]
assert.ok(binary, 'Supply an explicit native CLI')
const require = createRequire(import.meta.url)
const { buildLibraryEnvironment } = require('../out/platform/libraries/LibraryEnvironment.js')
const root = await mkdtemp(path.join(os.tmpdir(), 'scad-env-probe-'))
const outcomes = []
const native = (args, options = {}) => {
    const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, ...options })
    return { exitCode: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }
}
const identity = async file => {
    try {
        const link = await lstat(file), target = await stat(file)
        return { exists: true, symbolicLink: link.isSymbolicLink(), directory: target.isDirectory(), realpath: await realpath(file) }
    } catch (error) { return { exists: false, error: error.code } }
}
const version = native(['--version'])
const binarySha256 = createHash('sha256').update(await readFile(binary)).digest('hex')
try {
    const store = path.join(root, 'store'), empty = path.join(root, 'empty')
    await mkdir(store); await mkdir(empty)
    await writeFile(path.join(store, 'smoke.scad'), 'module test_shape() { cube(10); }\n')
    const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'OPENSCADPATH'))
    const render = async ({ id, source, output, cwd, env, mount, kind }) => {
        const result = native(['--export-format', 'asciistl', '-o', output, source], { cwd, env })
        let width = null, sha256 = null, bytes = 0
        try {
            const stl = await readFile(output)
            bytes = stl.length; sha256 = createHash('sha256').update(stl).digest('hex')
            const vertices = [...stl.toString('utf8').matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)].map(match => Number(match[1]))
            if (vertices.length) width = Math.max(...vertices) - Math.min(...vertices)
        } catch { /* Missing geometry is evidence of failure. */ }
        outcomes.push({ id, kind, source, sourceUtf8Hex: Buffer.from(source).toString('hex'), output, cwd, searchEnvironment: Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() === 'OPENSCADPATH')), mount: mount ? await identity(mount) : null, ...result, bytes, sha256, geometryWidth: width, expectedWidth: 10, status: result.exitCode === 0 && width === 10 ? 'PASS' : 'FAIL' })
    }
    // Change exactly source, output or cwd from the ASCII cube baseline.
    const ascii = path.join(root, 'ascii'), unicode = path.join(root, '项目 A')
    for (const project of [ascii, unicode]) {
        await mkdir(project)
        await writeFile(path.join(project, 'cube.scad'), 'cube(10);\n')
    }
    for (const [id, project, outputRoot, cwd] of [
        ['binary-ascii', ascii, ascii, ascii],
        ['cube-unicode-source', unicode, ascii, ascii],
        ['cube-unicode-output', ascii, unicode, ascii],
        ['cube-unicode-cwd', ascii, ascii, unicode],
    ]) await render({ id, source: path.join(project, 'cube.scad'), output: path.join(outputRoot, id + '.stl'), cwd, env: cleanEnv, kind: 'no-include' })

    // Source and output remain ASCII while only the library root or link strategy changes.
    for (const [label, name, kind] of [
        ['ascii-direct', 'ascii-lib', 'direct'],
        ['unicode-direct', '库 目录', 'direct'],
        ['nonbmp-direct', 'library 😀', 'direct'],
        ['ascii-junction', 'junction-lib', 'junction'],
        ['unicode-junction', '链接 库', 'junction'],
        ['ascii-copy', 'copy-lib', 'copy'],
        ['ascii-symlink', 'symlink-lib', 'symlink'],
    ]) {
        const lib = path.join(root, name), mount = path.join(lib, 'fixture-library')
        await mkdir(lib)
        try {
            if (kind === 'junction' || kind === 'symlink') await symlink(store, mount, kind === 'junction' ? 'junction' : 'dir')
            else await cp(store, mount, { recursive: true })
        } catch (error) {
            outcomes.push({ id: label, kind, status: kind === 'symlink' && ['EPERM', 'EACCES'].includes(error.code) ? 'SKIP' : 'FAIL', reason: error.code })
            continue
        }
        const source = path.join(ascii, label + '.scad')
        await writeFile(source, 'include <fixture-library/smoke.scad>; test_shape();\n')
        await render({ id: label, source, output: path.join(ascii, label + '.stl'), cwd: ascii, env: { ...cleanEnv, OPENSCADPATH: lib }, mount, kind })
        if (label === 'ascii-direct') {
            for (const [variant, env] of [
                ['mixed-case', { ...cleanEnv, OpenSCADPath: lib }],
                ['multi-directory', { ...cleanEnv, OPENSCADPATH: empty + ';' + lib }],
                ['quoted-path', { ...cleanEnv, OPENSCADPATH: '"' + lib + '"' }],
                ['library-environment', buildLibraryEnvironment([lib], { ...cleanEnv, OpenSCADPath: empty })],
            ]) await render({ id: variant, source, output: path.join(ascii, variant + '.stl'), cwd: ascii, env, mount, kind })
        }
    }
    // Preserve the exact historical project/.scad/lib layout and relative-path experiment.
    for (const [label, project, linked] of [['historical-ascii', ascii, false], ['historical-unicode', unicode, false], ['historical-unicode-junction', path.join(root, '项目 B'), true]]) {
        const lib = path.join(project, '.scad/lib'), mount = path.join(lib, 'fixture-library')
        await mkdir(lib, { recursive: true })
        if (linked) await symlink(store, mount, 'junction')
        else await cp(store, mount, { recursive: true })
        const source = path.join(project, 'main.scad')
        await writeFile(source, 'include <fixture-library/smoke.scad>; test_shape();\n')
        for (const representation of ['absolute', 'relative']) await render({ id: `${label}-${representation}`, source, output: path.join(ascii, `${label}-${representation}.stl`), cwd: project, env: buildLibraryEnvironment([representation === 'absolute' ? lib : path.relative(project, lib)], process.env), mount, kind: linked ? 'junction' : 'direct' })
    }
} finally { await rm(root, { recursive: true, force: true }) }
const report = { scope: 'Actual Windows diagnostic; individual PASS does not imply Windows release gate PASS. Quoted-path is a probe, not a supported env contract.', binary, binarySha256, version, platform: process.platform, release: os.release(), arch: process.arch, node: process.version, image: { name: process.env.ImageOS, version: process.env.ImageVersion }, runUrl: process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null, sourceCommit: process.env.GITHUB_SHA ?? null, processEnvironment: 'Node spawnSync Unicode environment; no shell command concatenation', outcomes }
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
