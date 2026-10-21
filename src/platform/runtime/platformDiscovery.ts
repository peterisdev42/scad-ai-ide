import { readdir } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileCandidate, runCommand, type Candidate, type DiscoveryOptions } from './discovery'

export function parseRegistry(output: string): Candidate[] {
    const candidates: Candidate[] = []
    const p = path.win32
    for (const block of output.split(/\r?\n(?=HKEY_)/)) {
        const values = new Map<string, string>()
        for (const match of block.matchAll(/^\s+(\S+)\s+REG_\w+\s+(.+)$/gm)) {
            values.set(match[1], match[2].trim())
        }
        if (!/openscad/i.test(values.get('DisplayName') ?? '')) {
            continue
        }
        const directory = values.get('InstallLocation')?.replace(/^"|"$/g, '')
        const icon = values
            .get('DisplayIcon')
            ?.replace(/,\s*-?\d+$/, '')
            .replace(/^"|"$/g, '')
        for (const root of [directory, icon && p.dirname(icon)]) {
            if (root && p.isAbsolute(root) && !root.includes('%')) {
                for (const name of ['openscad.com', 'openscad.exe']) {
                    candidates.push({
                        ...fileCandidate(p.join(root, name), 'official'),
                        installPath: root,
                        guiPath: p.join(root, 'openscad.exe'),
                    })
                }
            }
        }
    }
    return candidates
}

export function parseFlatpak(output: string, executable: string): Candidate[] {
    const candidates: Candidate[] = []
    for (const line of output.split(/\r?\n/)) {
        const [application, branch, installation] = line.trim().split(/\t+/)
        if (application !== 'org.openscad.OpenSCAD' || !branch || !installation) {
            continue
        }
        // An explicit installation and branch preserve stable/beta coexistence.
        const scope = installation === 'user' ? '--user' : installation === 'system' ? '--system' : `--installation=${installation}`
        candidates.push({
            source: 'flatpak',
            command: {
                executable,
                argsPrefix: ['run', scope, `${application}//${branch}`],
            },
        })
    }
    return candidates
}

export async function collectPlatformCandidates(options: DiscoveryOptions): Promise<{ candidates: Candidate[]; diagnostics: string[] }> {
    const candidates: Candidate[] = []
    const diagnostics: string[] = []
    const platform = options.platform ?? process.platform
    const env = options.env ?? process.env
    const home = options.home ?? os.homedir()
    const attempt = async (label: string, task: () => Promise<void>) => {
        try {
            await task()
        } catch (error) {
            diagnostics.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
        }
    }
    if (platform === 'win32') {
        const reg = path.win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32/reg.exe')
        for (const hive of ['HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall']) {
            await attempt(`Registry ${hive}`, async () => {
                candidates.push(...parseRegistry(await runCommand(reg, ['query', hive, '/s'])))
            })
        }
    } else if (platform === 'darwin') {
        const apps = new Set<string>()
        for (const directory of ['/Applications', path.join(home, 'Applications'), '/Applications/MacPorts']) {
            await attempt(directory, async () => {
                for (const name of await readdir(directory)) {
                    if (/^openscad.*\.app$/i.test(name)) {
                        apps.add(path.join(directory, name))
                    }
                }
            })
        }
        await attempt('Spotlight', async () => {
            const output = await runCommand('/usr/bin/mdfind', ["kMDItemFSName == 'OpenSCAD*.app'c"], 3000)
            for (const app of output.trim().split(/\r?\n/).slice(0, 64)) {
                if (path.isAbsolute(app) && /^openscad.*\.app$/i.test(path.basename(app))) {
                    apps.add(app)
                }
            }
        })
        // Bound metadata reads even when a machine has many archived versions.
        for (const app of [...apps].sort().slice(0, 64)) {
            await attempt(app, async () => {
                const candidate = await resolveApplication(fileCandidate(app, app.includes('/MacPorts/') ? 'macports' : 'official'))
                candidates.push(candidate)
            })
        }
    } else if (platform === 'linux') {
        for (const app of ['openscad', 'openscad-nightly']) {
            candidates.push(fileCandidate(`/snap/bin/${app}`, 'snap'))
        }
        // Resolve launchers through the extension host's PATH, without a shell.
        const dirs = [...new Set([...(env.PATH ?? '').split(':'), '/usr/bin', '/usr/local/bin'])].filter((directory) => path.isAbsolute(directory))
        for (const directory of dirs) {
            let found = false
            await attempt(`Flatpak (${directory})`, async () => {
                const executable = path.join(directory, 'flatpak')
                const output = await runCommand(executable, ['list', '--app', '--columns=application,branch,installation'])
                candidates.push(...parseFlatpak(output, executable))
                found = true
            })
            if (found) {
                break
            }
        }
    }
    return { candidates, diagnostics }
}

export async function resolveApplication(candidate: Candidate): Promise<Candidate> {
    const app = candidate.command.executable
    if (!app.endsWith('.app')) {
        return candidate
    }
    const executable = (await runCommand('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')], 2000)).trim()
    if (!executable || path.basename(executable) !== executable || executable === '.' || executable === '..') {
        throw new Error('Invalid CFBundleExecutable')
    }
    return {
        ...candidate,
        command: {
            ...candidate.command,
            executable: path.join(app, 'Contents/MacOS', executable),
        },
        installPath: app,
        guiPath: app,
    }
}
