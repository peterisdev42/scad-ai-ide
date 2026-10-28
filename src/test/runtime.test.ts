import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import type * as vscode from 'vscode'
import { RuntimeManager } from '../core/runtime/RuntimeManager'
import { UserWarning } from '../core/feedback'
import type { DiscoveryResult, DiscoveryOptions } from '../core/runtime/types'
import { discover, fileCandidate, getCandidates, parseVersion, probe, runCommand, type Candidate, type Runtime } from '../platform/runtime/discovery'
import { parseFlatpak, parseRegistry, resolveApplication } from '../platform/runtime/platformDiscovery'
import { classifyRuntimeRelease, detectRuntimeSystem, fetchRuntimeBuilds, matchesRuntimeBuild, normalizeArchitecture, type RuntimeSystem } from '../platform/runtime/releases'
import { sortRuntimesByVersion } from '../core/runtime/sortRuntimes'

const noPlatform = async () => ({ candidates: [], diagnostics: [] })
const fakeProbe = async (candidate: Candidate): Promise<Runtime> => ({
    ...candidate,
    id: JSON.stringify(candidate.command),
    version: '2026.10.15',
    platform: 'linux',
    status: 'available',
})

test('all runtime lists sort by release name year, month, day and natural suffix without changing discovery priority', async () => {
    const releases = ['2025.12.31-TEST99', '2026.09.30-Z99', '2026.10.27-Z99', '2026.10.28-TEST2', '2026.10.28-TEST10', '2026.10.28', '2026.10.28-RC3', '2027.01.01', 'unknown']
    const runtimes = await Promise.all(releases.map(async (release, index) => ({ ...(await fakeProbe({ source: index % 2 ? 'managed' : 'PATH', command: { executable: `/runtime/${index}`, argsPrefix: [] } })), release, tag: 'unknown', version: 'unknown' })))
    // A differing tag and CLI version must not override a valid Release name.
    runtimes[0].tag = 'openscad-cli-2099.12.31'
    runtimes[0].version = '2099.12.31'
    const sorted = sortRuntimesByVersion(runtimes)
    assert.deepEqual(
        sorted.map((runtime) => runtime.release),
        [releases[7], releases[4], releases[3], releases[6], releases[5], releases[2], releases[1], releases[0], releases[8]],
    )
    assert.deepEqual(
        runtimes.map((runtime) => runtime.release),
        releases,
    )
    assert.equal(
        sorted.find((runtime) => runtime.id === runtimes[0].id),
        runtimes[0],
    )
    const legacy = [{ release: 'OpenSCAD CLI', tag: 'openscad-cli-2026.10-TEST10' }, { version: '2026.10.28' }, { version: '2026.10.TEST2' }]
    assert.deepEqual(sortRuntimesByVersion(legacy), [legacy[1], legacy[0], legacy[2]])
    const numericSuffixes = [{ release: '2026.10.28-2' }, { release: '2026.10.28-10' }]
    assert.deepEqual(sortRuntimesByVersion(numericSuffixes), [numericSuffixes[1], numericSuffixes[0]])
    const equivalent = [{ release: '2026.10.28-test2' }, { release: '2026.10.28-TEST2' }]
    assert.deepEqual(sortRuntimesByVersion(equivalent), equivalent)
})

test('equal versions ignore source, path, runtime ID and git metadata when sorting', async () => {
    const first = { ...(await fakeProbe({ source: 'managed', command: { executable: '/runtime/a', argsPrefix: [] } })), version: '2026.10 (git ffffff)' }
    const second = { ...(await fakeProbe({ source: 'PATH', command: { executable: '/runtime/b', argsPrefix: [] } })), version: '2026.10 (git aaaaaa)' }
    assert.deepEqual(sortRuntimesByVersion([second, first]), [second, first])
    assert.deepEqual(sortRuntimesByVersion([first, second]), [first, second])
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

test('runtime build matching requires the exact OS and architecture and excludes checksum files', () => {
    const system = (platform: string, architecture: string): RuntimeSystem => ({ platform, architecture, name: '', version: '' })
    for (const [platform, target] of [
        ['darwin', 'macos'],
        ['win32', 'windows'],
        ['linux', 'linux'],
    ]) {
        for (const [architecture, suffix] of [
            ['x64', 'x86_64'],
            ['arm64', 'arm64'],
            ['x86', 'x86'],
        ]) {
            const name = `openscad-cli-${target}-${suffix}.${platform === 'win32' ? 'zip' : 'tar.gz'}`
            assert.ok(matchesRuntimeBuild(name, system(platform, architecture)))
            assert.ok(!matchesRuntimeBuild(`${name}.sha256`, system(platform, architecture)))
            assert.ok(!matchesRuntimeBuild(name, system(platform, 'unsupported')))
            assert.ok(!matchesRuntimeBuild(name, system('freebsd', architecture)))
            assert.ok(!matchesRuntimeBuild(name, system(platform === 'darwin' ? 'win32' : 'darwin', architecture)))
        }
    }
    assert.equal(normalizeArchitecture('AMD64'), 'x64')
    assert.equal(normalizeArchitecture('aarch64'), 'arm64')
    assert.equal(normalizeArchitecture('ia32'), 'x86')
    assert.equal(normalizeArchitecture('armv7l'), 'armv7l')
})

test('release listing follows pagination and includes stable and prerelease matching archives only', async () => {
    const system: RuntimeSystem = { platform: 'darwin', architecture: 'arm64', name: 'macOS', version: '15' }
    const asset = (id: number, name: string) => ({ id, name, size: 1024, browser_download_url: `https://github.com/peterisdev42/openscad-cli-builder/releases/download/tag/${name}` })
    const release = (tag: string, assets: unknown[], extra = {}) => ({ tag_name: tag, assets, ...extra })
    const pages = [[release('openscad-cli-2026.10-TEST2', [asset(1, 'openscad-cli-macos-arm64.tar.gz'), asset(2, 'openscad-cli-macos-x86_64.tar.gz'), asset(3, 'openscad-cli-macos-arm64.tar.gz.sha256')], { prerelease: true, name: '2026.10.29-TEST2' })], [release('openscad-cli-2026.10-TEST10', [asset(4, 'openscad-cli-macos-arm64.tar.gz')], { name: '2026.10.28', prerelease: true }), release('draft', [asset(5, 'openscad-cli-macos-arm64.tar.gz')], { draft: true })]]
    const calls: string[] = []
    const builds = await fetchRuntimeBuilds(system, async (input, options) => {
        calls.push(String(input))
        assert.ok(options?.signal)
        return new Response(JSON.stringify(pages[calls.length - 1]), { headers: calls.length === 1 ? { link: '<https://api.github.com/next>; rel="next"' } : {} })
    })
    assert.equal(calls.length, 2)
    assert.match(calls[0], /per_page=100&page=1$/)
    assert.match(calls[1], /per_page=100&page=2$/)
    assert.deepEqual(
        builds.map((build) => [build.id, build.tag, build.prerelease]),
        [
            [1, 'openscad-cli-2026.10-TEST2', true],
            [4, 'openscad-cli-2026.10-TEST10', true],
        ],
    )
    assert.equal(builds[0].release, '2026.10.29-TEST2')
    assert.equal(builds[0].channel, undefined)
    assert.equal(builds[1].channel, 'Stable')
})

test('release listing handles empty results, API failures, invalid payloads and untrusted downloads', async () => {
    const system: RuntimeSystem = { platform: 'linux', architecture: 'x64', name: 'Linux', version: '6' }
    assert.deepEqual(await fetchRuntimeBuilds(system, async () => new Response('[]')), [])
    await assert.rejects(
        fetchRuntimeBuilds(system, async () => new Response('', { status: 403 })),
        /HTTP 403 Forbidden/,
    )
    await assert.rejects(
        fetchRuntimeBuilds(system, async () => new Response('', { status: 503 })),
        /HTTP 503/,
    )
    await assert.rejects(
        fetchRuntimeBuilds(system, async () => new Response('{}')),
        /Invalid/,
    )
    await assert.rejects(
        fetchRuntimeBuilds(system, async () => {
            throw new Error('offline')
        }),
        /offline/,
    )
    assert.deepEqual(
        await fetchRuntimeBuilds(
            system,
            async () =>
                new Response(
                    JSON.stringify([
                        {
                            tag_name: 'tag',
                            assets: [{ id: 1, name: 'openscad-cli-linux-x64.tar.gz', browser_download_url: 'https://example.com/archive' }],
                        },
                    ]),
                ),
        ),
        [],
    )
})

test('system detection returns the extension host platform, version and normalized architecture', async () => {
    const system = await detectRuntimeSystem()
    assert.equal(system.platform, process.platform)
    assert.ok(system.name)
    assert.ok(system.version)
    assert.ok(system.architecture)
    assert.equal(system.architecture, normalizeArchitecture(system.architecture))
})

test('managed macOS app and wrapper appear once, preserving PATH installations and separate builds', async () => {
    const root = '/storage/runtimes/darwin-arm64/100'
    const other = '/storage/runtimes/darwin-arm64/101'
    const wrapper = `${root}/bin/openscad`
    const app = `${root}/OpenSCAD.app/Contents/MacOS/OpenSCAD`
    const result = await discover(
        { platform: 'darwin', env: { PATH: '/usr/local/bin' }, managedPaths: [wrapper, `${other}/bin/openscad`] },
        {
            collect: async () => ({ candidates: [fileCandidate(app, 'official')], diagnostics: [] }),
            canonicalize: async (file) => file,
            check: async (candidate) => {
                if (!['/usr/local/bin/openscad', app, wrapper, `${other}/bin/openscad`].includes(candidate.command.executable)) {
                    throw new Error('missing')
                }
                return fakeProbe(candidate)
            },
        },
    )
    assert.deepEqual(
        result.runtimes.map((runtime) => [runtime.command.executable, runtime.source]),
        [
            ['/usr/local/bin/openscad', 'PATH'],
            [wrapper, 'managed'],
            [`${other}/bin/openscad`, 'managed'],
        ],
    )
    assert.equal(result.runtimes[1].installPath, root)
    assert.equal(result.runtimes[1].id, JSON.stringify({ executable: wrapper, argsPrefix: [] }))
})

test('explicitly selected app keeps priority when merged into its managed launcher, including canonical storage aliases', async () => {
    const root = '/storage/runtimes/darwin-arm64/100'
    const app = `${root}/OpenSCAD.app/Contents/MacOS/OpenSCAD`
    const wrapper = `${root}/bin/openscad`
    const result = await discover(
        { platform: 'darwin', configuredPath: app, env: { PATH: '/tools' }, managedPaths: [wrapper] },
        {
            collect: noPlatform,
            canonicalize: async (file) => file.replace(/^\/storage/, '/private/storage'),
            check: async (candidate) => {
                if (!candidate.command.executable.startsWith('/private/storage/') && candidate.command.executable !== '/tools/openscad') {
                    throw new Error('missing')
                }
                return fakeProbe(candidate)
            },
        },
    )
    assert.equal(result.configuredError, undefined)
    assert.equal(result.runtimes.length, 2)
    assert.equal(result.runtimes[0].command.executable, `/private${wrapper}`)
    assert.equal(result.runtimes[0].source, 'managed')
    assert.equal(result.runtimes[0].installPath, root)
})

test('managed launchers on PATH retain managed metadata and distinct argument prefixes', async () => {
    const root = '/storage/runtimes/linux-x64/100'
    const wrapper = `${root}/bin/openscad`
    const result = await discover(
        { platform: 'linux', configuredCommand: { executable: wrapper, argsPrefix: ['--special'] }, env: { PATH: `${root}/bin` }, managedPaths: [wrapper] },
        {
            collect: noPlatform,
            canonicalize: async (file) => file,
            check: async (candidate) => {
                if (candidate.command.executable !== wrapper) {
                    throw new Error('missing')
                }
                return fakeProbe(candidate)
            },
        },
    )
    assert.equal(result.runtimes.length, 2)
    assert.deepEqual(result.runtimes[0].command.argsPrefix, ['--special'])
    assert.equal(result.runtimes[1].source, 'managed')
    assert.equal(result.runtimes[1].installPath, root)
})

test('an unusable managed wrapper does not hide a working app entry', async () => {
    const root = '/storage/runtimes/darwin-arm64/100'
    const app = `${root}/OpenSCAD.app/Contents/MacOS/OpenSCAD`
    const result = await discover(
        { platform: 'darwin', env: {}, managedPaths: [`${root}/bin/openscad`] },
        {
            collect: async () => ({ candidates: [fileCandidate(app, 'official')], diagnostics: [] }),
            canonicalize: async (file) => file,
            check: async (candidate) => {
                if (candidate.command.executable !== app) {
                    throw new Error('missing')
                }
                return fakeProbe(candidate)
            },
        },
    )
    assert.equal(result.runtimes.length, 1)
    assert.equal(result.runtimes[0].command.executable, app)
    assert.equal(result.runtimes[0].source, 'official')
})

test('Windows PATH and repeated registry entries merge .com/.exe launchers case-insensitively', async () => {
    const p = path.win32
    const directory = 'C:\\Program Files\\OpenSCAD'
    const registry = ['HKEY_LOCAL_MACHINE\\OpenSCAD', 'HKEY_CURRENT_USER\\OpenSCAD'].map((key) => `${key}\n    DisplayName    REG_SZ    OpenSCAD\n    InstallLocation    REG_SZ    ${directory}\n    DisplayIcon    REG_SZ    "${directory}\\openscad.exe",0\n`).join('')
    const result = await discover(
        { platform: 'win32', env: { Path: directory.toLowerCase() }, home: 'C:\\Users\\test' },
        {
            collect: async () => ({ candidates: parseRegistry(registry), diagnostics: [] }),
            canonicalize: async (file) => file,
            check: async (candidate) => {
                if (p.dirname(candidate.command.executable).toLowerCase() !== directory.toLowerCase()) {
                    throw new Error('missing')
                }
                return { ...(await fakeProbe(candidate)), platform: 'win32' }
            },
        },
    )
    assert.equal(result.runtimes.length, 1)
    assert.match(result.runtimes[0].command.executable, /openscad\.com$/i)
    assert.equal(result.runtimes[0].source, 'PATH')
})

test('Windows falls back to .exe when the .com launcher fails without duplicating registry results', async () => {
    const directory = 'C:\\Program Files\\OpenSCAD'
    const result = await discover(
        { platform: 'win32', env: { Path: directory }, home: 'C:\\Users\\test' },
        {
            collect: async () => ({ candidates: [fileCandidate(`${directory}\\openscad.exe`, 'official')], diagnostics: [] }),
            canonicalize: async (file) => file,
            check: async (candidate) => {
                if (candidate.command.executable !== `${directory}\\openscad.exe`) {
                    throw new Error('missing or broken launcher')
                }
                return { ...(await fakeProbe(candidate)), platform: 'win32' }
            },
        },
    )
    assert.equal(result.runtimes.length, 1)
    assert.equal(result.runtimes[0].command.executable, `${directory}\\openscad.exe`)
})

test('Windows managed packages merge PATH, registry, root and bin launchers while preserving selected priority and other builds', async () => {
    const p = path.win32
    const root = 'C:\\Users\\test\\globalStorage\\runtimes\\win32-x64\\100'
    const other = 'C:\\Users\\test\\globalStorage\\runtimes\\win32-x64\\101'
    const executable = p.join(root, 'bin/openscad.exe')
    const otherExecutable = p.join(other, 'bin/openscad.exe')
    const standalone = 'C:\\Tools\\openscad.exe'
    const registry = `HKEY_LOCAL_MACHINE\\OpenSCAD\n    DisplayName    REG_SZ    OpenSCAD\n    InstallLocation    REG_SZ    ${root.toUpperCase()}\n    DisplayIcon    REG_SZ    "${executable.toUpperCase()}",0\n`
    const result = await discover(
        { platform: 'win32', configuredPath: p.join(root, 'openscad.exe'), env: { Path: `${p.join(root, 'bin')};C:\\Tools` }, managedPaths: [executable, otherExecutable] },
        {
            collect: async () => ({ candidates: parseRegistry(registry), diagnostics: [] }),
            canonicalize: async (file) => file,
            check: async (candidate) => {
                const file = candidate.command.executable.toLowerCase()
                const available = [p.join(root, 'openscad.exe'), p.join(root, 'bin/openscad.com'), executable, otherExecutable, standalone].map((file) => file.toLowerCase())
                if (!available.includes(file)) {
                    throw new Error('missing')
                }
                return { ...(await fakeProbe(candidate)), platform: 'win32' }
            },
        },
    )
    assert.equal(result.configuredError, undefined)
    assert.deepEqual(
        result.runtimes.map((runtime) => [runtime.command.executable, runtime.source]),
        [
            [executable, 'managed'],
            [standalone, 'PATH'],
            [otherExecutable, 'managed'],
        ],
    )
    assert.equal(result.runtimes[0].installPath, root)
    assert.equal(result.runtimes[2].installPath, other)
})

test('Windows Scoop junction aliases merge with physical paths without merging separate launch arguments', async () => {
    const current = 'D:\\scoop\\apps\\openscad\\current'
    const physical = 'D:\\scoop\\apps\\openscad\\2026.10'
    const executable = `${physical}\\openscad.com`
    const result = await discover(
        { platform: 'win32', configuredCommand: { executable, argsPrefix: ['--special'] }, env: { Path: `${physical};${current}`, SCOOP: 'D:\\scoop' } },
        {
            collect: noPlatform,
            canonicalize: async (file) => file.replace(current, physical),
            check: async (candidate) => {
                if (path.win32.dirname(candidate.command.executable) !== physical) {
                    throw new Error('missing')
                }
                return { ...(await fakeProbe(candidate)), platform: 'win32' }
            },
        },
    )
    assert.equal(result.runtimes.length, 2)
    assert.deepEqual(
        result.runtimes.map((runtime) => runtime.command.argsPrefix),
        [['--special'], []],
    )
    assert.ok(result.runtimes.every((runtime) => runtime.command.executable === executable))
})

test('only suffix-free release versions receive a Stable badge', () => {
    for (const version of ['2026.10.28', '2026.10', 'openscad-cli-2026.10.28', 'OpenSCAD CLI 2026.10.28']) {
        assert.equal(classifyRuntimeRelease(version), 'Stable', version)
    }
    for (const suffix of ['TEST4', 'nightly', 'dev', 'snapshot', 'alpha1', 'beta2', 'rc3', 'preview', 'custom', '1']) {
        assert.equal(classifyRuntimeRelease(`2026.10.28-${suffix}`), undefined, suffix)
    }
    for (const version of ['', 'unknown', 'OpenSCAD Nightly', '2026.10.28-', '2026.10.28+build1']) {
        assert.equal(classifyRuntimeRelease(version), undefined, version)
    }
})

test('GitHub rate-limit failures preserve the upstream message, status, reset time and request metadata', async () => {
    const system: RuntimeSystem = { platform: 'darwin', architecture: 'arm64', name: '', version: '' }
    const message = 'API rate limit exceeded for 192.0.2.1. Please wait before retrying.'
    const documentation = 'https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api'
    await assert.rejects(
        fetchRuntimeBuilds(
            system,
            async () =>
                new Response(JSON.stringify({ message, documentation_url: documentation }), {
                    status: 403,
                    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '60', 'x-ratelimit-reset': '1800000000', 'retry-after': '120', 'x-github-request-id': 'TEST:1234' },
                }),
        ),
        (error: Error) => {
            assert.match(error.message, /GitHub API error: HTTP 403 Forbidden/)
            assert.ok(error.message.includes(message))
            assert.ok(error.message.includes(documentation))
            assert.match(error.message, /requests remaining: 0 \/ 60/)
            assert.ok(error.message.includes(new Date(1800000000 * 1000).toISOString()))
            assert.match(error.message, /Retry after: 120 seconds/)
            assert.match(error.message, /GitHub request ID: TEST:1234/)
            assert.match(error.message, /Request: https:\/\/api.github.com\/repos\/peterisdev42\/openscad-cli-builder\/releases\?per_page=100&page=1/)
            return true
        },
    )
})

test('GitHub permission errors are distinct from rate limits and plain upstream failures keep their response', async () => {
    const system: RuntimeSystem = { platform: 'linux', architecture: 'x64', name: '', version: '' }
    await assert.rejects(
        fetchRuntimeBuilds(system, async () => new Response(JSON.stringify({ message: 'Resource not accessible by integration', errors: [{ resource: 'Release', code: 'forbidden' }] }), { status: 403 })),
        (error: Error) => {
            assert.match(error.message, /Resource not accessible by integration/)
            assert.match(error.message, /"resource":"Release","code":"forbidden"/)
            assert.doesNotMatch(error.message, /rate limit/i)
            return true
        },
    )
    await assert.rejects(
        fetchRuntimeBuilds(system, async () => new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit.' }), { status: 429, headers: { 'retry-after': '60' } })),
        (error: Error) => {
            assert.match(error.message, /HTTP 429 Too Many Requests/)
            assert.match(error.message, /You have exceeded a secondary rate limit\./)
            assert.match(error.message, /Retry after: 60 seconds/)
            return true
        },
    )
    await assert.rejects(
        fetchRuntimeBuilds(system, async () => new Response('upstream connect error: connection reset by peer', { status: 502 })),
        /HTTP 502 Bad Gateway[\s\S]*upstream connect error: connection reset by peer/,
    )
    await assert.rejects(
        fetchRuntimeBuilds(system, async () => new Response('<html>GitHub service temporarily unavailable</html>', { status: 503 })),
        /HTTP 503 Service Unavailable[\s\S]*<html>GitHub service temporarily unavailable<\/html>/,
    )
})

test('GitHub network failures expose DNS, TLS, timeout and aggregate connection causes', async () => {
    const system: RuntimeSystem = { platform: 'linux', architecture: 'x64', name: '', version: '' }
    const failures = [new Error('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.github.com'), { code: 'ENOTFOUND' }) }), new Error('fetch failed', { cause: Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' }) }), new DOMException('The operation was aborted due to timeout', 'TimeoutError'), new Error('fetch failed', { cause: new AggregateError([Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }), Object.assign(new Error('connection timed out'), { code: 'ETIMEDOUT' })], 'All connection attempts failed') })]
    const patterns = [/ENOTFOUND api.github.com/, /certificate has expired \(CERT_HAS_EXPIRED\)/, /TimeoutError: The operation was aborted due to timeout/, /ECONNREFUSED[\s\S]*ETIMEDOUT/]
    for (const [index, failure] of failures.entries()) {
        await assert.rejects(
            fetchRuntimeBuilds(system, async () => {
                throw failure
            }),
            (error: Error) => {
                assert.match(error.message, /GitHub API request failed/)
                assert.match(error.message, patterns[index])
                return true
            },
        )
    }
})

test('invalid GitHub response content retains the request and parsing error or unexpected payload', async () => {
    const system: RuntimeSystem = { platform: 'linux', architecture: 'x64', name: '', version: '' }
    await assert.rejects(
        fetchRuntimeBuilds(system, async () => new Response('not JSON')),
        /Invalid JSON response from GitHub API \(HTTP 200\)[\s\S]*Request:[\s\S]*SyntaxError/,
    )
    await assert.rejects(
        fetchRuntimeBuilds(system, async () => new Response(JSON.stringify({ message: 'Unexpected upstream response' }))),
        /expected a release list[\s\S]*Unexpected upstream response/,
    )
})

async function mockRuntimeFeature(detect: (options: DiscoveryOptions) => Promise<DiscoveryResult>, remove: (installPath: string) => Promise<void> = async () => {}) {
    const configuration = new Map<string, unknown>()
    let updateError: Error | undefined
    let archiveError: Error | undefined
    let cancelInstallation = false
    const file = path.join(__dirname, '../features/runtime/registerRuntime.js')
    const subscriptions: vscode.Disposable[] = []
    const disposable = { dispose() {} }
    const status = { text: '', tooltip: '', show() {}, dispose() {} }
    class Emitter {
        listeners = new Set<() => void>()
        event = (listener: () => void) => {
            this.listeners.add(listener)
            return { dispose: () => this.listeners.delete(listener) }
        }
        fire() {
            this.listeners.forEach((listener) => listener())
        }
        dispose() {
            this.listeners.clear()
        }
    }
    const mock = {
        EventEmitter: Emitter,
        StatusBarAlignment: { Left: 1 },
        ConfigurationTarget: { Global: 1 },
        ProgressLocation: { Notification: 1 },
        Uri: { joinPath: (...parts: Array<string | { fsPath: string }>) => ({ fsPath: parts.map((part) => (typeof part === 'string' ? part : part.fsPath)).join('/') }) },
        commands: { registerCommand: () => disposable },
        window: {
            createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
            createStatusBarItem: () => status,
            showOpenDialog: async () => [{ fsPath: '/mock/archive.zip' }],
            withProgress: async (_options: unknown, task: (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => Promise<unknown>) => task({ report() {} }, { isCancellationRequested: cancelInstallation, onCancellationRequested: () => disposable }),
        },
        workspace: {
            isTrusted: true,
            getConfiguration: () => ({
                get: (key: string, fallback: unknown) => (configuration.has(key) ? configuration.get(key) : fallback),
                update: async (key: string, value: unknown) => {
                    if (updateError) throw updateError
                    configuration.set(key, value)
                },
            }),
            onDidGrantWorkspaceTrust: () => disposable,
            onDidChangeConfiguration: () => disposable,
        },
    }
    const sandbox = {
        process,
        AbortController,
        exports: {} as { registerRuntime: typeof import('../features/runtime/registerRuntime').registerRuntime },
        require: (id: string) => {
            if (id === 'vscode') return mock
            if (id.endsWith('/installation'))
                return {
                    removeRuntimeInstallation: async (_root: string, _system: unknown, installPath: string) => remove(installPath),
                    managedRuntimePaths: async () => [],
                    installedRuntimeBuilds: async () => [],
                    installRuntimeArchive: async (_root: unknown, _system: unknown, _source: unknown, options: { signal: AbortSignal; progress: (value: { message: string; percent?: number }) => void }) => {
                        if (options.signal.aborted) throw new Error('Cancelled')
                        if (archiveError) throw archiveError
                        options.progress({ message: 'Validating runtime', percent: 100 })
                        return '/mock/openscad'
                    },
                }
            if (id.endsWith('/releases')) return { detectRuntimeSystem: async () => ({ platform: 'linux', architecture: 'x64', name: 'Linux', version: 'test' }) }
            return id.startsWith('.') ? require(path.resolve(path.dirname(file), id)) : require(id)
        },
    }
    vm.runInNewContext(await readFile(file, 'utf8'), sandbox, { filename: file })
    const manager = new RuntimeManager(detect)
    const runtime = sandbox.exports.registerRuntime({ globalStorageUri: { fsPath: '/mock-storage' }, subscriptions } as unknown as vscode.ExtensionContext, manager, async () => {
        throw new Error('Local scanning must not access GitHub')
    })
    return {
        runtime,
        manager,
        status,
        configuration,
        setTrusted: (value: boolean) => {
            mock.workspace.isTrusted = value
        },
        setArchiveError: (error: Error) => {
            archiveError = error
        },
        cancelInstallation: () => {
            cancelInstallation = true
        },
        setUpdateError: (error: Error) => {
            updateError = error
        },
        dispose: () => subscriptions.forEach((subscription) => subscription.dispose()),
    }
}

test('Installed scans silently, coalesces repeated visits and publishes only changed discovery results', async () => {
    const installed = await fakeProbe({ source: 'PATH', command: { executable: '/runtime/openscad', argsPrefix: [] } })
    const result: DiscoveryResult = { runtimes: [installed], diagnostics: [] }
    let scan: () => Promise<DiscoveryResult> = async () => result
    let scans = 0
    const mock = await mockRuntimeFeature(async () => {
        scans++
        return scan()
    })
    try {
        assert.equal(mock.runtime.getState().busy, true)
        assert.equal(mock.runtime.getState().refreshingSilently, false)
        await mock.runtime.whenReady()
        let updates = 0
        mock.runtime.onDidChange(() => updates++)
        let complete!: (value: DiscoveryResult) => void
        scan = () =>
            new Promise((resolve) => {
                complete = resolve
            })
        const refreshing = mock.runtime.refreshInstalled()
        assert.equal(mock.runtime.getState().busy, true)
        assert.equal(mock.runtime.getState().refreshingSilently, true)
        assert.equal(mock.runtime.getState().runtimes[0].id, installed.id)
        assert.equal(mock.status.text, `OpenSCAD ${installed.version}`)
        assert.equal(updates, 0)
        assert.equal(mock.runtime.refreshInstalled(), refreshing)
        await new Promise<void>((resolve) => setImmediate(resolve))
        complete(result)
        await refreshing
        assert.equal(scans, 2)
        assert.equal(updates, 0)
        assert.equal(mock.runtime.getState().busy, false)
        assert.equal(mock.runtime.getState().refreshingSilently, false)
        scan = async () => ({ runtimes: [{ ...installed, version: '2027.01' }], diagnostics: [] })
        await mock.runtime.refreshInstalled()
        assert.equal(updates, 1)
        assert.equal(mock.runtime.getState().runtimes[0].version, '2027.01')
        const manual = mock.runtime.refresh()
        assert.equal(mock.runtime.getState().refreshingSilently, false)
        assert.equal(mock.status.text, 'OpenSCAD: Discovering')
        assert.equal(updates, 2)
        await manual
        assert.equal(updates, 3)
    } finally {
        mock.dispose()
    }
})

test('silent scan failures publish the actual reason and clear stale runtime results', async () => {
    const installed = await fakeProbe({ source: 'PATH', command: { executable: '/runtime/openscad', argsPrefix: [] } })
    let failed = false
    const mock = await mockRuntimeFeature(async () => {
        if (failed) throw new Error('Storage is unavailable')
        return { runtimes: [installed], diagnostics: [] }
    })
    try {
        await mock.runtime.whenReady()
        let updates = 0
        mock.runtime.onDidChange(() => updates++)
        failed = true
        await mock.runtime.refreshInstalled()
        assert.equal(updates, 1)
        assert.equal(mock.runtime.getState().busy, false)
        assert.equal(mock.runtime.getState().refreshingSilently, false)
        assert.match(mock.runtime.getState().message, /Storage is unavailable/)
        assert.equal(mock.runtime.getState().runtimes.length, 0)
    } finally {
        mock.dispose()
    }
})

test('switching runtime exposes only the selected ID while validating silently and clears it after success', async () => {
    const old = await fakeProbe({ source: 'PATH', command: { executable: '/old/openscad', argsPrefix: [] } })
    const next = { ...(await fakeProbe({ source: 'managed', command: { executable: '/new/openscad', argsPrefix: [] } })), version: '2027.01' }
    let finish!: () => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => {
        started = resolve
    })
    const gate = new Promise<void>((resolve) => {
        finish = resolve
    })
    const mock = await mockRuntimeFeature(async (options) => {
        if (options.configuredCommand?.executable === next.command.executable) {
            started()
            await gate
            return { runtimes: [next, old], diagnostics: [] }
        }
        return { runtimes: [old, next], diagnostics: [] }
    })
    try {
        await mock.runtime.whenReady()
        const states: ReturnType<typeof mock.runtime.getState>[] = []
        mock.runtime.onDidChange(() => states.push(mock.runtime.getState()))
        const switching = mock.runtime.select(next.id)
        assert.equal(mock.runtime.getState().selectingId, next.id)
        await entered
        assert.equal(mock.runtime.getState().refreshingSilently, true)
        assert.equal(mock.runtime.getState().activeId, old.id)
        assert.equal(mock.status.text, `OpenSCAD ${old.version}`)
        assert.ok(states.every((state) => !state.busy || state.refreshingSilently))
        await mock.runtime.select(old.id)
        assert.equal(mock.runtime.getState().selectingId, next.id)
        finish()
        await switching
        assert.equal(mock.runtime.getState().selectingId, undefined)
        assert.equal(mock.runtime.getState().activeId, next.id)
        assert.equal(mock.runtime.getState().busy, false)
        assert.equal(mock.runtime.getState().runtimes[0].id, next.id)
    } finally {
        finish()
        mock.dispose()
    }
})

test('failed runtime selection clears its button state, preserves the active runtime and returns the actual error', async () => {
    const old = await fakeProbe({ source: 'PATH', command: { executable: '/old/openscad', argsPrefix: [] } })
    const next = await fakeProbe({ source: 'managed', command: { executable: '/new/openscad', argsPrefix: [] } })
    const mock = await mockRuntimeFeature(async () => ({ runtimes: [old, next], diagnostics: [] }))
    try {
        await mock.runtime.whenReady()
        mock.setUpdateError(new Error('Cannot write user settings'))
        await assert.rejects(mock.runtime.select(next.id), /Cannot write user settings/)
        assert.equal(mock.runtime.getState().selectingId, undefined)
        assert.equal(mock.runtime.getState().activeId, old.id)
        assert.equal(mock.runtime.getState().busy, false)
    } finally {
        mock.dispose()
    }
})

test('installation publishes completion even when discovery is unchanged and cancellation is not an error', async () => {
    const mock = await mockRuntimeFeature(async () => ({ runtimes: [], diagnostics: [] }))
    try {
        await mock.runtime.whenReady()
        const states: ReturnType<typeof mock.runtime.getState>[] = []
        mock.runtime.onDidChange(() => states.push(mock.runtime.getState()))
        await mock.runtime.installArchive()
        assert.ok(states.some((state) => state.installing?.message === 'Validating runtime'))
        assert.equal(states.at(-1)?.installing, undefined)
        assert.equal(states.at(-1)?.installationIsArchive, true)
        assert.match(states.at(-1)?.installationMessage ?? '', /installed/)
        assert.equal(states.at(-1)?.installationError, '')
        mock.setArchiveError(new Error('Archive validation failed'))
        await assert.rejects(mock.runtime.installArchive(), /Archive validation failed/)
        assert.equal(states.at(-1)?.installing, undefined)
        assert.match(states.at(-1)?.installationError ?? '', /Archive validation failed/)
        mock.cancelInstallation()
        await mock.runtime.installArchive()
        assert.equal(states.at(-1)?.installationError, '')
        assert.equal(states.at(-1)?.installationMessage, 'Installation cancelled.')
        assert.equal(states.at(-1)?.installing, undefined)
    } finally {
        mock.dispose()
    }
})

test('workspace trust prerequisites are panel warnings and do not start runtime operations', async () => {
    let scans = 0
    const mock = await mockRuntimeFeature(async () => {
        scans++
        return { runtimes: [], diagnostics: [] }
    })
    try {
        await mock.runtime.whenReady()
        mock.setTrusted(false)
        await mock.runtime.refreshInstalled()
        assert.equal(scans, 1)
        assert.equal(mock.runtime.getState().messageSeverity, 'warning')
        for (const operation of [() => mock.runtime.browse(), () => mock.runtime.select('missing'), () => mock.runtime.installArchive()]) {
            await assert.rejects(operation(), (error) => error instanceof UserWarning && /Trust this workspace/.test(error.message))
        }
        assert.equal(scans, 1)
        assert.equal(mock.runtime.getState().installing, undefined)
    } finally {
        mock.dispose()
    }
})

test('deleting an active managed runtime clears its saved selection and keeps the fallback; failed deletion preserves it', async () => {
    const active = { ...(await fakeProbe({ source: 'managed', command: { executable: '/managed/100/bin/openscad', argsPrefix: [] } })), installPath: '/managed/100' }
    const fallback = await fakeProbe({ source: 'PATH', command: { executable: '/system/openscad', argsPrefix: [] } })
    let removed = false
    let fail = true
    const mock = await mockRuntimeFeature(
        async () => ({ runtimes: removed ? [fallback] : [active, fallback], diagnostics: [] }),
        async (installPath) => {
            assert.equal(installPath, active.installPath)
            if (fail) throw new Error('Permission denied')
            removed = true
        },
    )
    try {
        await mock.runtime.whenReady()
        mock.configuration.set('runtimeCommand', active.command)
        await assert.rejects(mock.runtime.deleteRuntime(active.id), /Permission denied/)
        assert.equal(mock.runtime.getState().activeId, active.id)
        assert.equal(mock.configuration.get('runtimeCommand'), active.command)
        assert.equal(mock.runtime.getState().deletingId, undefined)
        fail = false
        await mock.runtime.deleteRuntime(active.id)
        assert.equal(mock.configuration.get('runtimeCommand'), null)
        assert.equal(mock.runtime.getState().activeId, fallback.id)
        assert.deepEqual(
            mock.runtime.getState().runtimes.map((runtime) => runtime.id),
            [fallback.id],
        )
        assert.equal(mock.runtime.getState().deletingId, undefined)
        await assert.rejects(mock.runtime.deleteRuntime(fallback.id), /Only extension-managed/)
    } finally {
        mock.dispose()
    }
})
