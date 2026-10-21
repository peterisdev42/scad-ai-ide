import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { discover, fileCandidate, getCandidates, parseVersion, probe, runCommand, type Candidate, type Runtime } from '../platform/runtime/discovery'
import { parseFlatpak, parseRegistry, resolveApplication } from '../platform/runtime/platformDiscovery'

const noPlatform = async () => ({ candidates: [], diagnostics: [] })
const fakeProbe = async (candidate: Candidate): Promise<Runtime> => ({
    ...candidate,
    id: JSON.stringify(candidate.command),
    version: '2026.10.15',
    platform: 'linux',
    status: 'available',
})

test('explicit override precedes PATH, ignores relative PATH entries and deduplicates', () => {
    const candidates = getCandidates({
        platform: 'linux',
        home: '/home/test',
        configuredPath: '~/bin/openscad',
        env: { PATH: '/tools:.:/tools:' },
    })
    assert.equal(candidates[0].command.executable, '/home/test/bin/openscad')
    assert.equal(candidates[1].command.executable, '/tools/openscad')
    assert.equal(candidates.filter((candidate) => candidate.command.executable === '/tools/openscad').length, 1)
    assert.ok(candidates.every((candidate) => path.isAbsolute(candidate.command.executable)))
})

test('Windows prefers console launchers and honors Scoop environment roots', () => {
    const candidates = getCandidates({
        platform: 'win32',
        home: 'C:\\Users\\test',
        env: { Path: 'D:\\Tools', SCOOP: 'D:\\scoop' },
    })
    assert.equal(candidates[0].command.executable, 'D:\\Tools\\openscad.com')
    assert.equal(candidates[1].command.executable, 'D:\\Tools\\openscad.exe')
    assert.ok(candidates.some((candidate) => candidate.command.executable === 'D:\\scoop\\apps\\openscad\\current\\openscad.com'))
})

test('registry matches OpenSCAD installations and extracts console paths from quoted icons', () => {
    const output = 'HKEY_LOCAL_MACHINE\\test\n    DisplayName    REG_SZ    Other app\n    InstallLocation    REG_SZ    C:\\Other\nHKEY_LOCAL_MACHINE\\openscad\n    DisplayName    REG_SZ    OpenSCAD (Nightly)\n    DisplayIcon    REG_SZ    "D:\\CAD Tools\\openscad.exe",0\n'
    const candidates = parseRegistry(output)
    assert.equal(candidates.length, 2)
    assert.equal(candidates[0].command.executable, 'D:\\CAD Tools\\openscad.com')
})

test('Flatpak preserves branches and installation scopes as argument arrays', () => {
    const candidates = parseFlatpak('org.openscad.OpenSCAD\tstable\tsystem\norg.openscad.OpenSCAD\tbeta\tuser\norg.example.Other\tstable\tsystem', '/usr/bin/flatpak')
    assert.equal(candidates.length, 2)
    assert.deepEqual(candidates[0].command.argsPrefix, ['run', '--system', 'org.openscad.OpenSCAD//stable'])
    assert.deepEqual(candidates[1].command.argsPrefix, ['run', '--user', 'org.openscad.OpenSCAD//beta'])
})

test('version parser accepts release and snapshot output and rejects unrelated binaries', () => {
    assert.equal(parseVersion('\nOpenSCAD version 2021.01\n'), '2021.01')
    assert.equal(parseVersion('OpenSCAD version 2026.10.15 (git abc)\r\n'), '2026.10.15 (git abc)')
    assert.throws(() => parseVersion('node v24'))
})

test('discovery resolves aliases, retains separate Flatpak branches and explicit errors', async () => {
    const commands: Candidate[] = ['stable', 'beta'].map((branch) => ({
        source: 'flatpak',
        command: {
            executable: '/usr/bin/flatpak',
            argsPrefix: ['run', `org.openscad.OpenSCAD//${branch}`],
        },
    }))
    const result = await discover(
        {
            configuredPath: '/bad',
            platform: 'linux',
            env: { PATH: '/alias:/real' },
        },
        {
            collect: async () => ({ candidates: commands, diagnostics: [] }),
            canonicalize: async (file) => file.replace('/alias/', '/real/'),
            check: async (candidate) => {
                if (candidate.command.executable === '/bad') {
                    throw new Error('not executable')
                }
                return fakeProbe(candidate)
            },
        },
    )
    assert.match(result.configuredError!, /not executable/)
    assert.equal(result.runtimes.filter((runtime) => runtime.command.executable === '/real/openscad').length, 1)
    assert.equal(result.runtimes.filter((runtime) => runtime.source === 'flatpak').length, 2)
})

test('Scoop launches the physical version directory and Snap preserves dispatcher identity', async () => {
    const result = await discover(
        { platform: 'linux', env: {} },
        {
            collect: async () => ({
                candidates: [fileCandidate('/snap/bin/openscad', 'snap'), fileCandidate('/scoop/current/openscad.com', 'scoop')],
                diagnostics: [],
            }),
            canonicalize: async (file) => (file.startsWith('/snap/') ? '/usr/bin/snap' : file.replace('/current/', '/2021.01/')),
            check: fakeProbe,
        },
    )
    assert.equal(result.runtimes.find((runtime) => runtime.source === 'snap')?.command.executable, '/snap/bin/openscad')
    assert.equal(result.runtimes.find((runtime) => runtime.source === 'scoop')?.command.executable, '/scoop/2021.01/openscad.com')
})

test('bundled CLI is discovered and unavailable candidates do not stop the scan', async () => {
    const result = await discover(
        {
            platform: 'linux',
            env: {},
            bundledPath: '/extension/runtime/openscad',
        },
        {
            collect: noPlatform,
            canonicalize: async (file) => {
                if (!file.startsWith('/extension')) {
                    throw new Error('missing')
                }
                return file
            },
            check: fakeProbe,
        },
    )
    assert.equal(result.runtimes.length, 1)
    assert.equal(result.runtimes[0].source, 'bundled')
    assert.ok(result.diagnostics.some((line) => line.includes('missing')))
})

test('real process validation captures stderr and safely handles paths with shell characters', { skip: process.platform === 'win32' }, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'scad-runtime-'))
    const file = path.join(directory, 'OpenSCAD ; $(no-shell)')
    try {
        await writeFile(file, '#!/bin/sh\n[ "$1" = "--version" ] || exit 2\necho "OpenSCAD version 2021.01" >&2\n')
        await chmod(file, 0o755)
        const runtime = await probe(fileCandidate(file, 'custom'))
        assert.equal(runtime.version, '2021.01')
        await writeFile(file, '#!/bin/sh\necho "Another program"\n')
        await assert.rejects(probe(fileCandidate(file, 'custom')), /did not report/)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('process runner times out stuck commands and rejects nonzero exits', async () => {
    await assert.rejects(runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], 100))
    await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(3)']))
})

test('macOS app metadata resolves custom executable names and rejects path traversal', { skip: process.platform !== 'darwin' }, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'scad-app-'))
    const app = path.join(directory, 'OpenSCAD-test.app')
    const contents = path.join(app, 'Contents')
    try {
        await mkdir(contents, { recursive: true })
        const plist = (name: string) => `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>${name}</string></dict></plist>`
        await writeFile(path.join(contents, 'Info.plist'), plist('CustomOpenSCAD'))
        const candidate = await resolveApplication(fileCandidate(app, 'custom'))
        assert.equal(candidate.command.executable, path.join(contents, 'MacOS/CustomOpenSCAD'))
        assert.equal(candidate.guiPath, app)
        await writeFile(path.join(contents, 'Info.plist'), plist('../Unexpected'))
        await assert.rejects(resolveApplication(fileCandidate(app, 'custom')), /Invalid CFBundleExecutable/)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('selecting a discovered installation preserves its source label', async () => {
    const result = await discover(
        { configuredPath: '/usr/bin/openscad', platform: 'linux', env: {} },
        {
            collect: noPlatform,
            canonicalize: async (file) => file,
            check: fakeProbe,
        },
    )
    assert.equal(result.runtimes[0].command.executable, '/usr/bin/openscad')
    assert.equal(result.runtimes[0].source, 'native-package')
})
