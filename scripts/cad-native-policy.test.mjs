import test from 'node:test'
import assert from 'node:assert/strict'
import { ToolStream } from './helpers/cad-native-run.mjs'
import policy from './helpers/cad-native-policy.cjs'
const { PRIMARY, BACKUP, selectModel, validateEdit, assess, backupEligible } = policy
test('model selection never falls back to an unrelated or backup model silently', () => {
    assert.equal(selectModel([{ id: 'Hy-MT2' }, { id: PRIMARY }]), PRIMARY)
    assert.throws(() => selectModel([{ id: BACKUP }]), /MODEL_UNAVAILABLE/)
    assert.equal(selectModel([{ id: BACKUP }], BACKUP), BACKUP)
    assert.throws(() => selectModel([{ id: 'other' }], 'other'), /MODEL_NOT_ALLOWED/)
})
test('backup requires supported attribution and the identical candidate/scenario', () => {
    const primary = { model: PRIMARY, pass: false, scenario: 'comparison', candidateId: 'x', assessment: { category: 'MODEL_OUTPUT_ERROR', confidence: 'supported', backupEligible: true, evidence: ['raw compare misuse + native rejection'] } }
    const baseline = { candidateId: 'x', status: 'PASS' }
    assert.equal(backupEligible(primary, baseline, 'x', 'comparison'), true)
    for (const p of [
        { ...primary, candidateId: 'old' },
        { ...primary, pass: true },
        { ...primary, assessment: { ...primary.assessment, confidence: 'unresolved' } },
        { ...primary, assessment: { ...primary.assessment, category: 'PROVIDER_OR_HOST' } },
    ])
        assert.equal(backupEligible(p, baseline, 'x', 'comparison'), false)
    assert.equal(backupEligible(primary, { ...baseline, status: 'FAIL' }, 'x', 'comparison'), false)
})
const source = 'width=0;\nassert(width>0);\ncube(width);\n'
const edit = { scenario: 'diagnostics', toolId: 'copilot_replaceString', file: '/fixture/model.scad', expectedFile: '/fixture/model.scad', baseline: source, disk: source, before: '// Unsaved Native Agent acceptance buffer\n' + source, args: { oldString: 'width=0;', newString: 'width=1;' } }
test('fixture approval validates full buffer, unchanged disk, path, unique replacement and baseline hash', () => {
    assert.ok(validateEdit(edit).afterHash)
    for (const changed of [{ file: '/other' }, { before: edit.before + '// extra' }, { disk: source + '// saved' }, { args: { oldString: 'width=0;', newString: 'width=1;\n// other' } }, { approvals: 1 }, { manifestHash: 'changed', expectedManifestHash: 'original' }, { scenario: 'feedback' }, { toolId: 'terminal' }]) assert.throws(() => validateEdit({ ...edit, ...changed }))
})
test('whole-source gap replacement is the only assembly edit in the allowlist', () => {
    const baseline = 'gap=0.18;\ncube(1);',
        base = { ...edit, scenario: 'assembly', baseline, before: baseline, disk: baseline, args: { oldString: baseline, newString: baseline.replace('gap=0.18;', 'gap=0.30;') }, manifestHash: 'fixed', expectedManifestHash: 'fixed' }
    assert.ok(validateEdit(base).afterHash)
    assert.throws(() => validateEdit({ ...base, args: { oldString: 'gap=0.18;', newString: 'gap=0.25;' } }))
})
test('stream collector reconstructs fragmented raw tool arguments and separates HTTP from stream end', () => {
    const stream = new ToolStream(),
        data = [{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'scad_ai_ide_model_compare', arguments: '{"report' } }] } }] }, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'Id":"raw-v2"}' } }] }, finish_reason: 'tool_calls' }] }].map((x) => 'data: ' + JSON.stringify(x) + '\r\n').join('') + 'data: [DONE]\n'
    for (const char of data) stream.append(char)
    assert.equal(stream.done, true)
    assert.equal(stream.malformed, false)
    assert.deepEqual([...stream.calls.values()], [{ id: 'call-1', name: 'scad_ai_ide_model_compare', arguments: '{"reportId":"raw-v2"}' }])
    assert.deepEqual(stream.finishReasons, ['tool_calls'])
})
test('timeouts and HTTP 200 alone remain unknown, human waits and auth get independent categories', () => {
    const unknown = assess({ pass: false, error: '240s timeout', exposure: [{ status: 200 }] })
    assert.equal(unknown.category, 'UNKNOWN_OR_MULTI_FACTOR')
    assert.equal(unknown.backupEligible, false)
    assert.equal(assess({ manual: 'surface submission' }).category, 'MANUAL_REQUIRED')
    assert.equal(assess({ exposure: [{ status: 401 }] }).category, 'PROVIDER_OR_HOST')
})
test('model argument attribution needs raw generation, handler rejection and terminal evidence together', () => {
    const evidence = { pass: false, rawCalls: [{ name: 'scad_ai_ide_model_compare', arguments: '{"reportId":"raw-v2"}' }], traces: [{ capability: 'cad.compare', output: { ok: false } }], terminal: true }
    assert.equal(assess(evidence).category, 'MODEL_OUTPUT_ERROR')
    assert.equal(assess({ ...evidence, terminal: false }).backupEligible, false)
    assert.equal(assess({ ...evidence, traces: [] }).backupEligible, false)
    assert.equal(assess({ ...evidence, rawCalls: [] }).backupEligible, false)
})
test('Copilot acceptance requires the actual Agent Host identity and matching request marker', () => {
    const request = { message: { text: 'CAD_ACCEPTANCE_RUN=test\nverify' }, agent: { id: 'agent-host-copilotcli' } }
    assert.equal(policy.copilotRequest({ requests: [request] }, 'CAD_ACCEPTANCE_RUN=test'), request)
    for (const id of ['github.copilot.editsAgent', 'local', 'copilotcli', undefined]) assert.throws(() => policy.copilotRequest({ requests: [{ ...request, agent: { id } }] }, 'CAD_ACCEPTANCE_RUN=test'), /HARNESS_MISMATCH/)
    assert.throws(() => policy.copilotRequest({ requests: [request] }, 'another-run'), /UNCORRELATED/)
})
test('native Copilot authentication rejection is a host block, never a model-capability failure', () => {
    const r = policy.assess({ pass: false, hostError: 'Authentication is required to start a session. Please sign in and try again.', exposure: [{ path: '/v1/models', status: 200 }] })
    assert.equal(r.category, 'PROVIDER_OR_HOST')
    assert.equal(r.backupEligible, false)
})
test('a displayed Qwen selection cannot validate an actually resolved cloud model', () => {
    policy.assertResolvedModel('omlx/' + policy.PRIMARY, policy.PRIMARY)
    policy.assertResolvedModel(policy.PRIMARY, policy.PRIMARY)
    assert.throws(() => policy.assertResolvedModel('gpt-6-luna', policy.PRIMARY), /MODEL_ROUTING_MISMATCH/)
})
