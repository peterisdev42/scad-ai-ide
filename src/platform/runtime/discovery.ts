import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import * as os from 'node:os'
import * as path from 'node:path'
import { collectPlatformCandidates, resolveApplication } from './platformDiscovery'

import type { RuntimeSource, LaunchCommand, Candidate, Runtime, DiscoveryResult, DiscoveryOptions } from '../../core/runtime/types'
export type { RuntimeSource, LaunchCommand, Candidate, Runtime, DiscoveryResult, DiscoveryOptions } from '../../core/runtime/types'

export function fileCandidate(executable: string, source: RuntimeSource): Candidate {
    return { command: { executable, argsPrefix: [] }, source }
}

export function getCandidates(options: DiscoveryOptions = {}): Candidate[] {
    const platform = options.platform ?? process.platform
    const env = options.env ?? process.env
    const home = options.home ?? os.homedir()
    const p = platform === 'win32' ? path.win32 : path.posix
    const candidates: Candidate[] = []
    const addDirectory = (directory: string, source: RuntimeSource) => {
        // The console launcher is preferred on Windows; .exe remains a fallback.
        for (const executable of platform === 'win32' ? ['openscad.com', 'openscad.exe'] : ['openscad']) {
            candidates.push(fileCandidate(p.join(directory, executable), source))
        }
    }
    if (options.configuredPath?.trim()) {
        let file = options.configuredPath.trim()
        if (file.startsWith('~/') || file.startsWith('~\\')) {
            file = p.join(home, file.slice(2))
        }
        candidates.push(fileCandidate(file, 'custom'))
    } else if (options.configuredCommand) {
        candidates.push({
            command: options.configuredCommand,
            source: 'custom',
        })
    }
    const searchPath = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1]
    for (const directory of (searchPath ?? '').split(platform === 'win32' ? ';' : ':')) {
        if (p.isAbsolute(directory)) {
            addDirectory(directory, 'PATH')
        }
    }
    if (platform === 'darwin') {
        for (const directory of ['/Applications', p.join(home, 'Applications'), '/Applications/MacPorts']) {
            for (const app of ['OpenSCAD.app', 'OpenSCAD-Nightly.app']) {
                candidates.push({
                    ...fileCandidate(p.join(directory, app, 'Contents/MacOS/OpenSCAD'), directory.includes('MacPorts') ? 'macports' : 'official'),
                    guiPath: p.join(directory, app),
                })
            }
        }
        for (const directory of ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', ...(env.HOMEBREW_PREFIX ? [p.join(env.HOMEBREW_PREFIX, 'bin')] : [])]) {
            addDirectory(directory, directory.includes('/opt/local') ? 'macports' : 'homebrew')
        }
    } else if (platform === 'win32') {
        for (const directory of [env.ProgramW6432, env.ProgramFiles ?? 'C:\\Program Files', env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', env.LOCALAPPDATA && p.join(env.LOCALAPPDATA, 'Programs')]) {
            if (directory) {
                for (const app of ['OpenSCAD', 'OpenSCAD (Nightly)']) {
                    addDirectory(p.join(directory, app), 'official')
                }
            }
        }
        for (const root of [env.SCOOP ?? p.join(home, 'scoop'), env.SCOOP_GLOBAL ?? p.join(env.ProgramData ?? 'C:\\ProgramData', 'scoop')]) {
            addDirectory(p.join(root, 'apps/openscad/current'), 'scoop')
        }
    } else {
        for (const directory of ['/usr/bin', '/usr/local/bin', p.join(home, '.local/bin')]) {
            addDirectory(directory, 'native-package')
        }
    }
    if (options.bundledPath) {
        candidates.push(fileCandidate(options.bundledPath, 'bundled'))
    }
    const seen = new Map<string, RuntimeSource>()
    return candidates.filter((candidate) => {
        const key = commandKey(candidate.command, platform)
        const previousSource = seen.get(key)
        if (previousSource && !(previousSource === 'custom' && candidate.source !== 'custom')) {
            return false
        }
        seen.set(key, candidate.source)
        return true
    })
}

export function commandKey(command: LaunchCommand, platform = process.platform): string {
    const p = platform === 'win32' ? path.win32 : path.posix
    const file = p.normalize(command.executable)
    return JSON.stringify([platform === 'win32' ? file.toLowerCase() : file, command.argsPrefix])
}

export function runCommand(executable: string, args: string[], timeout = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(executable, args, { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
                reject(error)
            } else {
                resolve(`${stdout}\n${stderr}`)
            }
        })
    })
}

export function parseVersion(output: string): string {
    const version = /OpenSCAD\s+version\s+([^\r\n]+)/i.exec(output)?.[1]?.trim()
    if (!version) {
        throw new Error('Executable did not report an OpenSCAD version')
    }
    return version
}

export async function probe(candidate: Candidate): Promise<Runtime> {
    const { executable, argsPrefix } = candidate.command
    if (!path.isAbsolute(executable)) {
        throw new Error('Use an absolute executable path')
    }
    await access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    const version = parseVersion(await runCommand(executable, [...argsPrefix, '--version']))
    return {
        ...candidate,
        id: createHash('sha256').update(commandKey(candidate.command)).digest('hex'),
        version,
        platform: process.platform,
        status: 'available',
    }
}

export interface DiscoveryDependencies {
    check?: (candidate: Candidate) => Promise<Runtime>
    canonicalize?: (file: string) => Promise<string>
    collect?: typeof collectPlatformCandidates
}

export async function discover(options: DiscoveryOptions = {}, dependencies: DiscoveryDependencies = {}): Promise<DiscoveryResult> {
    const result: DiscoveryResult = { runtimes: [], diagnostics: [] }
    const { check = probe, canonicalize = realpath, collect = collectPlatformCandidates } = dependencies
    const candidates = getCandidates(options)
    const extra = await collect(options)
    // Explicit configuration and PATH precede OS and package-manager sources.
    const firstSystem = candidates.findIndex((candidate) => !['custom', 'PATH'].includes(candidate.source))
    candidates.splice(firstSystem < 0 ? candidates.length : firstSystem, 0, ...extra.candidates.filter((candidate) => !['snap', 'flatpak'].includes(candidate.source)))
    const bundledIndex = candidates.findIndex((candidate) => candidate.source === 'bundled')
    candidates.splice(bundledIndex < 0 ? candidates.length : bundledIndex, 0, ...extra.candidates.filter((candidate) => ['snap', 'flatpak'].includes(candidate.source)))
    result.diagnostics.push(...extra.diagnostics)
    const platform = options.platform ?? process.platform
    const seen = new Map<string, Runtime>()
    for (let candidate of candidates) {
        try {
            if (platform === 'darwin') {
                candidate = await resolveApplication(candidate)
            }
            const canonical = await canonicalize(candidate.command.executable)
            // Snap dispatches using argv[0]. Preserve its wrapper path and identity.
            const snapWrapper = candidate.command.executable.startsWith('/snap/bin/')
            const command = {
                ...candidate.command,
                executable: snapWrapper ? candidate.command.executable : canonical,
            }
            let key = commandKey(command, platform)
            if (platform === 'win32') {
                key = commandKey(
                    {
                        ...command,
                        executable: command.executable.replace(/\.(com|exe)$/i, '.exe'),
                    },
                    platform,
                )
            }
            const existing = seen.get(key)
            if (existing) {
                // An explicit selection changes priority, not the installation's origin.
                if (existing.source === 'custom' && candidate.source !== 'custom') {
                    existing.source = candidate.source
                    existing.installPath ??= candidate.installPath
                    existing.guiPath ??= candidate.guiPath
                }
                continue
            }
            const runtime = await check({ ...candidate, command })
            seen.set(key, runtime)
            result.runtimes.push(runtime)
            result.diagnostics.push(`Found ${runtime.version}: ${command.executable} ${command.argsPrefix.join(' ')} (${candidate.source})`)
        } catch (error) {
            const message = `${candidate.command.executable}: ${error instanceof Error ? error.message : String(error)}`
            result.diagnostics.push(message)
            if (candidate.source === 'custom') {
                result.configuredError = message
            }
        }
    }
    return result
}
