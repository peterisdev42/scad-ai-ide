import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { buildRelease, verifyRelease } from './build/build.mjs'
import { readJson, ReleaseError, requireRelease } from './common/io.mjs'
import { orderedTargets, validatePlan } from './common/schema.mjs'
import { publishRelease } from './publish/publish.mjs'
import { providers } from './publish/providers.mjs'
import { remoteReservation } from './version/git.mjs'
import { extensionIdentity, officialRemote, reserveVersion, resolveCandidate, verifyVersionPlan, versionStatus, writeDraft } from './version/version.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const string = { type: 'string' }
const flag = { type: 'boolean' }
const repeated = { type: 'string', multiple: true }
const common = { help: { ...flag, short: 'h' }, json: flag }
const identity = { publisher: string, offline: string }
const resolver = { ...identity, channel: string, change: string, cycle: string, base: string, major: string, approve: flag }
const reservation = { apply: flag, 'dry-run': flag, 'confirm-release': string }
const publish = { ...reservation, plan: string, artifacts: string, market: string, target: repeated,
    query: flag, smoke: repeated, publisher: string }
const commands = {
    'version status': identity,
    'version resolve': resolver,
    'version plan': { ...resolver, commit: string, out: string, analysis: string, target: repeated, 'maintenance-ref': string },
    'version verify': { ...identity, plan: string, 'maintenance-ref': string },
    'version reserve': { ...reservation, ...identity, plan: string, out: string, 'maintenance-ref': string },
    build: { plan: string, target: repeated, out: string, 'allow-unreserved': flag, 'vscode-executable': string },
    verify: { plan: string, artifacts: string, 'smoke-out': string, 'vscode-executable': string },
    publish,
    reconcile: { plan: string, artifacts: string, market: string, target: repeated },
}

const help = {
    'version status': 'Read Git and both stores. --offline points to a mock history JSON.',
    'version resolve': 'Allocate a candidate for --channel stable|preview. Cycles: initial, continue, next, promote, hotfix, major.',
    'version plan': 'Write an immutable .draft.json for --commit and --out. Hotfixes need a dedicated full --maintenance-ref.',
    'version verify': 'Validate identity, source, reservation (when present) and conflicts.',
    'version reserve': 'Dry-run by default. Apply needs --confirm-release, authorized publisher and a frozen --out path.',
    build: 'Build the frozen source. Drafts need --allow-unreserved. Repeat --target to select a subset.',
    verify: 'Verify all artifact bytes. --smoke-out exercises this host; --vscode-executable enables install/activation.',
    publish: 'Dry-run by default. --query adds market reads. Apply requires reservation, publisher, confirmation and runtime evidence.',
    reconcile: 'Compare each market and target using public metadata and original VSIX hashes.',
}

function argumentsFor(argv) {
    const positionals = argv[0] === 'version' ? 2 : 1
    const command = argv.slice(0, positionals).join(' ')
    if (!argv.length || argv[0] === '--help' || argv[0] === '-h') return { command: 'help' }
    requireRelease(Object.hasOwn(commands, command), 'Unknown release command. Use --help')
    let values
    try {
        values = parseArgs({ args: argv.slice(positionals), options: { ...commands[command], ...common }, strict: true }).values
    } catch {
        throw new ReleaseError(2, 'Unknown option or missing option value. Use --help')
    }
    const options = Object.fromEntries(Object.entries(values).map(([key, value]) =>
        [key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]))
    if (options.target) options.target = orderedTargets(options.target)
    requireRelease(!(options.apply && options.dryRun), '--apply and --dry-run are mutually exclusive')
    return { command, options }
}

async function execute(command, options) {
    if (command === 'help') return { commands: Object.keys(commands), usage: 'node scripts/release/cli.mjs <command> --help' }
    if (options.help) return { command, description: help[command], options: Object.entries({ ...commands[command], ...common })
        .map(([key, spec]) => '--' + key + (spec.type === 'string' ? ' <value>' : '') + (spec.multiple ? ' (repeatable)' : '')) }

    if (['version status', 'version resolve', 'version plan'].includes(command)) {
        const status = await versionStatus(root, options)
        if (command === 'version status') return { ...status, code: status.configurationMissing ? 2 : status.complete ? 0 : 3 }
        const candidate = resolveCandidate(status, options)
        if (command === 'version resolve') return { ...candidate, code: candidate.status === 'recoveryRequired' ? 4 : 0 }
        return writeDraft(root, status, candidate, options)
    }

    requireRelease(options.plan, '--plan is required')
    const plan = validatePlan(readJson(options.plan))
    if (command === 'version verify') {
        const source = verifyVersionPlan(root, plan, options)
        const status = await versionStatus(root, options)
        const reservation = !plan.status && !options.offline ? remoteReservation(officialRemote(plan), plan) : null
        const release = status.releases.find(item => item.version === plan.version)
        const verified = status.complete && !status.offlineMock && (plan.status ? !release : Boolean(reservation) && release?.status !== 'conflict')
        return { ...source, verified, offlineMock: status.offlineMock, marketStatus: release?.status ?? (status.complete ? 'available' : 'unknown'),
            reservation, code: verified || status.offlineMock ? 0 : status.configurationMissing ? 2 : status.complete ? 4 : 3 }
    }
    if (command === 'version reserve') return reserveVersion(root, plan, options)
    if (command === 'build') return buildRelease(root, plan, options.plan, options)

    requireRelease(options.artifacts, '--artifacts is required')
    const manifest = readJson(options.artifacts)
    if (command === 'verify') return verifyRelease(root, plan, manifest, options.artifacts, options)
    if (options.apply) {
        requireRelease(extensionIdentity(root, options).publisher === plan.extension.publisher,
            'Configure the authorized publisher before applying')
    }
    return publishRelease(plan, manifest, options.artifacts, { ...options, query: command === 'reconcile' || options.query }, {
        providers: providers(root), verifyReservation: plan => remoteReservation(officialRemote(plan), plan),
    })
}

try {
    const { command, options } = argumentsFor(process.argv.slice(2))
    const { code = 0, ...output } = await execute(command, options)
    console.log(JSON.stringify(output, null, options?.json ? 0 : 2))
    process.exitCode = code
} catch (error) {
    const code = error instanceof ReleaseError ? error.code : 5
    const output = { error: error instanceof ReleaseError ? error.message : 'Local release operation failed', code }
    console.log(JSON.stringify(output))
    process.exitCode = code
}
