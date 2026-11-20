import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readJson, requireRelease, runNpm, sha256 } from './common/io.mjs'
import { digest, validatePlan } from './common/schema.mjs'
import { lspPath } from './common/target-matrix.mjs'
import { releaseAssets } from './build/assets.mjs'
import { verifyBinary } from './build/binary.mjs'

export function checkStage(root, receiptPath) {
    const actualRoot = realpathSync(root)
    requireRelease(receiptPath && lstatSync(receiptPath).isFile() &&
        dirname(realpathSync(receiptPath)) === join(actualRoot, '.release-work'), 'Missing local Builder receipt', 5)
    const receipt = readJson(receiptPath)
    const plan = validatePlan(receipt.plan)
    const target = receipt.target
    const manifest = readJson(join(root, 'package.json'))
    requireRelease(receipt.root === actualRoot && receipt.planSha256 === digest(plan) && plan.targets.includes(target) &&
        manifest.version === plan.version && manifest.publisher === plan.extension.publisher && manifest.name === plan.extension.name,
    'Staging receipt does not match the release identity', 5)
    const lsp = lspPath(target)
    requireRelease(readdirSync(join(root, 'server')).sort().join() === ['LICENSE-APACHE', target].sort().join() &&
        readdirSync(join(root, 'server', target)).join() === lsp.split('/').at(-1), 'Stage must contain one target server', 5)
    for (const asset of [lsp, ...releaseAssets]) {
        const file = join(root, asset)
        const stat = lstatSync(file)
        requireRelease(stat.isFile() && stat.size > 0 && realpathSync(file) === join(actualRoot, asset),
            `Missing or unsafe staged asset: ${asset}`, 5)
    }
    const bytes = readFileSync(join(root, lsp))
    requireRelease(sha256(bytes) === receipt.lspSha256, 'Staged LSP hash mismatch', 5)
    verifyBinary(bytes, target)
}

export function prepublish(root, env = process.env, command = runNpm) {
    if (env.SCAD_RELEASE_STAGING === '1') {
        checkStage(root, env.SCAD_RELEASE_RECEIPT)
        return
    }
    for (const script of ['build:lsp', 'package']) {
        command(['run', script], { cwd: root, env, log: true })
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        prepublish(process.cwd())
    } catch (error) {
        console.error(error.message)
        process.exitCode = 1
    }
}
