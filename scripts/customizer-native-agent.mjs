import { DatabaseSync } from 'node:sqlite'
import { spawn, execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, readdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../', import.meta.url))
const executable = process.env.SCAD_VSCODE_EXECUTABLE
assert.ok(executable, 'Set SCAD_VSCODE_EXECUTABLE to a cached or installed VS Code executable')
const host = JSON.parse(await readFile(path.join(root, '.build/ollama-dev/host.json'), 'utf8'))
const directory = await mkdtemp(path.join(tmpdir(), 'customizer-native-agent-'))
const workspace = path.join(directory, 'workspace')
const profile = path.join(directory, 'profile')
const shared = path.join(directory, 'shared')
const ollamaEndpoint = process.env.SCAD_AGENT_OLLAMA_URL ?? 'http://127.0.0.1:11434'
const endpoint = new URL(ollamaEndpoint)
assert.ok(endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' && !endpoint.username && !endpoint.password, 'Native audit endpoints must remain on loopback without URL credentials')
await mkdir(workspace)
await mkdir(path.join(profile, 'User'), { recursive: true })
await writeFile(path.join(profile, 'User', 'chatLanguageModels.json'), JSON.stringify([{ vendor: 'ollama-models', name: 'Local Customizer audit', url: ollamaEndpoint, models: [process.env.SCAD_AGENT_MODEL ?? 'qwen3.5:2b-mlx'] }]))
await writeFile(path.join(profile, 'User', 'settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'scad-ai-ide.languageServer.enabled': false, 'chat.extensionUnification.enabled': false, 'workbench.enableExperiments': false, 'ollama.endpoint': ollamaEndpoint }))
const file = path.join(workspace, 'model.scad')
const scenario = process.env.SCAD_AGENT_SCENARIO ?? 'smoke'
const cases = {
    smoke: { source: 'width=40;\nmodule model() { cube([width,2,3]); }\nmodel();\n', task: '为现有 width 添加 Slider，范围10至100、步长5，放入Dimensions分组，描述为 Width in millimeters。' },
    author: { source: 'width=40;\nshape="round";\ninternalOffset=0.01;\nmodule model() { cube([width,2,3]); }\nmodel();\n', task: '按受控Source工作流：width成为Dimensions分组的Slider(10:5:100)，描述Width in millimeters；shape成为Appearance分组的Dropdown(round:Round,square:Square)；internalOffset隐藏。将相互影响的group修改放在同一批计划中；最后验证这三个明确目标。' },
    tail: { source: 'width=40; // [0:100] IDs in Assembly.md; preserve this explanation\ncube(width);\n', task: '尝试用受控Source工具将width修复为Slider(0:100)。必须保留完整的IDs in Assembly.md; preserve this explanation说明。若工具无法安全修复，解释人工处理，不能删除说明或假称已完成。不要改用其他文件写工具。' },
    expression: { source: 'base=80;\nwidth=base/2; // [10:100]\ncube(width);\n', task: '分析width能否成为Slider(10:100)。它是表达式；不要常量折叠、不要改变源码，也不要把这种合法SCAD说成语法错误。如受控编辑不支持，明确说明原因。' },
    failure: { source: 'width=40;\ncube(width);\n', task: '只读验收，不修改文件：用SourceValidate检查width是否已经是Slider(10:5:100)，并用SourceAnalyze检查同目录不存在的missing.scad。对实际ok=false及semanticPass=false如实报告；不要修复或宣称验证成功。' },
}
assert.ok(cases[scenario], `Unknown native Agent scenario: ${scenario}`)
const source = cases[scenario].source
const candidatePath = path.join(root, '.build/scad-ai-ide-customizer-architecture-v2.vsix')
const candidateBytes = await readFile(candidatePath)
const artifact = { file: path.basename(candidatePath), bytes: candidateBytes.length, sha256: createHash('sha256').update(candidateBytes).digest('hex') }
let modelIdentity
try {
    const response = await fetch(ollamaEndpoint + '/api/tags', { signal: AbortSignal.timeout(5000) })
    assert.ok(response.ok, 'Model identity request failed')
    const tags = await response.json()
    const selected = tags.models?.find(model => (model.name ?? model.model) === (process.env.SCAD_AGENT_MODEL ?? 'qwen3.5:2b-mlx'))
    modelIdentity = selected ? { name: selected.name ?? selected.model, digest: selected.digest, size: selected.size, modifiedAt: selected.modified_at } : { available: false }
} catch (error) { modelIdentity = { available: false, error: error.message } }
await writeFile(file, source)
const query = `/openscad-customizer-authoring 目标文件为 ${pathToFileURL(file).href}。${cases[scenario].task} 保留几何、源码默认值与Preset，不保存文件。使用项目安装的Skill完成分析、适用时的最小编辑和明确目标验证；如实报告实际结果及未执行的GUI/渲染检查。`
await writeFile(path.join(directory, 'request-input.json'), JSON.stringify({ scenario, model: process.env.SCAD_AGENT_MODEL ?? 'qwen3.5:2b-mlx', modelIdentity, file, query, source, artifact, ollamaEndpoint, inferenceProfile: process.env.SCAD_AGENT_INFERENCE_PROFILE ?? 'Official provider directly to the local server; no sampling override in this harness' }, null, 2))
const socket = createServer()
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
let ended = false, hostError
console.log(`Native Agent evidence directory: ${directory}`)
// A normal Production host preserves the built-in native Chat Agent. Test
// mode may exclude it, which cannot establish model-driven acceptance.
const extensions = path.join(directory, 'extensions')
await mkdir(extensions)
const appRoot = process.platform === 'darwin' ? path.resolve(path.dirname(executable), '../Resources/app') : path.resolve(path.dirname(executable), 'resources/app')
execFileSync(executable, [path.join(appRoot, 'out/cli.js'), '--user-data-dir', profile, '--shared-data-dir', shared, '--extensions-dir', extensions, '--install-extension', path.join(root, '.build/scad-ai-ide-customizer-architecture-v2.vsix'), '--force'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' })
const ollamaDirectory = path.join(extensions, `Ollama.ollama-${host.version}`)
await cp(host.ollamaExtension, ollamaDirectory, { recursive: true })
const driver = path.join(extensions, 'local-audit.customizer-audit-observer-0.0.1')
await mkdir(driver)
await writeFile(path.join(driver, 'package.json'), JSON.stringify({ name: 'customizer-audit-observer', publisher: 'local-audit', version: '0.0.1', engines: { vscode: '^1.140.0' }, activationEvents: ['onStartupFinished'], main: 'index.cjs' }))
await cp(path.join(root, 'scripts/fixtures/customizer-native-agent.cjs'), path.join(driver, 'observer.cjs'))
await writeFile(path.join(driver, 'index.cjs'), `exports.activate=()=>{require('./observer.cjs').run().catch(error=>require('node:fs').writeFileSync(${JSON.stringify(path.join(directory, 'observer-error.json'))},JSON.stringify({error:String(error),stack:error.stack})));return {}}`)
// Register the two staged directories in this isolated installation index. A
// copied folder alone is not an installed extension in recent VS Code builds.
const indexPath = path.join(extensions, 'extensions.json')
const installed = JSON.parse(await readFile(indexPath, 'utf8'))
for (const location of [ollamaDirectory, driver]) {
    const manifest = JSON.parse(await readFile(path.join(location, 'package.json'), 'utf8'))
    installed.push({ identifier: { id: `${manifest.publisher}.${manifest.name}` }, version: manifest.version, location: { $mid: 1, scheme: 'file', path: location }, relativeLocation: path.basename(location), metadata: { installedTimestamp: Date.now() } })
}
await writeFile(indexPath, JSON.stringify(installed))
// Configure the fresh fixture with its already bundled Chat extension enabled.
// This is an extension-enablement migration flag only: no account, entitlement,
// setup-completed, authentication or authorization value is created or changed.
// Recent VS Code otherwise disables this built-in during first-launch migration
// before a third-party model provider has been configured interactively.
const storageDirectory = path.join(profile, 'User/globalStorage')
await mkdir(storageDirectory, { recursive: true })
const storage = new DatabaseSync(path.join(storageDirectory, 'state.vscdb'))
try {
    storage.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)')
    storage.prepare('INSERT OR REPLACE INTO ItemTable (key,value) VALUES (?,?)').run('builtinChatExtensionEnablementMigration', 'true')
} finally { storage.close() }


const child = spawn(executable, [workspace, `--user-data-dir=${profile}`, `--shared-data-dir=${shared}`, `--extensions-dir=${extensions}`, `--remote-debugging-port=${port}`, '--disable-updates', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'], {
    env: { ...process.env, SCAD_NATIVE_AGENT_DIRECTORY: directory }, stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.pipe(process.stdout)
child.stderr.pipe(process.stderr)
const running = new Promise(resolve => {
    child.once('error', error => { hostError = String(error); ended = true; resolve() })
    child.once('exit', (code, signal) => { if (code && !hostError) hostError = `Native host exited ${code}/${signal}`; ended = true; resolve() })
})

const read = async name => { try { return await readFile(path.join(directory, name), 'utf8') } catch { return undefined } }
const latestToolRequest = async () => {
    const names = await readdir(path.join(profile, 'User/workspaceStorage'), { recursive: true }).catch(() => [])
    let request
    for (const name of names.filter(name => name.replaceAll('\\', '/').includes('/GitHub.copilot-chat/transcripts/') && name.endsWith('.jsonl'))) {
        const events = (await readFile(path.join(profile, 'User/workspaceStorage', name), 'utf8')).split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
        const requests = events.findLast(event => event.type === 'assistant.message')?.data?.toolRequests
        if (requests?.length === 1) request = requests[0]
    }
    return request
}
const readOnlyTerminalCommand = command => new Set([
    `ls -la ${workspace}`, `ls -la ${workspace}/`, `ls -la "${workspace}"`, `ls -la '${workspace}'`,
    'ls -la', 'pwd', 'pwd; ls -la', 'pwd && ls -la',
    `cat ${file}`, `cat "${file}"`, `cat '${file}'`, 'cat model.scad', 'cat "model.scad"',
]).has(command)
let browser
const approvals = []
const timeoutMs = Number(process.env.SCAD_AGENT_TIMEOUT_MS ?? 360000)
assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 30000 && timeoutMs <= 900000, 'Native Agent observation deadline must be 30–900 seconds')
let continuedAfterConfirmation = false
let finalCandidateAt = 0
let requestFinished = false
let terminalReason
try {
    const deadline = Date.now() + timeoutMs
    while (!(await read('ready.json')) && !ended && Date.now() < deadline) {
        const observerError = await read('observer-error.json')
        if (observerError) throw new Error(observerError)
        await new Promise(resolve => setTimeout(resolve, 200))
    }
    const ready = JSON.parse(await read('ready.json') ?? '{}')
    console.log(JSON.stringify(ready))
    assert.ok(ready.models?.length, 'Native provider exposed no models; inference was not executed')
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const page = browser.contexts().flatMap(context => context.pages()).find(page => /workbench/.test(page.url()))
    assert.ok(page, 'No native workbench page')
    await writeFile(path.join(directory, 'request.json'), JSON.stringify({ inspect: process.env.SCAD_AGENT_INSPECT_NATIVE === '1', file, query, model: process.env.SCAD_AGENT_MODEL ?? 'qwen3.5:2b-mlx' }))
    while (!ended && Date.now() < deadline) {
        const body = await page.locator('body').innerText()
        await writeFile(path.join(directory, 'workbench.txt'), body)
        const response = await read('response.json')
        if (response) {
            const observed = JSON.parse(response)
            if (observed.result?.type === 'confirmation' && process.env.SCAD_AGENT_APPROVE_FIXTURE_WRITES === '1') {
                if (approvals.length >= 8) { terminalReason = 'confirmationBudgetExhausted'; break }
                const toolId = observed.result.toolId
                let allowed = toolId === 'scad_ai_ide_customizer_sourceApply' && !['expression', 'failure'].includes(scenario)
                let argumentsObserved
                if (toolId === 'run_in_terminal') {
                    const request = await latestToolRequest()
                    if (request?.name === toolId) {
                        try { argumentsObserved = typeof request.arguments === 'string' ? JSON.parse(request.arguments) : request.arguments } catch { /* Unknown input stays denied. */ }
                    }
                    allowed = readOnlyTerminalCommand(argumentsObserved?.command)
                }
                const action = allowed
                    ? page.getByText(toolId === 'scad_ai_ide_customizer_sourceApply' ? 'Allow in this Session' : 'Allow', { exact: true }).filter({ visible: true })
                    : page.getByText('Skip', { exact: true }).filter({ visible: true })
                await action.first().waitFor({ state: 'visible', timeout: 5000 })
                assert.equal(await action.count(), 1, 'Expected a single scoped confirmation action')
                approvals.push({ tool: toolId, decision: allowed ? 'allow' : 'skip', scope: allowed ? 'Controlled Source Apply or exact read-only fixture directory listing' : 'Unrecognized action was not approved', argumentsObserved, displayedInput: body.slice(body.lastIndexOf('Input')) })
                await rm(path.join(directory, 'response.json'))
                await action.click()
                continuedAfterConfirmation = true
            } else { console.log(response); requestFinished = !observed.snapshot; terminalReason = observed.result?.errorDetails ? 'nativeRequestError' : 'nativeRequestReturned'; break }
        }
        // Native Chat can surface a second, non-tool permission prompt after
        // blockOnResponse has already returned its first confirmation. Never
        // authorize a fallback file writer; record and decline this exact UI.
        if (!response && body.includes('Allow edits to sensitive files?')) {
            if (approvals.length >= 8) { terminalReason = 'confirmationBudgetExhausted'; break }
            const action = page.getByText('Skip', { exact: true }).filter({ visible: true })
            await action.first().waitFor({ state: 'visible', timeout: 5000 })
            assert.equal(await action.count(), 1, 'Expected a single scoped sensitive-file denial')
            approvals.push({ tool: 'nativeSensitiveFileEdit', decision: 'skip', scope: 'Fallback file writers are outside this controlled Source workflow', displayedInput: body.slice(body.indexOf('Allow edits to sensitive files?')) })
            await action.click()
            continuedAfterConfirmation = true
        } else if (!response && continuedAfterConfirmation) {
            const action = page.getByText('Skip', { exact: true }).filter({ visible: true })
            if (await action.count() === 1) {
                if (approvals.length >= 8) { terminalReason = 'confirmationBudgetExhausted'; break }
                const request = await latestToolRequest()
                let argumentsObserved
                try { argumentsObserved = typeof request?.arguments === 'string' ? JSON.parse(request.arguments) : request?.arguments } catch { /* Unknown input stays denied. */ }
                const sourceAllowed = request?.name === 'scad_ai_ide_customizer_sourceApply' && !['expression', 'failure'].includes(scenario)
                const readAllowed = request?.name === 'run_in_terminal' && readOnlyTerminalCommand(argumentsObserved?.command)
                const allowed = sourceAllowed || readAllowed
                approvals.push({ tool: request?.name ?? 'subsequentNativeConfirmation', decision: allowed ? 'allow' : 'skip', scope: allowed ? 'Actual native transcript identifies controlled Source Apply or an exact fixture read command' : 'Unrecognized action was not approved', argumentsObserved, displayedInput: body.slice(-16000) })
                if (allowed) await page.getByText(sourceAllowed ? 'Allow in this Session' : 'Allow', { exact: true }).filter({ visible: true }).click()
                else await action.click()
            }
        }
        if (continuedAfterConfirmation && body.includes('Sorry, no response was returned.')) {
            requestFinished = true
            terminalReason = 'nativeUIError'
            break
        }
        // Transcript files may flush only after shutdown. The native footer
        // exposes completion independently of the first command callback.
        const completedFooter = continuedAfterConfirmation
            ? await page.locator('.chat-footer-details[aria-label^="Completed "]').filter({ visible: true }).count()
            : 0
        if (completedFooter === 1) {
            finalCandidateAt ||= Date.now()
            if (Date.now() - finalCandidateAt > 3000) {
                requestFinished = true
                terminalReason = 'nativeUICompleted'
                await writeFile(path.join(directory, 'request.json'), JSON.stringify({ snapshot: true, file }))
                for (let tries = 0; tries < 50 && !(await read('response.json')); tries++) await new Promise(resolve => setTimeout(resolve, 100))
                break
            }
        }
        if (continuedAfterConfirmation) {
            const names = await readdir(path.join(profile, 'User/workspaceStorage'), { recursive: true }).catch(() => [])
            const transcripts = names.filter(name => name.replaceAll('\\', '/').includes('/GitHub.copilot-chat/transcripts/') && name.endsWith('.jsonl'))
            let finalText
            for (const name of transcripts) {
                const lines = (await readFile(path.join(profile, 'User/workspaceStorage', name), 'utf8')).split('\n').filter(Boolean)
                const events = lines.flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
                const lastMessage = events.findLast(event => event.type === 'assistant.message')
                if (lastMessage?.data?.content && !lastMessage.data.toolRequests?.length) finalText = lastMessage.data.content
            }
            if (finalText) {
                finalCandidateAt ||= Date.now()
                if (Date.now() - finalCandidateAt > 3000) {
                    requestFinished = true
                    terminalReason = 'nativeTranscriptFinalMessage'
                    await writeFile(path.join(directory, 'model-final.txt'), finalText)
                    await writeFile(path.join(directory, 'request.json'), JSON.stringify({ snapshot: true, file }))
                    for (let tries = 0; tries < 50 && !(await read('response.json')); tries++) await new Promise(resolve => setTimeout(resolve, 100))
                    break
                }
            } else if (!completedFooter) finalCandidateAt = 0
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (!(await read('response.json'))) {
        await writeFile(path.join(directory, 'request.json'), JSON.stringify({ snapshot: true, file, cancel: !requestFinished, stopReason: terminalReason ?? 'observationDeadline' }))
        for (let tries = 0; tries < 50 && !(await read('response.json')); tries++) await new Promise(resolve => setTimeout(resolve, 100))
    }
    await page.screenshot({ path: path.join(directory, 'workbench.png') })
    const response = await read('response.json')
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ scenario, artifact, timeoutMs, ready, response: response ? JSON.parse(response) : undefined, timedOut: !requestFinished && !terminalReason, interrupted: !requestFinished && !!terminalReason, requestFinished, terminalReason, hostError, nativeAgent: true, confirmationsAutomaticallyApproved: approvals.some(item => item.decision === 'allow'), approvals }, null, 2))
    // A trace is evidence, never a blanket PASS. A separate acceptance evaluator
    // must inspect tool choices, confirmation, post-validation and actual buffer.
    assert.ok(requestFinished, terminalReason ?? 'Native Agent did not return before the observation deadline')
} catch (error) {
    if (!(await read('result.json'))) {
        await writeFile(path.join(directory, 'result.json'), JSON.stringify({ scenario, artifact, timeoutMs, ready: JSON.parse(await read('ready.json') ?? '{}'), requestFinished, terminalReason: 'observationControllerError', nativeAgent: true, error: String(error), approvals }, null, 2))
    }
    throw error
} finally {
    await writeFile(path.join(directory, 'finish'), 'finish')
    if (!ended) child.kill('SIGTERM')
    const shutdown = setTimeout(() => { if (!ended) child.kill('SIGKILL') }, 5000)
    await running
    clearTimeout(shutdown)
    // Do not browser.close(): it can terminate unrelated Electron contexts.
}
console.log(`Native Agent observation recorded (not acceptance): ${directory}`)
