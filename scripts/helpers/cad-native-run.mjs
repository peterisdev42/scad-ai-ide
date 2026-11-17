import { createServer } from 'node:http'
import { readFile, writeFile, rename, mkdir, readdir, open } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join, dirname, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import policy from './cad-native-policy.cjs'
export const { PRIMARY, BACKUP, sha256, selectModel, validateEdit } = policy
export const atomicJson = async (path, value) => {
    const temp = path + '.' + randomUUID() + '.tmp'
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 })
    await rename(temp, path)
}
const json = async (path) => JSON.parse(await readFile(path, 'utf8'))
export async function fingerprint(repo) {
    const files = []
    for (const folder of ['src', 'scripts', 'resources', 'skills', 'instructions', 'syntaxes', 'snippets', 'media', 'dist']) {
        for (const file of await readdir(join(repo, folder), { recursive: true })) {
            try {
                files.push([join(folder, file), sha256(await readFile(join(repo, folder, file)))])
            } catch (error) {
                if (error.code !== 'EISDIR') throw error
            }
        }
    }
    for (const file of ['package.json', 'package-lock.json', 'esbuild.js', '.vscode-test.mjs']) files.push([file, sha256(await readFile(join(repo, file)))])
    files.sort(([a], [b]) => a.localeCompare(b))
    return { id: sha256(JSON.stringify(files)), files: Object.fromEntries(files), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), branch: execFileSync('git', ['branch', '--show-current'], { cwd: repo, encoding: 'utf8' }).trim() }
}
// Collect SSE tool deltas only. Never persist authorization headers, prompts, reasoning, or arbitrary response bodies.
export class ToolStream {
    buffer = ''
    calls = new Map()
    finishReasons = []
    done = false
    malformed = false
    append(text) {
        this.buffer += text
        if (this.buffer.length > 8 * 1048576) throw new Error('HARNESS_BUDGET: SSE line exceeded 8 MiB')
        let end
        while ((end = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, end).trimEnd()
            this.buffer = this.buffer.slice(end + 1)
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (data === '[DONE]') {
                this.done = true
                continue
            }
            try {
                for (const choice of JSON.parse(data).choices ?? []) {
                    if (choice.finish_reason) this.finishReasons.push(choice.finish_reason)
                    for (const delta of choice.delta?.tool_calls ?? []) {
                        const key = `${choice.index ?? 0}:${delta.index ?? 0}`
                        const call = this.calls.get(key) ?? { id: '', name: '', arguments: '' }
                        call.id += delta.id ?? ''
                        call.name += delta.function?.name ?? ''
                        call.arguments += delta.function?.arguments ?? ''
                        this.calls.set(key, call)
                    }
                }
            } catch {
                this.malformed = true
            }
        }
    }
}
export async function createNativeRun({ repo, directory, scenario }) {
    const runId = randomUUID(),
        marker = `CAD_ACCEPTANCE_RUN=${runId}`
    const timeoutMs = Number(process.env.SCAD_AGENT_TIMEOUT_MS ?? 600000)
    assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 600000, 'Automatic case budget must be at most 600 seconds')
    const candidate = await fingerprint(repo)
    const baselinePath = process.env.SCAD_NATIVE_BASELINE
    assert.ok(baselinePath, 'HARNESS_UNAVAILABLE: SCAD_NATIVE_BASELINE must name a frozen deterministic baseline JSON')
    const baseline = await json(baselinePath)
    assert.equal(baseline.candidateId, candidate.id, 'CANDIDATE_CHANGED: repeat deterministic baseline for the changed code')
    assert.equal(baseline.status, 'PASS', 'BASELINE_FAILED: real Agent cannot diagnose an unproven deterministic layer')
    const model = process.env.SCAD_AGENT_MODEL ?? PRIMARY
    selectModel([{ id: PRIMARY }, { id: BACKUP }], model)
    if (model === BACKUP) {
        assert.ok(process.env.SCAD_NATIVE_BACKUP_OF, 'Backup requires evidence from one primary run')
        const primary = await json(process.env.SCAD_NATIVE_BACKUP_OF)
        assert.ok(policy.backupEligible(primary, baseline, candidate.id, scenario), 'BACKUP_INELIGIBLE: same scenario/candidate and supported model-specific failure required')
    }
    const evidenceRoot = join(repo, 'docs/cad/evidence/closeout')
    const attemptRoot = join(evidenceRoot, 'attempts', candidate.id)
    await mkdir(attemptRoot, { recursive: true })
    const reservation = await open(join(attemptRoot, `${scenario}-${model}.json`), 'wx', 0o600)
    await reservation.writeFile(JSON.stringify({ runId, scenario, model, candidateId: candidate.id, directory, started: new Date().toISOString(), budgetMs: timeoutMs, baselinePath }))
    await reservation.close()
    await atomicJson(join(directory, 'candidate.json'), candidate)
    const started = Date.now(),
        deadline = started + timeoutMs
    const abort = new AbortController(),
        exposure = []
    const timer = setTimeout(() => abort.abort(new Error('CASE_DEADLINE')), timeoutMs)
    const persist = () => atomicJson(join(directory, 'tool-exposure.json'), { runId, scope: 'Transparent test-only loopback; no auth headers, prompt bodies or payload changes retained', requests: exposure })
    const relay = createServer(async (request, response) => {
        if (!['/v1/models', '/v1/chat/completions'].includes(request.url)) {
            response.writeHead(404).end()
            return
        }
        const began = Date.now(),
            record = { runId, requestId: randomUUID(), at: new Date().toISOString(), path: request.url }
        const collector = new ToolStream()
        exposure.push(record)
        try {
            const chunks = []
            let size = 0
            for await (const chunk of request) {
                size += chunk.length
                assert.ok(size <= 8 * 1048576)
                chunks.push(chunk)
            }
            const bytes = Buffer.concat(chunks),
                body = bytes.length ? JSON.parse(bytes) : undefined
            record.model = body?.model
            if (body?.model && body.model !== model) throw new Error('MODEL_MISMATCH: provider sent a different model')
            record.tools = body?.tools?.map((t) => ({ name: t.function.name, schemaSha256: sha256(JSON.stringify(t.function.parameters)) }))
            // Store the actual CAD schemas separately; prompts and credentials stay in the native host.
            if (body?.tools)
                await atomicJson(
                    join(directory, `schemas-${record.requestId}.json`),
                    body.tools.filter((t) => t.function?.name?.startsWith('scad_ai_ide_')),
                )
            await persist()
            const incoming = await fetch(`http://127.0.0.1:8000${request.url}`, { method: request.method, headers: { 'content-type': 'application/json', ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) }, ...(bytes.length ? { body: bytes } : {}), signal: abort.signal })
            record.status = incoming.status
            record.headersMs = Date.now() - began
            response.writeHead(incoming.status, { 'content-type': incoming.headers.get('content-type') ?? 'application/json' })
            const decoder = new TextDecoder()
            if (incoming.body)
                for await (const chunk of incoming.body) {
                    record.firstByteMs ??= Date.now() - began
                    collector.append(decoder.decode(chunk, { stream: true }))
                    response.write(Buffer.from(chunk))
                }
            collector.append(decoder.decode() + '\n')
            record.streamEnded = true
            record.sseDone = collector.done
            record.finishReasons = collector.finishReasons
            record.malformedSse = collector.malformed
            record.rawToolCalls = [...collector.calls.values()]
            response.end()
        } catch (error) {
            record.error = String(error)
            record.rawToolCalls = [...collector.calls.values()]
            if (!response.headersSent) response.writeHead(502)
            response.end()
        } finally {
            record.elapsedMs = Date.now() - began
            await persist()
        }
    })
    await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve))
    async function messages(read) {
        const storage = JSON.parse((await read('observer-storage.json')) ?? '{}').storageUri
        if (!storage) return []
        const base = join(dirname(storage), 'GitHub.copilot-chat/transcripts')
        const files = await readdir(base, { recursive: true }).catch(() => [])
        const matches = []
        for (const file of files.filter((f) => f.endsWith('.jsonl'))) {
            const raw = await readFile(join(base, file), 'utf8')
            if (!raw.includes(marker)) continue
            matches.push({
                file,
                events: raw.split('\n').flatMap((line) => {
                    try {
                        return [JSON.parse(line)]
                    } catch {
                        return []
                    }
                }),
            })
        }
        assert.ok(matches.length <= 1, 'HARNESS_CORRELATION_AMBIGUOUS: run marker occurs in multiple transcripts')
        if (!matches.length) return []
        await atomicJson(join(directory, 'session-binding.json'), { runId, transcript: matches[0].file, method: 'unique marker in native user request' })
        const assistant = matches[0].events.filter((e) => e.type === 'assistant.message')
        await atomicJson(join(directory, 'assistant-messages.json'), assistant)
        return assistant
    }
    async function finish(result) {
        clearTimeout(timer)
        abort.abort()
        relay.closeAllConnections()
        await new Promise((resolve) => relay.close(resolve))
        await persist()
        const observed = await json(join(directory, 'command-state.json')).catch(() => null)
        await messages(async (name) => readFile(join(directory, name), 'utf8').catch(() => undefined))
        const traces = await json(join(directory, 'tool-traces.json')).catch(() => [])
        const after = await fingerprint(repo)
        result = { ...result, runId, scenario, model, candidateId: candidate.id, candidateUnchanged: after.id === candidate.id, budgetMs: timeoutMs, elapsedMs: Date.now() - started, commandState: observed, formalAttempt: 1 }
        if (!result.candidateUnchanged) {
            result.pass = false
            result.error = 'CANDIDATE_CHANGED_DURING_RUN'
        }
        result.assessment = policy.assess({ ...result, traces, exposure, rawCalls: exposure.flatMap((r) => r.rawToolCalls ?? []), terminal: observed?.state === 'completed' || !!result.finalText })
        await atomicJson(join(directory, 'result.json'), result)
        const archive = join(evidenceRoot, 'native', `${scenario}-${model}-${runId}`)
        await mkdir(archive, { recursive: true })
        for (const name of await readdir(directory)) {
            if (/^(candidate|result|ready|tool-traces|tool-exposure|document-events|command-state|session-binding|assistant-messages|native-config|request-input|approvals|approval-ack|human-needed|deterministic|observed-on-exit|pending-confirmation|schemas-.*)\.json$/.test(name)) {
                await writeFile(join(archive, name), await readFile(join(directory, name)), { mode: 0o600 })
            }
        }
        await atomicJson(join(archive, 'binding.json'), { runId, candidateId: candidate.id, directory, scenario, model, baseline: relative(repo, baselinePath) })
        console.log(JSON.stringify({ pass: result.pass, assessment: result.assessment, evidence: archive }))
        return result
    }
    async function requireTerminal(response, finalText) {
        const state = await json(join(directory, 'command-state.json')).catch(() => null)
        assert.ok(state?.state === 'completed' || finalText, 'TERMINAL_UNOBSERVED: a diagnostic/snapshot or HTTP 200 cannot terminate native Chat')
        const correlated = await messages(async (name) => readFile(join(directory, name), 'utf8').catch(() => undefined))
        assert.ok(correlated.length, 'SESSION_UNCORRELATED: native transcript must contain the exact run marker')
        assert.ok(!response?.result?.errorDetails && !response?.error, 'Native terminal contains an error')
    }
    return { requireTerminal, runId, marker, model, candidate, timeoutMs, deadline, exposure, relay, finish, messages, query: (text) => `${marker}\n${text}` }
}
