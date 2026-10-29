export type RuntimeSource = 'custom' | 'PATH' | 'official' | 'homebrew' | 'macports' | 'native-package' | 'scoop' | 'snap' | 'flatpak' | 'bundled' | 'managed'

export interface LaunchCommand {
    executable: string
    argsPrefix: string[]
}

export interface Candidate {
    source: RuntimeSource
    command: LaunchCommand
    installPath?: string
    guiPath?: string
}

export interface Runtime extends Candidate {
    id: string
    version: string
    tag?: string
    release?: string
    platform: NodeJS.Platform
    status: 'available'
}

export interface DiscoveryResult {
    runtimes: Runtime[]
    diagnostics: string[]
    configuredError?: string
}

export interface DiscoveryOptions {
    configuredPath?: string
    configuredCommand?: LaunchCommand
    bundledPath?: string
    managedPaths?: string[]
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
    home?: string
}
