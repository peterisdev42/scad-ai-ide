import {
    appendFileSync, chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { artifactFilename, digest, validateArtifacts, validatePlan } from '../common/schema.mjs'
import { assertCommit, git, GitCommandError, publishFile, readJson, requireRelease, run, runNpm, sha256, writeJson } from '../common/io.mjs'
import { hostTarget, lspPath, targets } from '../common/target-matrix.mjs'
import { releaseExcludes } from './assets.mjs'
import { verifyBinary } from './binary.mjs'
import { smokeTarget } from './smoke.mjs'
import { readVsix, unpackLsp, verifyArtifactSet, verifyVsix } from './verify.mjs'

const prepublishHook = 'node scripts/release/prepublish.mjs'
const submodules = ['openscad', 'openscad-LSP', 'vscode-openscad-preview'].map(name => 'sources/' + name)

// Only the packaging hook and its helpers are overlaid when building older commits.
const hookFiles = ['prepublish.mjs', 'common/io.mjs', 'common/schema.mjs', 'common/target-matrix.mjs',
    'build/assets.mjs', 'build/binary.mjs']

export function cargoBuildArgs(target, source, out) {
    const config = targets[target]
    return [...(hostTarget === target ? ['build'] : config.cross), '--locked', '--release', '--target', config.triple,
        '--manifest-path', join(source, 'Cargo.toml'), '--target-dir', out]
}

function overlayHook(root, stage) {
    for (const file of hookFiles) {
        const local = join(root, 'scripts/release', file)
        const dest = join(stage, 'scripts/release', file)
        mkdirSync(dirname(dest), { recursive: true })
        rmSync(dest, { force: true })
        copyFileSync(local, dest)
    }
    appendFileSync(join(stage, '.vscodeignore'), '\n' + releaseExcludes.join('\n') + '\n')
}

export function injectVersion(stage, plan) {
    const manifestPath = join(stage, 'package.json')
    const lockPath = join(stage, 'package-lock.json')
    const manifest = readJson(manifestPath)
    const lock = readJson(lockPath)
    requireRelease(manifest.name === plan.extension.name && (!manifest.publisher ||
        manifest.publisher === plan.extension.publisher), 'Frozen source extension identity differs from Plan', 4)
    requireRelease(lock.name === manifest.name && lock.version === manifest.version &&
        lock.packages?.['']?.name === manifest.name && lock.packages[''].version === manifest.version,
    'Frozen source package lock does not match its manifest', 5)
    manifest.version = lock.version = lock.packages[''].version = plan.version
    manifest.publisher = plan.extension.publisher
    manifest.scripts['vscode:prepublish'] = prepublishHook
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n')
    writeFileSync(lockPath, JSON.stringify(lock, null, 4) + '\n')
    return manifest.engines.vscode
}

export function initializeStage(root, stage, plan) {
    git(stage, ['clone', '--quiet', '--no-checkout', '--shared', '--', root, '.'], 5)
    git(stage, ['checkout', '--quiet', '--detach', plan.sourceCommit], 5)
    requireRelease(git(stage, ['rev-parse', 'HEAD'], 5) === plan.sourceCommit, 'Staging source commit mismatch', 5)
    const identities = {}
    for (const relative of submodules) {
        const match = /^160000 commit ([0-9a-f]{40})\t/.exec(git(stage, ['ls-tree', plan.sourceCommit, '--', relative], 5))
        requireRelease(match, `Missing frozen gitlink: ${relative}`, 5)
        const source = join(root, relative)
        const destination = join(stage, relative)
        let localSource
        let localStatus = 'local checkout unavailable'
        try {
            const prefix = git(source, ['rev-parse', '--show-prefix'], 5)
            localStatus = 'local repository root differs from submodule directory'
            // Git reports an empty prefix at its worktree root. An uninitialized submodule
            // resolves to the parent repository and reports a nonempty prefix.
            if (prefix === '') {
                localStatus = 'frozen commit unavailable locally'
                if (git(source, ['cat-file', '-t', match[1]], 5) === 'commit') {
                    // Keep Git's spelling of the path when using it as a submodule URL.
                    localSource = git(source, ['rev-parse', '--show-toplevel'], 5)
                    localStatus = 'using local checkout'
                }
            }
        } catch {
            // A fresh clone can initialize from the source commit's .gitmodules.
        }
        try {
            if (localSource) git(stage, ['config', '--local', `submodule.${relative}.url`, localSource], 5)
            const overrides = localSource ? ['-c', 'protocol.file.allow=always'] : []
            git(stage, [...overrides, 'submodule', 'update', '--init', '--', relative], 5)
        } catch (error) {
            if (error instanceof GitCommandError) {
                error.message = `Cannot initialize frozen submodule ${relative}: ${error.message} (${localStatus})`
            }
            throw error
        }
        requireRelease(git(destination, ['rev-parse', 'HEAD'], 5) === match[1], `Staging submodule gitlink mismatch: ${relative}`, 5)
        identities[relative] = match[1]
    }
    return identities
}

async function buildTarget(root, stage, output, plan, target, options) {
    const submoduleCommits = initializeStage(root, stage, plan)
    overlayHook(root, stage)
    const engine = injectVersion(stage, plan)
    const env = { ...process.env, npm_config_cache: join(root, '.release-work/npm-cache') }
    for (const key of ['SCAD_RELEASE_STAGING', 'SCAD_RELEASE_RECEIPT', 'VSCE_PAT', 'OVSX_PAT']) delete env[key]
    const command = { cwd: stage, env, log: true }
    runNpm(['ci', '--no-audit', '--no-fund'], command)
    const lspSource = join(stage, 'sources/openscad-LSP')
    const cargoOut = join(stage, '.build/lsp')
    run(process.env.CARGO || 'cargo', cargoBuildArgs(target, lspSource, cargoOut), { ...command, cwd: lspSource })
    const config = targets[target]
    const binary = join(cargoOut, config.triple, 'release', config.executable)
    verifyBinary(readFileSync(binary), target)
    runNpm(['run', 'package'], command)
    const executable = join(stage, lspPath(target))
    mkdirSync(dirname(executable), { recursive: true })
    copyFileSync(binary, executable)
    chmodSync(executable, 0o755)
    copyFileSync(join(lspSource, 'LICENSE-APACHE'), join(stage, 'server/LICENSE-APACHE'))
    const receipt = join(stage, '.release-work/staging.json')
    mkdirSync(dirname(receipt), { recursive: true })
    writeJson(receipt, { root: realpathSync(stage), plan, planSha256: digest(plan), target, lspSha256: sha256(readFileSync(executable)) })
    run(process.execPath, [join(root, 'node_modules/@vscode/vsce/vsce'), 'package',
        '--target', target, '--out', output, '--no-dependencies', ...(plan.preRelease ? ['--pre-release'] : [])], {
        ...command, env: { ...env, SCAD_RELEASE_STAGING: '1', SCAD_RELEASE_RECEIPT: receipt },
    })
    const checked = await verifyVsix(readVsix(output), plan, target, {
        engine, sourceAsset: asset => readFileSync(join(stage, asset)),
    })
    const validation = await smokeTarget({ root: join(stage, '.release-work/smoke'), executable, target,
        vscode: options.vscodeExecutable, vsix: output, plan })
    return { item: { target, file: artifactFilename(plan, target), lspTriple: config.triple, ...checked, validation }, submoduleCommits }
}

export async function buildRelease(root, plan, planPath, options) {
    validatePlan(plan)
    requireRelease(!plan.status || options.allowUnreserved, 'Draft build requires --allow-unreserved')
    const selected = options.target ? plan.targets.filter(target => options.target.includes(target)) : plan.targets
    requireRelease(selected.length && (!options.target || selected.length === options.target.length), 'Target not in Plan')
    assertCommit(root, plan.sourceCommit)
    const directory = resolve(options.out ?? dirname(resolve(planPath)))
    mkdirSync(directory, { recursive: true })
    const work = join(root, '.release-work')
    mkdirSync(work, { recursive: true })
    const stagingOutput = mkdtempSync(join(directory, '.release-build-'))
    const artifacts = []
    let submoduleCommits
    try {
        for (const target of selected) {
            const stage = mkdtempSync(join(work, `stage-${target}-`))
            try {
                const output = join(stagingOutput, artifactFilename(plan, target))
                const result = await buildTarget(root, stage, output, plan, target, options)
                artifacts.push(result.item)
                submoduleCommits = result.submoduleCommits
            } finally {
                rmSync(stage, { recursive: true, force: true })
            }
        }
        const complete = selected.length === plan.targets.length
        const manifest = { schemaVersion: 1, releaseId: plan.releaseId, planSha256: digest(plan), version: plan.version,
            channel: plan.channel, sourceCommit: plan.sourceCommit, artifacts }
        const manifestPath = join(directory, 'release-artifacts.json')
        if (complete) validateArtifacts(manifest, plan)
        for (const item of artifacts) {
            publishFile(join(stagingOutput, item.file), join(directory, item.file))
        }
        if (complete) writeJson(manifestPath, manifest, { immutable: true })
        const code = artifacts.some(item => Object.values(item.validation).includes('fail')) ? 5 : 0
        return { status: complete ? 'complete' : 'partial', manifest: complete ? manifestPath : null, artifacts, submoduleCommits, code }
    } finally {
        rmSync(stagingOutput, { recursive: true, force: true })
    }
}

export async function verifyRelease(root, plan, manifest, manifestPath, options) {
    await verifyArtifactSet(plan, manifest, manifestPath)
    const result = { verified: true, artifactsSha256: digest(manifest) }
    if (!options.smokeOut) return result
    const item = manifest.artifacts.find(artifact => artifact.target === hostTarget)
    requireRelease(item, 'The current host has no packaged target')
    if (options.vscodeExecutable) requireRelease(lstatSync(resolve(options.vscodeExecutable)).isFile(), 'Invalid VS Code executable')
    const work = join(root, '.release-work')
    mkdirSync(work, { recursive: true })
    const scratch = mkdtempSync(join(work, 'verify-smoke-'))
    try {
        const vsix = join(dirname(resolve(manifestPath)), item.file)
        const bytes = readVsix(vsix)
        requireRelease(sha256(bytes) === item.sha256, 'VSIX changed during smoke verification', 4)
        const snapshot = join(scratch, item.file)
        writeFileSync(snapshot, bytes)
        const executable = join(scratch, targets[item.target].executable)
        writeFileSync(executable, await unpackLsp(bytes, item.target), { mode: 0o755 })
        const validation = await smokeTarget({ root: scratch, executable, target: item.target,
            vscode: options.vscodeExecutable, vsix: snapshot, plan })
        writeJson(resolve(options.smokeOut), { schemaVersion: 1, artifactsSha256: result.artifactsSha256,
            targets: [{ target: item.target, sha256: item.sha256, ...validation }] })
        return { ...result, validation, code: Object.values(validation).includes('fail') ? 5 : 0 }
    } finally {
        // Windows can retain a handle briefly after the smoke processes exit.
        rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
}
