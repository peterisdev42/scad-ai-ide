import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'

// Archive only fixture inputs, actual tool calls, outcomes and visible model
// text. Never copy a whole VS Code profile or infer acceptance from exit code.
const [directory, destination] = process.argv.slice(2)
assert.ok(directory && destination, 'Usage: node scripts/customizer-native-evidence.mjs <run-directory> <evidence-directory>')
const read = async name => {
    try { return await readFile(path.join(directory, name), 'utf8') }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
}
const input = JSON.parse(await read('request-input.json'))
const resultText = await read('result.json')
const result = resultText ? JSON.parse(resultText) : { ready: JSON.parse(await read('ready.json') ?? '{}'), requestFinished: false, terminalReason: 'outcomeNotPersistedByController' }
const calls = JSON.parse(await read('tool-traces.json') ?? '[]')
const disk = await readFile(input.file, 'utf8')
const buffer = result.response?.buffer
const files = new Map()
for (const name of ['request-input.json', 'ready.json', 'result.json', 'tool-traces.json', 'model-final.txt', 'workbench.txt', 'observer-error.json']) {
    const value = await read(name)
    if (value !== undefined) files.set(name, value)
}
files.set('disk.scad', disk)
const storage = path.join(directory, 'profile/User/workspaceStorage')
const names = await readdir(storage, { recursive: true })
const messages = []
for (const name of names.filter(name => name.replaceAll('\\', '/').includes('/GitHub.copilot-chat/transcripts/') && name.endsWith('.jsonl'))) {
    const lines = (await readFile(path.join(storage, name), 'utf8')).split('\n').filter(Boolean)
    for (const line of lines) {
        const event = JSON.parse(line)
        if (event.type === 'assistant.message') messages.push({ content: event.data?.content, toolRequests: event.data?.toolRequests })
    }
}
files.set('native-assistant-messages.json', JSON.stringify(messages, null, 2))
const metadata = result.response?.result?.metadata
const hasRequestMetadata = Array.isArray(metadata?.toolCallRounds)
let nativeToolRequests = (metadata?.toolCallRounds ?? []).flatMap(round => (round.toolCalls ?? []).map(call => {
    const resultText = (metadata.toolCallResults?.[call.id]?.content ?? []).map(part => part.value ?? '').join('\n')
    return { name: call.name, id: call.id, toolInputRetry: round.toolInputRetry, hostSchemaRejected: resultText.startsWith('ERROR: Your input to the tool was invalid'), hostError: resultText.startsWith('ERROR: Your input to the tool was invalid') ? resultText : undefined }
}))
if (!hasRequestMetadata) {
    const observed = new Map()
    for (const message of messages) for (const call of message.toolRequests ?? []) {
        const id = call.toolCallId ?? call.id
        if (id) observed.set(id, { name: call.name, id, hostSchemaRejected: null })
    }
    nativeToolRequests = [...observed.values()]
}
const customizerCalls = calls.filter(call => call.capability.startsWith('customizer.'))
const facts = {
    scenario: input.scenario,
    nativeAgent: result.nativeAgent,
    selectedModel: result.response?.result?.details,
    requestedModel: input.model,
    modelIdentity: input.modelIdentity,
    inferenceProfile: input.inferenceProfile,
    ollamaEndpoint: input.ollamaEndpoint,
    model: result.ready.models?.filter(model => model.id === input.model),
    artifact: result.artifact ?? input.artifact ?? 'Historical run: VSIX hash not captured; bundled extension hash is in result.ready',
    requestFinished: result.requestFinished,
    timedOut: result.timedOut,
    terminalReason: result.terminalReason,
    interrupted: result.interrupted,
    controllerOutcomeMissing: !resultText,
    sourceDiskUnchanged: disk === input.source,
    sourceBufferObserved: typeof buffer === 'string',
    sourceBufferUnchanged: typeof buffer === 'string' ? buffer === input.source : null,
    actualBusinessToolInvocations: calls.length,
    actualCustomizerToolInvocations: customizerCalls.length,
    nativeToolRequestMetadataAvailable: hasRequestMetadata,
    nativeToolRequestSource: hasRequestMetadata ? 'final-response-metadata' : 'persisted-native-transcript',
    nativeToolRequests,
    nativeHostSchemaRejections: hasRequestMetadata ? nativeToolRequests.filter(call => call.hostSchemaRejected).length : null,
    nativeToolMetadataScope: 'Observed final-response metadata or persisted native transcript requests; not necessarily the complete conversation. Host rejection count is unknown without result metadata. Generated requests are not dispatcher execution or successful edits.',
    calls: calls.map(call => ({ capability: call.capability, mode: call.input?.mode, ok: call.output?.ok, errorCode: call.output?.error?.code, semanticPass: call.output?.data?.semanticPass, complete: call.output?.data?.complete })),
    acceptance: 'REQUIRES REVIEW: these are observations, not a model acceptance PASS',
}
files.set('facts.json', JSON.stringify(facts, null, 2))
await mkdir(destination, { recursive: true })
const manifest = []
for (const [name, original] of files) {
    const sanitized = original.replaceAll(directory, '<fixture>').replaceAll('/Users/q/Documents/Code/scad-ai-ide', '<repo>')
    await writeFile(path.join(destination, name), sanitized)
    manifest.push({ file: name, originalSha256: createHash('sha256').update(original).digest('hex'), redactions: ['isolated fixture prefix', 'repository prefix'] })
}
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(facts, null, 2))
