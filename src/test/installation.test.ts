import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { gzipSync } from 'node:zlib'
import * as tar from 'tar'
import { zipSync, strToU8 } from 'fflate'
import { discover, probe, type Runtime } from '../platform/runtime/discovery'
import { extractRuntimeArchive, installRuntimeArchive, installRuntimeBuild, installedRuntimeBuilds, managedDirectory, managedRuntimePaths, removeRuntimeInstallation } from '../platform/runtime/installation'
import type { RuntimeBuild, RuntimeSystem } from '../platform/runtime/releases'

const system: RuntimeSystem = { platform: process.platform, architecture: process.arch, name: '', version: '' }
const build: RuntimeBuild = { id: 100, name: `openscad-cli-${process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch}.tar.gz`, tag: 'test', release: '2026.10.28-TEST10', size: 0, prerelease: false, publishedAt: '', downloadUrl: 'https://example.test/archive', checksumUrl: 'https://example.test/checksum' }

async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'scad-install-test-'))
    const name = build.name.replace('.tar.gz', '')
    const source = path.join(root, 'source')
    await mkdir(path.join(source, name, 'bin'), { recursive: true })
    const executable = path.join(source, name, 'bin/openscad')
    await writeFile(executable, '#!/bin/sh\necho "OpenSCAD version 2021.01"\n')
    await chmod(executable, 0o755)
    await writeFile(path.join(source, name, 'build-info.json'), JSON.stringify({ tag: 'openscad-2026.10-TEST2' }))
    await mkdir(path.join(source, name, 'lib'))
    await writeFile(path.join(source, name, 'lib/dependency'), 'bundled dependency')
    await symlink('dependency', path.join(source, name, 'lib/current'))
    const archive = path.join(root, build.name)
    await tar.c({ file: archive, cwd: source, gzip: true }, [name])
    const bytes = await readFile(archive)
    const checksum = createHash('sha256').update(bytes).digest('hex')
    const request: typeof fetch = async (url) => new Response(String(url).endsWith('/checksum') ? `${checksum}  ${build.name}\n` : bytes)
    return { root, bytes, request, storage: path.join(root, 'runtimes') }
}

const unixOnly = { skip: process.platform === 'win32' }

test('installation verifies, extracts, probes and discovers all managed versions from disk', unixOnly, async () => {
    const f = await fixture()
    try {
        const progress: string[] = []
        const first = await installRuntimeBuild(f.storage, system, { ...build, size: f.bytes.length }, { request: f.request, progress: (p) => progress.push(p.message) })
        const second = await installRuntimeBuild(f.storage, system, { ...build, id: 101, tag: 'other' }, { request: f.request })
        assert.notEqual(first, second)
        assert.ok(progress.includes('Verifying download…'))
        assert.ok(progress.includes('Extracting…'))
        assert.ok(progress.includes('Checking runtime…'))
        assert.equal(await readFile(path.join(path.dirname(first), '../lib/current'), 'utf8'), 'bundled dependency')
        const paths = await managedRuntimePaths(f.storage, system)
        assert.deepEqual(paths.sort(), [first, second].sort())
        const result = await discover({ platform: process.platform, env: {}, managedPaths: paths }, { collect: async () => ({ candidates: [], diagnostics: [] }) })
        assert.equal(result.runtimes.filter((runtime) => runtime.source === 'managed').length, 2)
        assert.deepEqual(result.runtimes.map((runtime) => runtime.tag).sort(), ['other', build.tag].sort(), 'Release tags must override the CLI version and bundled metadata')
        assert.ok(
            result.runtimes.every((runtime) => runtime.release === build.release),
            'Release names must survive installation and rediscovery',
        )
        assert.ok(result.runtimes.every((runtime) => runtime.source !== 'managed' || runtime.installPath))
        const sentinel = path.join(path.dirname(path.dirname(first)), 'old-installation-marker')
        await writeFile(sentinel, 'remove during reinstall')
        let removed = false
        let downloaded = false
        assert.equal(
            await installRuntimeBuild(f.storage, system, build, {
                onRemoved: async () => {
                    removed = true
                    assert.deepEqual(await managedRuntimePaths(f.storage, system), [second])
                },
                request: async (url, options) => {
                    assert.ok(removed)
                    downloaded = true
                    await assert.rejects(readFile(sentinel))
                    return f.request(url, options)
                },
            }),
            first,
        )
        assert.ok(downloaded)
        await assert.rejects(readFile(sentinel))
        await rm(first)
        assert.equal(await installRuntimeBuild(f.storage, system, build, { request: f.request }), first)
        assert.match(await readFile(first, 'utf8'), /OpenSCAD version/)
        await rm(path.dirname(path.dirname(second)), { recursive: true })
        const rescanned = await discover({ platform: process.platform, env: {}, managedPaths: await managedRuntimePaths(f.storage, system) }, { collect: async () => ({ candidates: [], diagnostics: [] }) })
        assert.equal(rescanned.runtimes.filter((runtime) => runtime.source === 'managed').length, 1)
        assert.ok((await readdir(managedDirectory(f.storage, system))).every((name) => !name.startsWith('.install-')))
    } finally {
        await rm(f.root, { recursive: true, force: true })
    }
})

test('failed or cancelled installs never publish a partial runtime and clean staging', unixOnly, async () => {
    const f = await fixture()
    try {
        const cases: Array<{ request?: typeof fetch; check?: (candidate: Parameters<typeof import('../platform/runtime/discovery').probe>[0]) => Promise<Runtime>; size?: number; signal?: AbortSignal }> = [
            { request: async () => new Response('', { status: 503 }) },
            { request: async (url) => (String(url).endsWith('/checksum') ? new Response('0'.repeat(64)) : new Response(f.bytes)) },
            { size: f.bytes.length + 1 },
            {
                check: async () => {
                    throw new Error('not a working runtime')
                },
            },
            { signal: AbortSignal.abort() },
        ]
        for (const options of cases) {
            await assert.rejects(installRuntimeBuild(f.storage, system, { ...build, size: options.size ?? 0 }, { request: f.request, ...options }))
            assert.deepEqual(await managedRuntimePaths(f.storage, system), [])
            assert.deepEqual(await readdir(managedDirectory(f.storage, system)), [])
        }
        await assert.rejects(installRuntimeBuild(f.storage, { ...system, architecture: 'unknown' }, build, { request: f.request }), /does not match/)
    } finally {
        await rm(f.root, { recursive: true, force: true })
    }
})

test('Windows ZIP installation preserves dependency files and discovers openscad.exe', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'scad-zip-install-'))
    try {
        const windows: RuntimeSystem = { platform: 'win32', architecture: 'x64', name: 'Windows', version: '' }
        const bytes = zipSync({ 'openscad-cli-windows-x86_64/bin/openscad.exe': strToU8('test executable'), 'openscad-cli-windows-x86_64/bin/runtime.dll': strToU8('dependency') })
        const executable = await installRuntimeBuild(
            root,
            windows,
            { ...build, name: 'openscad-cli-windows-x86_64.zip', checksumUrl: undefined, size: bytes.length },
            {
                request: async () => new Response(Buffer.from(bytes)),
                check: async (candidate) => {
                    assert.equal(await readFile(candidate.command.executable, 'utf8'), 'test executable')
                    return { ...candidate, id: 'test', version: '2021.01', platform: 'win32', status: 'available' }
                },
            },
        )
        assert.equal(path.basename(executable), 'openscad.exe')
        assert.equal(await readFile(path.join(path.dirname(executable), 'runtime.dll'), 'utf8'), 'dependency')
        assert.deepEqual(await managedRuntimePaths(root, windows), [executable])
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

function tarEntry(name: string, type = '0', link = ''): Buffer {
    const header = Buffer.alloc(512)
    header.write(name, 0, 100)
    header.write('0000755\0', 100)
    header.write('0000000\0', 108)
    header.write('0000000\0', 116)
    header.write('00000000000\0', 124)
    header.write('00000000000\0', 136)
    header.fill(32, 148, 156)
    header.write(type, 156)
    header.write(link, 157, 100)
    header.write('ustar\0', 257)
    const checksum = [...header].reduce((total, byte) => total + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148)
    return gzipSync(Buffer.concat([header, Buffer.alloc(1024)]))
}

test('archive extraction rejects traversal and escaping symlinks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'scad-unsafe-archive-'))
    try {
        for (const [name, type, link] of [
            ['../escaped', '0', ''],
            ['/absolute', '0', ''],
            ['package/link', '2', '../../escaped'],
        ]) {
            const archive = path.join(root, 'unsafe.tar.gz')
            await writeFile(archive, tarEntry(name, type, link))
            await assert.rejects(extractRuntimeArchive(archive, path.join(root, 'output')), /Unsafe|external link/)
        }
        const archive = path.join(root, 'unsafe.zip')
        await writeFile(archive, zipSync({ '../escaped': strToU8('bad') }))
        await assert.rejects(extractRuntimeArchive(archive, path.join(root, 'zip-output')), /invalid relative path|Unsafe/)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('local archive imports copy, verify and discover a renamed package offline, without retaining archives or duplicate imports', unixOnly, async () => {
    const f = await fixture()
    try {
        const source = path.join(f.root, 'my downloaded runtime (1).tar.gz')
        await writeFile(source, f.bytes)
        const stages: string[] = []
        let checks = 0
        const executable = await installRuntimeArchive(f.storage, system, source, {
            request: async () => {
                throw new Error('Local installation must not access the network')
            },
            progress: (progress) => stages.push(progress.message),
            check: async (candidate) => {
                checks++
                if (candidate.command.executable.includes('.install-')) {
                    const entries = await readdir(managedDirectory(f.storage, system))
                    const staging = entries.find((name) => name.startsWith('.install-'))!
                    assert.deepEqual(await readFile(path.join(managedDirectory(f.storage, system), staging, 'runtime.tar.gz')), f.bytes)
                }
                return probe(candidate)
            },
        })
        assert.equal(checks, 2)
        assert.ok(stages.includes('Copying archive…'))
        assert.ok(stages.includes('Extracting…'))
        assert.ok(stages.includes('Checking runtime…'))
        assert.match(executable, /local-[a-f0-9]{64}/)
        assert.deepEqual(await readFile(source), f.bytes)
        const entries = await readdir(managedDirectory(f.storage, system))
        assert.equal(entries.length, 1)
        const contents = await readdir(path.join(managedDirectory(f.storage, system), entries[0]))
        assert.ok(!contents.some((name) => name.endsWith('.zip') || name.endsWith('.tar.gz')))
        assert.equal(await installRuntimeArchive(f.storage, system, source), executable)
        assert.deepEqual(await readdir(managedDirectory(f.storage, system)), entries)
        const result = await discover({ platform: process.platform, env: {}, managedPaths: await managedRuntimePaths(f.storage, system) }, { collect: async () => ({ candidates: [], diagnostics: [] }) })
        assert.equal(result.runtimes.filter((runtime) => runtime.source === 'managed').length, 1)
        assert.equal(result.runtimes[0].tag, 'openscad-cli-2026.10-TEST2')
    } finally {
        await rm(f.root, { recursive: true, force: true })
    }
})

test('local Windows ZIP imports preserve dependencies and their source archives', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'scad-local-zip-'))
    try {
        const windows: RuntimeSystem = { platform: 'win32', architecture: 'x64', name: 'Windows', version: '' }
        const source = path.join(root, 'download.ZIP')
        const bytes = zipSync({ 'openscad-cli-windows-x86_64/bin/openscad.exe': strToU8('test executable'), 'openscad-cli-windows-x86_64/bin/runtime.dll': strToU8('dependency') })
        await writeFile(source, bytes)
        const storage = path.join(root, 'runtimes')
        const executable = await installRuntimeArchive(storage, windows, source, {
            check: async (candidate) => {
                assert.equal(await readFile(candidate.command.executable, 'utf8'), 'test executable')
                return { ...candidate, id: 'test', version: '2021.01', platform: 'win32', status: 'available' }
            },
        })
        assert.equal(await readFile(path.join(path.dirname(executable), 'runtime.dll'), 'utf8'), 'dependency')
        assert.deepEqual(await readFile(source), Buffer.from(bytes))
        assert.deepEqual(await managedRuntimePaths(storage, windows), [executable])
        assert.equal((await readdir(managedDirectory(storage, windows))).length, 1)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('failed validation in staging or at the final path removes all imported files and keeps the original archive', unixOnly, async () => {
    const f = await fixture()
    try {
        const source = path.join(f.root, build.name)
        for (const failAfterMove of [false, true]) {
            let calls = 0
            await assert.rejects(
                installRuntimeArchive(f.storage, system, source, {
                    check: async (candidate) => {
                        calls++
                        if (!failAfterMove || !candidate.command.executable.includes('.install-')) {
                            throw new Error('CLI validation failed')
                        }
                        return probe(candidate)
                    },
                }),
                /CLI validation failed/,
            )
            assert.ok(calls >= 1)
            assert.deepEqual(await readFile(source), f.bytes)
            assert.deepEqual(await readdir(managedDirectory(f.storage, system)), [])
            assert.deepEqual(await managedRuntimePaths(f.storage, system), [])
        }
    } finally {
        await rm(f.root, { recursive: true, force: true })
    }
})

test('local cancelled copies, invalid archives and wrong-platform packages leave no installation or copied archive', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'scad-local-invalid-'))
    const windows: RuntimeSystem = { platform: 'win32', architecture: 'x64', name: 'Windows', version: '' }
    const storage = path.join(root, 'runtimes')
    try {
        for (const bytes of [strToU8('not a zip'), zipSync({ 'openscad-cli-windows-arm64/bin/openscad.exe': strToU8('wrong architecture') }), zipSync({ '../escaped': strToU8('bad') })]) {
            const source = path.join(root, 'download.zip')
            await writeFile(source, bytes)
            await assert.rejects(installRuntimeArchive(storage, windows, source))
            assert.deepEqual(await readFile(source), Buffer.from(bytes))
            assert.deepEqual(await readdir(managedDirectory(storage, windows)), [])
        }
        const source = path.join(root, 'download.zip')
        const bytes = zipSync({ 'openscad-cli-windows-x86_64/bin/openscad.exe': strToU8('test executable') })
        await writeFile(source, bytes)
        const abort = new AbortController()
        await assert.rejects(
            installRuntimeArchive(storage, windows, source, {
                signal: abort.signal,
                progress: (value) => {
                    if (value.message === 'Copying archive…') {
                        abort.abort()
                    }
                },
            }),
        )
        assert.deepEqual(await readFile(source), Buffer.from(bytes))
        assert.deepEqual(await readdir(managedDirectory(storage, windows)), [])
        await assert.rejects(installRuntimeArchive(storage, windows, path.join(root, 'unsupported.rar')), /\.zip or \.tar\.gz/)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('Available installation detection reads asset directories and imported release metadata, including damaged runtimes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'scad-install-status-'))
    const windows: RuntimeSystem = { platform: 'win32', architecture: 'x64', name: 'Windows', version: '' }
    const release = { ...build, name: 'openscad-cli-windows-x86_64.zip', tag: 'openscad-cli-2026.10-TEST4' }
    try {
        const directory = managedDirectory(root, windows)
        const online = path.join(directory, String(release.id))
        const imported = path.join(directory, `local-${'a'.repeat(64)}`)
        const unrelated = path.join(directory, `local-${'b'.repeat(64)}`)
        for (const file of [online, imported, unrelated]) {
            await mkdir(file, { recursive: true })
        }
        await writeFile(path.join(imported, 'build-info.json'), JSON.stringify({ tag: 'openscad-2026.10-TEST4' }))
        await writeFile(path.join(unrelated, 'build-info.json'), JSON.stringify({ tag: 'openscad-2021.01' }))
        const status = await installedRuntimeBuilds(root, windows, [release])
        assert.equal(status.length, 1)
        assert.equal(status[0].id, release.id)
        assert.deepEqual(status[0].directories.sort(), [online, imported].sort())
        await rm(online, { recursive: true })
        assert.deepEqual((await installedRuntimeBuilds(root, windows, [release]))[0].directories, [imported])
        await rm(imported, { recursive: true })
        assert.deepEqual(await installedRuntimeBuilds(root, windows, [release]), [])
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('reinstall removes matching offline imports before downloading and preserves other versions and the original ZIP', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'scad-reinstall-'))
    const windows: RuntimeSystem = { platform: 'win32', architecture: 'x64', name: 'Windows', version: '' }
    try {
        const release = { ...build, name: 'openscad-cli-windows-x86_64.zip', tag: 'openscad-cli-2026.10-TEST4', checksumUrl: undefined }
        const bytes = zipSync({
            'openscad-cli-windows-x86_64/bin/openscad.exe': strToU8('test executable'),
            'openscad-cli-windows-x86_64/build-info.json': strToU8(JSON.stringify({ tag: 'openscad-2026.10-TEST4' })),
        })
        const source = path.join(root, 'download.zip')
        await writeFile(source, bytes)
        const storage = path.join(root, 'runtimes')
        const check = async (candidate: Parameters<typeof probe>[0]): Promise<Runtime> => {
            assert.equal(await readFile(candidate.command.executable, 'utf8'), 'test executable')
            return { ...candidate, id: 'test', version: '2026.10-TEST4', platform: 'win32', status: 'available' }
        }
        const local = await installRuntimeArchive(storage, windows, source, { check })
        const other = path.join(managedDirectory(storage, windows), '999')
        await mkdir(other)
        await writeFile(path.join(other, 'keep'), 'other version')
        let removed = false
        const executable = await installRuntimeBuild(storage, windows, release, {
            check,
            onRemoved: async () => {
                removed = true
                await assert.rejects(readFile(local))
                assert.deepEqual(await installedRuntimeBuilds(storage, windows, [release]), [])
            },
            request: async () => {
                assert.ok(removed)
                await assert.rejects(readFile(local))
                return new Response(Buffer.from(bytes))
            },
        })
        assert.ok(removed)
        assert.equal(path.basename(path.dirname(path.dirname(executable))), String(release.id))
        assert.deepEqual(await readFile(source), Buffer.from(bytes))
        assert.equal(await readFile(path.join(other, 'keep'), 'utf8'), 'other version')
        const status = await installedRuntimeBuilds(storage, windows, [release])
        assert.deepEqual(status[0].directories, [path.dirname(path.dirname(executable))])
        // Failure after removal must not retain an old runtime or a partial new install.
        await assert.rejects(installRuntimeBuild(storage, windows, release, { request: async () => new Response('', { status: 503 }) }), /HTTP 503/)
        assert.deepEqual(await installedRuntimeBuilds(storage, windows, [release]), [])
        assert.deepEqual(await readdir(managedDirectory(storage, windows)), ['999'])
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('runtime deletion removes only the selected managed installation and rejects paths outside its ownership', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'scad-delete-'))
    const windows: RuntimeSystem = { platform: 'win32', architecture: 'x64', name: 'Windows', version: '' }
    const storage = path.join(root, 'runtimes')
    const first = path.join(managedDirectory(storage, windows), '100')
    const second = path.join(managedDirectory(storage, windows), '101')
    const external = path.join(root, 'system-install')
    try {
        for (const directory of [first, second, external]) {
            await mkdir(path.join(directory, 'bin'), { recursive: true })
            await writeFile(path.join(directory, 'bin/openscad.exe'), 'executable')
            await writeFile(path.join(directory, 'dependency.dll'), 'dependency')
        }
        for (const invalid of [external, root, managedDirectory(storage, windows), path.join(first, 'bin')]) {
            await assert.rejects(removeRuntimeInstallation(storage, windows, invalid), /Only extension-managed/)
        }
        await removeRuntimeInstallation(storage, windows, first)
        await assert.rejects(readFile(path.join(first, 'dependency.dll')), { code: 'ENOENT' })
        assert.deepEqual(await managedRuntimePaths(storage, windows), [path.join(second, 'bin/openscad.exe')])
        assert.equal(await readFile(path.join(second, 'dependency.dll'), 'utf8'), 'dependency')
        assert.equal(await readFile(path.join(external, 'bin/openscad.exe'), 'utf8'), 'executable')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
