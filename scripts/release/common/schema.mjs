import Ajv from 'ajv'
import { canonical, requireRelease, sha256 } from './io.mjs'
import { markets, targetNames, targets } from './target-matrix.mjs'

const versionPattern = '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'
const identifier = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$' }
const version = { type: 'string', maxLength: 50, pattern: versionPattern }
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' }
const commit = { type: 'string', pattern: '^[a-f0-9]{40}$' }
const channel = { enum: ['stable', 'preview'] }
const target = { enum: targetNames }
const changes = ['none', 'fix', 'feature', 'breaking']
const schemaVersion = { const: 1 }
const managedReleaseId = { type: 'string', pattern: '^[a-zA-Z0-9-]+-v[0-9.]+$' }
const string = (maxLength = 1000) => ({ type: 'string', maxLength })
const array = (items, options = {}) => ({ type: 'array', items, ...options })
const object = (properties, optional = []) => ({
    type: 'object', properties, additionalProperties: false,
    required: Object.keys(properties).filter(key => !optional.includes(key)),
})
const boolean = { type: 'boolean' }
const checks = { enum: ['pass', 'fail', 'not-run'] }
const runtimeProperties = {
    compile: checks, 'binary-header': checks, 'cli-smoke': checks, 'lsp-stdio': checks, 'vsix-install': checks,
    machine: string(200), reason: string(500),
}
const analysis = object({
    changeLevel: { enum: changes }, summary: string(), evidence: array(string(), { maxItems: 100 }),
    risks: array(string(), { maxItems: 100 }), confidence: { type: 'number', minimum: 0, maximum: 1 }, needsReview: boolean,
}, ['risks'])
const planSchema = object({
    schemaVersion, releaseId: managedReleaseId,
    repository: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9-]*/[a-zA-Z0-9][a-zA-Z0-9_.-]*$' },
    extension: object({ publisher: identifier, name: identifier }), version, channel, preRelease: boolean,
    sourceCommit: commit, tag: { type: 'string', pattern: '^v[0-9.]+$' },
    targets: array(target, { minItems: 1, maxItems: 4, uniqueItems: true }),
    changeAnalysis: analysis, status: { const: 'draft-unreserved' }, offlineMock: { const: true },
    maintenanceTag: { type: 'string', pattern: '^v[0-9.]+$' },
}, ['status', 'offlineMock', 'maintenanceTag'])
const artifactSchema = object({
    schemaVersion, releaseId: managedReleaseId, planSha256: hash, version, channel, sourceCommit: commit,
    artifacts: array(object({
        target, file: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9.-]*\\.vsix$' },
        sha256: hash, sizeBytes: { type: 'integer', minimum: 1 }, lspTriple: string(100), lspSha256: hash,
        verified: { const: true }, validation: object(runtimeProperties),
    }, ['validation']), { minItems: 1, maxItems: 4 }),
})
const stateCell = object({
    status: { enum: ['pending', 'uploading', 'uploaded', 'verified', 'failed', 'blocked', 'unknown'] },
    attempts: { type: 'integer', minimum: 0 },
    remoteVersion: { type: ['string', 'null'] },
    lastErrorCode: { type: ['string', 'null'], pattern: '^[a-z0-9-]{1,100}$' },
    remoteMetadataVerified: boolean, bytesVerified: boolean, uploadedOnce: boolean,
})
const stateSchema = object({
    schemaVersion, releaseId: managedReleaseId, planSha256: hash, artifactsSha256: hash,
    overall: { enum: ['pending', 'partial', 'complete', 'blocked'] },
    targets: object(Object.fromEntries(markets.map(market => [market,
        object(Object.fromEntries(targetNames.map(name => [name, stateCell])), targetNames)]))),
})
const smokeSchema = object({
    schemaVersion, artifactsSha256: hash,
    targets: array(object({ target, sha256: hash, ...runtimeProperties }), { minItems: 1, maxItems: 4 }),
})
const ajv = new Ajv()
const schemas = Object.fromEntries(Object.entries({ plan: planSchema, artifact: artifactSchema,
    state: stateSchema, analysis, smoke: smokeSchema }).map(([key, schema]) => [key, ajv.compile(schema)]))

export function validate(type, data) {
    const check = schemas[type]
    requireRelease(check(data), `Invalid ${type}: ${check.errors?.map(error => `${error.instancePath || '/'} ${error.message}`).join(', ')}`)
    return data
}

export function parseVersion(value) {
    requireRelease(typeof value === 'string' && new RegExp(versionPattern).test(value), 'Expected MAJOR.MINOR.PATCH')
    const parts = value.split('.').map(Number)
    requireRelease(parts.every(Number.isSafeInteger) && parts.join('.') === value, 'Non-canonical or out-of-range version')
    return parts
}

export function versionChannel(value) {
    return parseVersion(value)[1] % 2 === 0 ? 'stable' : 'preview'
}

export function orderedTargets(values) {
    requireRelease(values.length > 0 && values.every(value => targetNames.includes(value)) &&
        new Set(values).size === values.length, 'Unsupported or duplicate target')
    return targetNames.filter(target => values.includes(target))
}

export function validatePlan(plan) {
    validate('plan', plan)
    requireRelease([plan.repository, plan.extension.publisher, plan.extension.name, plan.sourceCommit].every(value =>
        value.trim() === value), 'Unexpected whitespace in Plan identity')
    requireRelease(plan.releaseId === `${plan.extension.name}-v${plan.version}` &&
        plan.tag === `v${plan.version}` && plan.channel === versionChannel(plan.version) &&
        plan.preRelease === (plan.channel === 'preview'), 'Inconsistent Plan identity or channel')
    requireRelease(orderedTargets(plan.targets).join() === plan.targets.join(), 'Unsorted Plan targets')
    requireRelease(!plan.offlineMock || plan.status === 'draft-unreserved', 'Offline plans must remain drafts')
    if (plan.maintenanceTag) {
        requireRelease(versionChannel(plan.maintenanceTag.slice(1)) === 'stable' && plan.channel === 'stable',
            'Invalid Stable maintenance tag')
    }
    return plan
}

export const digest = data => sha256(canonical(data))

export function validateArtifacts(manifest, plan) {
    validate('artifact', manifest)
    for (const key of ['releaseId', 'version', 'channel', 'sourceCommit']) {
        requireRelease(manifest[key] === plan[key], `Artifact Manifest ${key} mismatch`, 4)
    }
    requireRelease(manifest.planSha256 === digest(plan), 'Artifact Manifest Plan hash mismatch', 4)
    requireRelease(manifest.artifacts.map(item => item.target).join() === plan.targets.join(),
        'Artifact Manifest must contain all planned targets in order', 4)
    for (const item of manifest.artifacts) {
        requireRelease(item.file === artifactFilename(plan, item.target) &&
            item.lspTriple === targets[item.target].triple, 'Artifact filename or Cargo triple mismatch', 4)
    }
    return manifest
}

export const artifactFilename = (plan, target) => `${plan.extension.name}-${plan.version}-${target}.vsix`
