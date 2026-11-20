import { join } from 'node:path'
import { attempt, requireRelease } from '../common/io.mjs'
import { marketHistory, remotePackage } from '../version/providers.mjs'

const commands = {
    vscode: { binary: '@vscode/vsce/vsce', credential: 'VSCE_PAT',
        endpoint: { VSCE_MARKETPLACE_URL: 'https://marketplace.visualstudio.com' },
        publish: file => ['publish', '--packagePath', file] },
    openvsx: { binary: 'ovsx/bin/ovsx', credential: 'OVSX_PAT',
        endpoint: { OVSX_REGISTRY_URL: 'https://open-vsx.org' },
        publish: file => ['publish', file] },
}

export function providers(root) {
    return Object.fromEntries(Object.entries(commands).map(([market, config]) => {
        const tool = args => {
            const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(VSCE|OVSX)_/i.test(key)))
            Object.assign(env, config.endpoint, { [config.credential]: process.env[config.credential] })
            return attempt(process.execPath, [join(root, 'node_modules', config.binary), ...args], { env, timeout: 120_000 })
        }
        return [market, {
            query: extension => marketHistory(market, extension),
            download: (extension, version, target, maxBytes) => remotePackage(market, extension, version, target, { maxBytes }),
            authenticate: async publisher => {
                requireRelease(process.env[config.credential], `Missing ${config.credential}`, 2)
                requireRelease((await tool(['verify-pat', publisher])).pass, `${market} publisher verification failed`, 3)
            },
            upload: async path => {
                const result = await tool(config.publish(path))
                requireRelease(result.pass, `${market} upload returned an error`, 6)
            },
        }]
    }))
}
