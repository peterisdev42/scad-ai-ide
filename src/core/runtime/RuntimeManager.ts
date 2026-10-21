import type { DiscoveryOptions, DiscoveryResult, Runtime } from './types'

export class RuntimeManager {
    result: DiscoveryResult = { runtimes: [], diagnostics: [] }
    active?: Runtime

    constructor(private readonly detect: (options: DiscoveryOptions) => Promise<DiscoveryResult>) {}

    async refresh(options: DiscoveryOptions): Promise<void> {
        const result = await this.detect(options)
        this.result = result
        this.active = result.configuredError ? undefined : result.runtimes[0]
    }

    clear(): void {
        this.result = { runtimes: [], diagnostics: [] }
        this.active = undefined
    }
}
