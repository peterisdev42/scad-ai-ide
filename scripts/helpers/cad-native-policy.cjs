const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const PRIMARY = 'Qwen3.6-35B-A3B-OptiQ-4bit'
const BACKUP = 'Qwen3.8-27B-4bit'
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
function selectModel(models, requested = PRIMARY) {
    assert.ok([PRIMARY, BACKUP].includes(requested), 'MODEL_NOT_ALLOWED: only the two user-selected Qwen models are allowed')
    assert.ok(
        models.some((m) => m.id === requested),
        'MODEL_UNAVAILABLE: exact requested model is absent; no implicit fallback',
    )
    return requested
}
function backupEligible(primary, baseline, candidateId, scenario) {
    return primary?.model === PRIMARY && primary.pass === false && primary.scenario === scenario && primary.candidateId === candidateId && baseline?.candidateId === candidateId && baseline.status === 'PASS' && primary.assessment?.backupEligible === true && ['MODEL_OUTPUT_ERROR', 'MODEL_PLANNING_OR_LATENCY'].includes(primary.assessment.category) && primary.assessment.confidence === 'supported' && primary.assessment.evidence?.length > 0
}
function validateEdit({ scenario, toolId, file, expectedFile, before, baseline, disk, args, manifestHash, expectedManifestHash, approvals = 0 }) {
    assert.equal(toolId, 'copilot_replaceString', 'MANUAL_REQUIRED: tool is outside the fixture edit allowlist')
    assert.equal(file, expectedFile, 'MANUAL_REQUIRED: fixture path does not match')
    assert.equal(approvals, 0, 'MANUAL_REQUIRED: only one fixture edit may be confirmed')
    assert.equal(manifestHash, expectedManifestHash, 'MANUAL_REQUIRED: manifest baseline changed')
    const pair = scenario === 'diagnostics' ? ['width=0;', 'width=1;'] : scenario === 'assembly' ? ['gap=0.18;', 'gap=0.30;'] : null
    assert.ok(pair, 'MANUAL_REQUIRED: this scenario has no automatic edit authorization')
    assert.equal(disk, baseline, 'MANUAL_REQUIRED: disk changed before the authorized edit')
    assert.equal(before, (scenario === 'diagnostics' ? '// Unsaved Native Agent acceptance buffer\n' : '') + baseline, 'MANUAL_REQUIRED: complete fixture buffer changed')
    assert.ok(args && typeof args.oldString === 'string' && args.oldString.length && typeof args.newString === 'string')
    assert.equal(before.split(args.oldString).length, 2, 'MANUAL_REQUIRED: replacement must be unique')
    assert.equal(before.replace(args.oldString, args.newString), before.replace(...pair), 'MANUAL_REQUIRED: edit changes more than the exact authorized parameter')
    return { beforeHash: sha256(before), afterHash: sha256(before.replace(...pair)), diskHash: sha256(disk) }
}
// Evidence is deliberately insufficient by default. HTTP 200, a timeout, or two failures never prove a model or product defect.
function assess({ pass, manual, exposure = [], rawCalls = [], traces = [], terminal, error }) {
    if (pass) return { category: 'NONE', confidence: 'observed', backupEligible: false, evidence: ['strict scenario oracle'] }
    if (manual) return { category: 'MANUAL_REQUIRED', confidence: 'observed', backupEligible: false, evidence: [manual] }
    if (exposure.some((r) => [401, 403].includes(r.status))) return { category: 'PROVIDER_OR_HOST', confidence: 'supported', backupEligible: false, evidence: ['Provider HTTP authentication rejection'] }
    if (/MODEL_UNAVAILABLE|ENV_UNAVAILABLE|HARNESS_UNAVAILABLE/.test(error ?? '')) return { category: 'ENVIRONMENT', confidence: 'supported', backupEligible: false, evidence: [error] }
    const compareMisuse = rawCalls.find(
        (t) =>
            /model_compare$/.test(t.name) &&
            (() => {
                try {
                    const a = JSON.parse(t.arguments)
                    return a.reportId && !a.baselineReportId && !a.targetReportId
                } catch {
                    return false
                }
            })(),
    )
    const rejection = traces.find((t) => t.capability === 'cad.compare' && t.output?.ok === false)
    if (compareMisuse && rejection && terminal) return { category: 'MODEL_OUTPUT_ERROR', confidence: 'supported', backupEligible: true, evidence: ['Raw model compare used read-only reportId instead of baselineReportId + targetReportId; native handler rejected it; terminal observed'], alternatives: ['Tool contract discoverability may also contribute; compare against current schema before claiming model incapability'] }
    return { category: 'UNKNOWN_OR_MULTI_FACTOR', confidence: 'unresolved', backupEligible: false, evidence: [error ?? 'scenario incomplete'], alternatives: ['Product, tool contract, model, provider, host and harness require independent checks'], latencyObservation: exposure.map((r) => ({ status: r.status, firstByteMs: r.firstByteMs, elapsedMs: r.elapsedMs, streamEnded: r.streamEnded })) }
}
module.exports = { PRIMARY, BACKUP, sha256, selectModel, backupEligible, validateEdit, assess }

// Some native transcript versions intentionally omit user messages. Bind by the
// actual provider tool-call id + name + parsed arguments from a marked request.
function transcriptMatches(events, marker, markedCalls, started) {
    const first = events.find((e) => e.type === 'session.start')
    if (!first || Date.parse(first.data?.startTime ?? first.timestamp) < started) return false
    if (JSON.stringify(events).includes(marker)) return true
    return events
        .filter((e) => e.type === 'assistant.message')
        .some((e) =>
            (e.data?.toolRequests ?? []).some((tool) =>
                markedCalls.some((raw) => {
                    if ((tool.toolCallId ?? tool.id) !== raw.id || tool.name !== raw.name || !raw.id) return false
                    try {
                        assert.deepEqual(typeof tool.arguments === 'string' ? JSON.parse(tool.arguments) : tool.arguments, JSON.parse(raw.arguments))
                        return true
                    } catch {
                        return false
                    }
                }),
            ),
        )
}
module.exports.transcriptMatches = transcriptMatches
