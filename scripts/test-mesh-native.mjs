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
const directory = await mkdtemp(join(tmpdir(), 'mesh-native-f5-'))
const workspace = join(directory, 'workspace'),
    observer = join(directory, 'observer'),
    file = join(workspace, 'model.stl')
await mkdir(join(workspace, '.vscode'), { recursive: true })
await mkdir(observer)
const source = await readFile(join(repo, 'src/test/mesh/golden/inward-ascii.stl'), 'utf8')
await writeFile(file, source)
const ideExtension = join(directory, 'scad-ai-ide'),
    providerExtension = join(directory, 'omlx-provider')
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
        const incoming = await fetch(`http://127.0.0.1:8000${request.url}`, { method: request.method, headers: { 'content-type': 'application/json', ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) }, ...(bytes.length ? { body: bytes } : {}), signal: AbortSignal.timeout(Number(process.env.SCAD_AGENT_TIMEOUT_MS ?? 240000)) })
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
await writeFile(join(workspace, '.vscode/settings.json'), JSON.stringify({ 'chat.saveBeforeSend': false, 'files.autoSave': 'off', 'scad-ai-ide.languageServer.enabled': false, 'omlx.baseUrl': `http://127.0.0.1:${relay.address().port}/v1`, 'omlx.requestTimeoutMs': Number(process.env.SCAD_AGENT_TIMEOUT_MS ?? 240000) }))
await cp(join(repo, 'scripts/fixtures/cad-native-agent.cjs'), join(observer, 'observer.cjs'))
await writeFile(join(directory, 'native-config.json'), JSON.stringify({ file, ideExtension, dirtySetup: false, skill: 'skills/openscad-geometry-verification/SKILL.md' }))
await writeFile(join(observer, 'package.json'), JSON.stringify({ publisher: 'local-test', name: 'cad-native-observer', version: '0.0.1', engines: { vscode: '^1.140.0' }, main: './index.cjs', activationEvents: ['onStartupFinished'] }))
await writeFile(join(observer, 'index.cjs'), `exports.activate=context=>{require('./observer.cjs').run(context).catch(e=>require('node:fs').writeFileSync(${JSON.stringify(join(directory, 'observer-error.json'))},JSON.stringify({error:String(e),stack:e.stack})));return {}}`)
const query = `使用附带的 openscad-geometry-verification Skill。仅检查 ${pathToFileURL(file).href}，不要修改或保存文件，不要使用终端或管理工具。依次完成：1 调用 scad_ai_ide_model_analyze，uri用上述文件，mode=verify；2 用该reportId调用 scad_ai_ide_model_measure，读取signedVolume和physicalVolume；3 用同一reportId及分析返回的问题ID调用 scad_ai_ide_model_getIssue，includeEvidence=true；4 用该reportId调用 scad_ai_ide_model_renderViews，cameras=["iso"],delivery="metadata"。最后用不超过150字总结负signed volume与可信physical volume的区别、units、未决项和图片状态，列出reportId和snapshotId后立即结束。禁止自动修复。`
const deadline = Date.now() + 240000
await writeFile(join(directory, 'request-input.json'), JSON.stringify({ query, file, sourceSha256: createHash('sha256').update(source).digest('hex'), scope: 'One real Native Agent attempt; 240 seconds total; no edits', saveBeforeSend: false, autoSave: 'off' }, null, 2))
console.log(`Phase 2 Native evidence: ${directory}`)
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
let result
try {
    let ready
    while (Date.now() < deadline) {
        const error = await read('observer-error.json')
        if (error) throw new Error(error)
        const value = await read('ready.json')
        if (value) {
            ready = JSON.parse(value)
            break
        }
        await new Promise((r) => setTimeout(r, 250))
    }
    assert.ok(ready?.models?.length, 'ENV_UNAVAILABLE: F5 oMLX exposed no models')
    const model = ready.models.find((m) => m.id === 'Qwen3.6-35B-A3B-OptiQ-4bit')?.id ?? ready.models[0].id
    const names = ['scad_ai_ide_model_analyze', 'scad_ai_ide_model_measure', 'scad_ai_ide_model_getIssue', 'scad_ai_ide_model_renderViews']
    await writeFile(join(directory, 'request.json'), JSON.stringify({ file, query, model, toolsInclude: names }))
    let response
    while (Date.now() < deadline) {
        const value = await read('response.json')
        if (value) {
            response = JSON.parse(value)
            break
        }
        await new Promise((r) => setTimeout(r, 500))
    }
    const traces = JSON.parse((await read('tool-traces.json')) ?? '[]'),
        find = (id) => traces.find((t) => t.capability === id && t.output?.ok)?.output.data
    const analysis = find('cad.modelAnalyze'),
        measure = find('cad.modelMeasure'),
        issue = find('cad.issueDetails'),
        views = find('cad.modelRenderViews')
    result = { scope: 'Real VS Code Native Agent, existing F5 oMLX provider; single 240s attempt; development bundle, not installed model E2E', ready, model, response, analysis, measure, issue, views, pass: false }
    assert.ok(response && !response.error && !response.result?.errorDetails, 'AGENT_UNCLOSED: no successful completion within 240s')
    assert.notEqual(response.result?.type, 'confirmation', 'AGENT_UNCLOSED: unexpected confirmation, no synthesized approval')
    assert.equal(analysis?.schemaVersion, 2)
    assert.equal(analysis?.overallStatus, 'FAIL')
    assert.equal(measure?.values.signedVolume.value, -1)
    assert.equal(measure?.values.physicalVolume.value, null)
    assert.equal(issue?.current, true)
    assert.ok(issue.issue.code.includes('WINDING'))
    assert.equal(views?.renderStatus, 'AVAILABLE')
    assert.equal(views?.frames.length, 1)
    for (const data of [measure, issue, views]) {
        assert.equal(data.reportId, analysis.reportId)
        assert.equal(data.snapshotId, analysis.snapshotId)
    }
    assert.equal(response.disk, source)
    assert.equal(response.dirty, false)
    assert.ok(
        names.every((name) => exposure.some((r) => r.tools?.some((t) => t.name === name))),
        'Provider must receive every actual CAD tool schema',
    )
    result.pass = true
} catch (error) {
    result = { ...result, pass: false, error: String(error), stack: error.stack }
    process.exitCode = 1
} finally {
    await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2))
    await writeFile(join(directory, 'finish'), 'done')
    relay.closeAllConnections()
    await new Promise((resolve) => relay.close(resolve))
    console.log(JSON.stringify({ pass: result?.pass, error: result?.error, evidence: directory, attempts: 1 }))
}
