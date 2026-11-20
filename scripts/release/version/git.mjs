import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertCommit, canonical, git, gitRaw, ReleaseError, requireRelease } from '../common/io.mjs'
import { digest, parseVersion, validatePlan } from '../common/schema.mjs'

export const gitVersion = tag => {
    if (!tag.startsWith('v')) return null
    try {
        parseVersion(tag.slice(1))
        return tag.slice(1)
    } catch {
        return null
    }
}

export function repositoryFor(root) {
    const remote = git(root, ['remote', 'get-url', 'origin'], 2)
    const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote)
    requireRelease(match, 'Expected a GitHub origin')
    return match[1]
}

export function gitTags(root, remote = 'origin') {
    return git(root, ['ls-remote', '--refs', '--tags', '--', remote]).split('\n').filter(Boolean)
        .map(line => line.split('\t')[1].replace('refs/tags/', ''))
}

export function assertMaintenance(root, plan, ref) {
    const [major, minor, patch] = parseVersion(plan.version)
    if (plan.channel !== 'stable' || patch === 0) return
    requireRelease(plan.maintenanceTag && ref && /^refs\/(heads|remotes\/origin)\/(?!main$|master$)[\w./-]+$/.test(ref),
        'Stable hotfix requires a maintenance tag and dedicated maintenance ref')
    git(root, ['check-ref-format', ref], 2)
    const [baseMajor, baseMinor, basePatch] = parseVersion(plan.maintenanceTag.slice(1))
    requireRelease(baseMajor === major && baseMinor === minor && basePatch + 1 === patch, 'Hotfix must increment its Stable base')
    const base = git(root, ['rev-parse', '--verify', `refs/tags/${plan.maintenanceTag}^{commit}`], 2)
    git(root, ['merge-base', '--is-ancestor', base, plan.sourceCommit], 2)
    const commits = git(root, ['rev-list', '--first-parent', `${base}..${ref}`], 2).split('\n')
    requireRelease(commits.includes(plan.sourceCommit), 'Stable hotfix commit must be on the maintenance branch first-parent history')
}

const tagRef = plan => `refs/tags/${plan.tag}`
const tagHeader = plan => `scad-release-plan-sha256 ${digest(plan)}\n\n`
const tagMessage = plan => tagHeader(plan) + canonical(plan)

function scratch(action) {
    const root = mkdtempSync(join(tmpdir(), 'scad-release-git-'))
    try {
        git(root, ['init', '--bare', '--quiet'], 5)
        return action(root)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
}

function inspectTag(root, remote, plan, advertised) {
    const ref = tagRef(plan)
    git(root, ['fetch', '--no-tags', '--', remote, ref])
    const object = git(root, ['rev-parse', 'FETCH_HEAD'])
    requireRelease(object === advertised && git(root, ['cat-file', '-t', object]) === 'tag', 'Tag is not the advertised annotated object', 4)
    const tag = gitRaw(root, ['cat-file', 'tag', object])
    const separator = tag.indexOf('\n\n')
    requireRelease(separator !== -1 && tag.startsWith(`object ${plan.sourceCommit}\ntype commit\ntag ${plan.tag}\n`) &&
        git(root, ['rev-parse', 'FETCH_HEAD^{commit}']) === plan.sourceCommit &&
        tag.slice(separator + 2) === tagMessage(plan),
    'Remote tag belongs to a different release plan', 4)
    return { status: 'reserved', tag: plan.tag, tagObject: object, planSha256: digest(plan) }
}

function advertisedTag(root, remote, plan) {
    const response = git(root, ['ls-remote', '--refs', '--tags', '--', remote, tagRef(plan)])
    if (!response) return null
    const [object, ref] = response.split('\t')
    requireRelease(/^[a-f0-9]{40}$/.test(object) && ref === tagRef(plan), 'Unexpected remote tag response', 3)
    return object
}

export function remoteReservation(remote, plan) {
    validatePlan(plan)
    requireRelease(!plan.status, 'A draft has no publishable reservation')
    return scratch(root => {
        const existing = advertisedTag(root, remote, plan)
        return existing ? inspectTag(root, remote, plan, existing) : null
    })
}

export function reserveTag(source, remote, plan) {
    validatePlan(plan)
    requireRelease(!plan.status, 'Expected a frozen Plan')
    assertCommit(source, plan.sourceCommit)
    return scratch(root => {
        const existing = advertisedTag(root, remote, plan)
        if (existing) return { ...inspectTag(root, remote, plan, existing), created: false }
        git(root, ['fetch', '--no-tags', '--', source, plan.sourceCommit], 5)
        const message = join(root, 'plan-message.txt')
        writeFileSync(message, tagMessage(plan))
        const name = git(source, ['config', '--get', 'user.name'], 2)
        const email = git(source, ['config', '--get', 'user.email'], 2)
        git(root, ['-c', `user.name=${name}`, '-c', `user.email=${email}`, '-c', 'tag.gpgSign=false',
            'tag', '-a', '--cleanup=verbatim', '-F', message, plan.tag, plan.sourceCommit], 5)
        const local = git(root, ['rev-parse', tagRef(plan)])
        let output
        try {
            output = git(root, ['push', '--porcelain', '--', remote, `${tagRef(plan)}:${tagRef(plan)}`])
        } catch (error) {
            const winner = advertisedTag(root, remote, plan)
            if (winner) throw new ReleaseError(4, 'Tag appeared during reservation. Verify the existing plan before retrying.')
            throw error
        }
        return { status: 'reserved', tag: plan.tag, tagObject: local, planSha256: digest(plan),
            created: output.split('\n').some(line => line.startsWith('*\t')) }
    })
}

export function remoteFrozenPlans(remote, repository, extension, versions) {
    if (!versions.length) return {}
    return scratch(root => {
        const refs = versions.map(version => `refs/tags/v${version}`)
        git(root, ['fetch', '--no-tags', '--', remote, ...refs.map(ref => `${ref}:${ref}`)])
        const plans = {}
        for (const [index, version] of versions.entries()) {
            const ref = refs[index]
            if (git(root, ['cat-file', '-t', ref]) !== 'tag') continue
            const tag = gitRaw(root, ['cat-file', 'tag', ref])
            const message = tag.slice(tag.indexOf('\n\n') + 2)
            if (!message.startsWith('scad-release-plan-sha256 ')) continue
            const plan = validatePlan(JSON.parse(message.slice(message.indexOf('\n\n') + 2)))
            requireRelease(!plan.status && plan.version === version && plan.repository === repository &&
                plan.extension.name === extension.name && plan.extension.publisher === extension.publisher &&
                message === tagMessage(plan) && tag.startsWith(`object ${plan.sourceCommit}
type commit
tag ${plan.tag}
`),
            'Unexpected release identity in remote tag', 3)
            plans[version] = plan
        }
        return plans
    })
}
