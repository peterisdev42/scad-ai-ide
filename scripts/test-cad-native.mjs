import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile, open, cp, readdir, rm, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

// This is the existing F5 development profile: credentials remain in the provider's SecretStorage.
// No token extraction, account migration, model response fabrication, or protected SourceApply approval.
const repo = fileURLToPath(new URL('../', import.meta.url))
const executable = process.env.SCAD_VSCODE_EXECUTABLE ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code'
const staged = JSON.parse(await readFile(join(repo, '.build/omlx-dev/host.json'), 'utf8'))
const directory = await mkdtemp(join(tmpdir(), 'cad-native-f5-'))
const workspace = join(directory, 'workspace'),
    observer = join(directory, 'observer'),
    file = join(workspace, 'model.scad')
await mkdir(join(workspace, '.vscode'), { recursive: true })
await mkdir(observer)
const source = 'width=0;\nassert(width>0,"width must be positive");\ncube(width);\n'
await writeFile(file, source)
const ideExtension = join(directory, 'scad-ai-ide'), providerExtension = join(directory, 'omlx-provider')
await mkdir(ideExtension)
for (const name of ['package.json', 'dist', 'resources', 'skills', 'instructions', 'syntaxes', 'snippets', 'media', 'server', 'licenses']) {
    await cp(join(repo, name), join(ideExtension, name), { recursive: true })
}
await cp(staged.omlxExtension, providerExtension, { recursive: true })

const exposure = []
const relay = createServer(async (request, response) => {
    if (!['/v1/models', '/v1/chat/completions'].includes(request.url)) {
        response.writeHead(404).end()
        return
    }
    try {
        const chunks = []
        let size = 0
        for await (const chunk of request) {
            size += chunk.length
            assert.ok(size < 8 * 1048576)
            chunks.push(chunk)
        }
        const bytes = Buffer.concat(chunks),
            body = bytes.length ? JSON.parse(bytes) : undefined
        const record = { at: new Date().toISOString(), path: request.url, model: body?.model, tools: body?.tools?.map((t) => ({ name: t.function.name, schemaSha256: createHash('sha256').update(JSON.stringify(t.function.parameters)).digest('hex') })) }
        exposure.push(record)
        await writeFile(join(directory, 'tool-exposure.json'), JSON.stringify({ scope: 'Transparent loopback forwarding; no credentials, prompts or payload changes recorded', requests: exposure }, null, 2))
        const incoming = await fetch(`http://127.0.0.1:8000${request.url}`, { method: request.method, headers: { 'content-type': 'application/json', ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) }, ...(bytes.length ? { body: bytes } : {}), signal: AbortSignal.timeout(Number(process.env.SCAD_AGENT_TIMEOUT_MS ?? 600000)) })
        record.status = incoming.status
        response.writeHead(incoming.status, { 'content-type': incoming.headers.get('content-type') ?? 'application/json' })
        if (incoming.body) for await (const chunk of incoming.body) response.write(Buffer.from(chunk))
        response.end()
        await writeFile(join(directory, 'tool-exposure.json'), JSON.stringify({ scope: 'Transparent loopback forwarding; no credentials or payload changes recorded', requests: exposure }, null, 2))
    } catch {
        if (!response.headersSent) response.writeHead(502)
        response.end()
    }
})
await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve))
await writeFile(join(workspace, '.vscode/settings.json'), JSON.stringify({ 'chat.saveBeforeSend': false, 'files.autoSave': 'off', 'scad-ai-ide.languageServer.enabled': false, 'omlx.baseUrl': `http://127.0.0.1:${relay.address().port}/v1`, 'omlx.requestTimeoutMs': Number(process.env.SCAD_AGENT_TIMEOUT_MS ?? 600000) }))
await cp(join(repo, 'scripts/fixtures/cad-native-agent.cjs'), join(observer, 'observer.cjs'))
await writeFile(join(directory, 'native-config.json'), JSON.stringify({ file, ideExtension }))
await writeFile(join(observer, 'package.json'), JSON.stringify({ publisher: 'local-test', name: 'cad-native-observer', version: '0.0.1', engines: { vscode: '^1.140.0' }, main: './index.cjs', activationEvents: ['onStartupFinished'] }))
await writeFile(join(observer, 'index.cjs'), `exports.activate=context=>{require('./observer.cjs').run(context).catch(e=>require('node:fs').writeFileSync(${JSON.stringify(join(directory, 'observer-error.json'))},JSON.stringify({error:String(e),stack:e.stack})));return {}}`)
const query = `请使用扩展提供的 openscad-model-debugging Skill。目标 ${pathToFileURL(file).href}。修复这个模型的断言错误：先调用 scad_ai_ide_model_analyze（只填uri和mode，不填可选projectRoot）读取Problems，再只用原生 replace_string_in_file 将width=0;替换成width=1;，保留assert本身和cube(width)，不要删除或降低约束，不保存文件。修改后必须再次调用同一分析工具，明确报告新的reportId和snapshotId、CSG诊断状态以及未检查的网格/装配/可打印性。禁止使用终端、SourceApply、安装或管理工具。复验通过后用不超过80字简要回复（另列reportId和snapshotId），立即结束，不要继续探索。`
await writeFile(join(directory, 'request-input.json'), JSON.stringify({ source, query, workspace, executable, profile: 'Existing F5 development profile; provider SecretStorage unchanged', autoSave: 'off', saveBeforeSend: false }, null, 2))
console.log(`F5 CAD Native evidence: ${directory}`)
const appRoot = process.platform === 'darwin' ? resolve(dirname(executable), '../Resources/app') : resolve(dirname(executable), 'resources/app')
const nativeLog = await open(join(directory, 'host.log'), 'w', 0o600)
const child = spawn(executable, [join(appRoot, 'out/cli.js'), workspace, `--extensionDevelopmentPath=${ideExtension}`, `--extensionDevelopmentPath=${providerExtension}`, `--extensionDevelopmentPath=${observer}`, '--disable-extensions', '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', nativeLog.fd, nativeLog.fd] })
await nativeLog.close()
child.once('error', (error) => {
    void writeFile(join(directory, 'startup-error.json'), JSON.stringify({ error: String(error) }))
})
child.once('exit', (code, signal) => {
    void writeFile(join(directory, 'startup-exit.json'), JSON.stringify({ code, signal }))
})
const read = async (name) => {
    try {
        return await readFile(join(directory, name), 'utf8')
    } catch {
        return undefined
    }
}
const nativeMessages = async () => {
    const storage = JSON.parse(await read('observer-storage.json') ?? '{}').storageUri
    if (!storage) return []
    const base = join(dirname(storage), 'GitHub.copilot-chat/transcripts')
    const files = await readdir(base, { recursive: true }).catch(() => [])
    const candidates = []
    for (const name of files.filter(f => f.endsWith('.jsonl'))) {
        const events = (await readFile(join(base, name), 'utf8')).split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
        const messages = events.filter(e => e.type === 'assistant.message')
        if (messages.some(m => m.data?.toolRequests?.some(t => t.name === 'scad_ai_ide_model_analyze'))) candidates.push(messages)
    }
    return candidates.at(-1) ?? []
}
const approvals = []
const deadline = Date.now() + Number(process.env.SCAD_AGENT_TIMEOUT_MS ?? 240000)
let result
try {
    let ready
    const startupDeadline = Math.min(deadline, Date.now() + 60000)
    while (Date.now() < startupDeadline) {
        const error = await read('observer-error.json')
        if (error) throw new Error(error)
        const text = await read('ready.json')
        if (text) {
            ready = JSON.parse(text)
            break
        }
        await new Promise((r) => setTimeout(r, 250))
    }
    assert.ok(ready?.models?.length, 'HARNESS_UNAVAILABLE: existing F5 oMLX provider exposed no models; inspect tool-exposure.json for authentication state')
    console.log(JSON.stringify({ vscode: ready.vscode, provider: ready.provider, models: ready.models.map((m) => m.id) }))
    const model = process.env.SCAD_AGENT_MODEL ?? ready.models.find((m) => m.id === 'Qwen3.6-35B-A3B-OptiQ-4bit')?.id ?? ready.models.find((m) => m.toolCalling)?.id
    assert.ok(model, 'HARNESS_UNAVAILABLE: no model with tool calling')
    await writeFile(join(directory, 'request.json'), JSON.stringify({ file, query, model, toolsInclude: ['scad_ai_ide_model_analyze', 'scad_ai_ide_model_getIssue', 'copilot_readFile', 'copilot_replaceString', 'copilot_editFiles'] }))
    let response, finalText
    while (Date.now() < deadline) {
        const text = await read('response.json')
        if (text) {
            const observed = JSON.parse(text)
            if (observed.result?.type === 'confirmation') {
                await writeFile(join(directory, 'pending-confirmation.json'), JSON.stringify(observed, null, 2))
                const messages = await nativeMessages()
                const tool = messages.flatMap(m => m.data?.toolRequests ?? []).findLast(t => t.name === 'replace_string_in_file')
                const args = tool ? typeof tool.arguments === 'string' ? JSON.parse(tool.arguments) : tool.arguments : undefined
                assert.equal(observed.result.toolId, 'copilot_replaceString', 'HUMAN_REVIEW_REQUIRED: another tool needs independent review')
                assert.ok(args && await realpath(args.filePath) === await realpath(file) && typeof args.oldString === 'string' && typeof args.newString === 'string' && observed.buffer.split(args.oldString).length === 2 && observed.buffer.replace(args.oldString, args.newString) === observed.buffer.replace('width=0;', 'width=1;'), 'HUMAN_REVIEW_REQUIRED: proposed edit is outside the reviewed fixture change')
                assert.equal(process.env.SCAD_NATIVE_FIXTURE_EDIT_APPROVED, 'width-0-to-1', 'HUMAN_REVIEW_REQUIRED: explicit user authorization is required; no approval was synthesized')
                assert.equal(approvals.length, 0, 'HUMAN_REVIEW_REQUIRED: only one reviewed edit is authorized')
                const approval = { reviewedApproval: true, file, toolId: observed.result.toolId, oldString: args.oldString, newString: args.newString, expectedBufferSha256: createHash('sha256').update(observed.buffer).digest('hex'), authorization: 'user-approved-width-0-to-1-20261112' }
                approvals.push(approval)
                await writeFile(join(directory, 'approvals.json'), JSON.stringify(approvals, null, 2))
                await rm(join(directory, 'response.json'))
                await writeFile(join(directory, 'request.json'), JSON.stringify(approval))
            } else { response = observed; break }
        }
        const traces = JSON.parse(await read('tool-traces.json') ?? '[]')
        const analyses = traces.filter(t => t.capability === 'cad.modelAnalyze' && t.output?.ok).map(t => t.output.data)
        if (approvals.length && analyses.at(-1)?.overallStatus === 'PASS') {
            const last = (await nativeMessages()).at(-1)
            if (last?.data?.content && !last.data.toolRequests?.length) {
                finalText = last.data.content
                await writeFile(join(directory, 'model-final.txt'), typeof finalText === 'string' ? finalText : JSON.stringify(finalText))
                await writeFile(join(directory, 'request.json'), JSON.stringify({ snapshot: true, file }))
                for (let tries = 0; tries < 50 && !await read('response.json'); tries++) await new Promise(r => setTimeout(r, 100))
            }
        }
        await new Promise(r => setTimeout(r, 500))
    }
    const traces = JSON.parse((await read('tool-traces.json')) ?? '[]')
    const analyses = traces.filter((t) => t.capability === 'cad.modelAnalyze' && t.output?.ok).map((t) => t.output.data)
    const before = await read('buffer-before.scad')
    result = { scope: 'Real native VS Code Agent, F5 development extensions, local oMLX; not installed VSIX acceptance', ready, response, model, approvals, finalText, analyses: analyses.map((a) => ({ reportId: a.reportId, snapshotId: a.snapshotId, status: a.overallStatus })), pass: false }
    assert.ok(response && !response.error && !response.result?.errorDetails, 'HARNESS_UNAVAILABLE: Native request did not complete successfully')
    assert.notEqual(response.result?.type, 'confirmation', 'HUMAN_REVIEW_REQUIRED: Native host requested confirmation; no approval was synthesized')
    assert.ok(analyses.length >= 2 && analyses[0].overallStatus === 'FAIL' && analyses.at(-1).overallStatus === 'PASS', 'ASSERTION_FAILED: expected real diagnose / edit / reanalyze calls')
    assert.notEqual(analyses[0].snapshotId, analyses.at(-1).snapshotId)
    assert.ok(!response.problems.some(p => p.code === 'SCAD_CLI_ASSERT_FAILED'), 'ASSERTION_FAILED: repaired Problems must be withdrawn')
    assert.ok(response.dirty && response.disk === source, 'ASSERTION_FAILED: disk must remain unchanged and buffer dirty')
    assert.ok(/width\s*=\s*1\s*;/.test(response.buffer))
    assert.ok(response.buffer.includes('assert(width>0,"width must be positive");') && response.buffer.includes('cube(width);'), 'ASSERTION_FAILED: acceptance constraints must remain intact')
    assert.equal(analyses.at(-1).document.sourceSha256, createHash('sha256').update(response.buffer).digest('hex'))
    assert.notEqual(createHash('sha256').update(before).digest('hex'), createHash('sha256').update(source).digest('hex'), 'Dirty-buffer setup must differ from disk')
    assert.ok(
        exposure.some((r) => r.tools?.some((t) => t.name === 'scad_ai_ide_model_analyze')),
        'ASSERTION_FAILED: provider did not actually receive CAD tool schema',
    )
    result.pass = true
    console.log('Native CAD diagnose/edit/reanalyze evidence PASS')
} catch (error) {
    result = { ...result, pass: false, error: String(error) }
    process.exitCode = 1
    console.log(String(error))
} finally {
    // Preserve observed dirty/disk/Problems evidence even when the model never ends its turn.
    // A timeout snapshot never promotes the failed terminal result to PASS.
    if (!result?.response) {
        await writeFile(join(directory, 'request.json'), JSON.stringify({ snapshot: true, file }))
        for (let i = 0; i < 30 && !await read('response.json'); i++) await new Promise(r => setTimeout(r, 100))
        const observed = await read('response.json')
        if (observed) result = { ...result, observedOnExit: JSON.parse(observed) }
    }
    await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2))
    await writeFile(join(directory, 'finish'), 'finish')
    relay.closeAllConnections()
    relay.close()
    // The observer closes only its fixture window; never kill the shared VS Code application.
    child.unref()
    console.log(`F5 CAD Native report: ${join(directory, 'result.json')}`)
}
