import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// Test-only transport. It does not run an agent, generate calls/results, change
// tools/messages, switch models or modify the user's global model settings.
export async function startSamplingProxy(upstream = 'http://127.0.0.1:11434', temperature = 0) {
    const origin = new URL(upstream)
    assert.ok(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && !origin.username && !origin.password)
    assert.ok(Number.isFinite(temperature) && temperature >= 0 && temperature <= 2)
    const requests = []
    const server = createServer(async (request, response) => {
        const record = { method: request.method, path: request.url }
        requests.push(record)
        const abort = new AbortController()
        response.on('close', () => { if (!response.writableEnded) abort.abort() })
        try {
            const allowed = request.method === 'GET' ? ['/api/tags', '/api/version', '/api/ps'] : request.method === 'POST' ? ['/api/show', '/api/chat'] : []
            assert.ok(allowed.includes(request.url), 'Only local Ollama discovery and chat requests are allowed')
            const chunks = []
            let bytes = 0
            for await (const chunk of request) {
                bytes += chunk.length
                assert.ok(bytes <= 16 * 1024 * 1024, 'Native test request exceeds the transport bound')
                chunks.push(chunk)
            }
            let body = Buffer.concat(chunks)
            if (request.url === '/api/chat' && request.method === 'POST') {
                const payload = JSON.parse(body.toString('utf8'))
                assert.equal(payload.model, 'qwen3.5:2b-mlx', 'This sampling audit must use the user-specified model')
                payload.options = { ...payload.options, temperature }
                Object.assign(record, { model: payload.model, requestedTemperature: temperature, tools: payload.tools?.length ?? 0, messages: payload.messages?.length ?? 0 })
                body = Buffer.from(JSON.stringify(payload))
            }
            const result = await fetch(origin.origin + request.url, { method: request.method, body: request.method === 'POST' ? body : undefined, headers: { 'content-type': request.headers['content-type'] ?? 'application/json' }, signal: abort.signal, redirect: 'error' })
            record.status = result.status
            response.writeHead(result.status, { 'content-type': result.headers.get('content-type') ?? 'application/json' })
            if (result.body) await pipeline(Readable.fromWeb(result.body), response)
            else response.end()
        } catch (error) {
            record.error = error.message
            if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' })
            if (!response.writableEnded) response.end(JSON.stringify({ error: 'Native sampling transport failed' }))
        }
    })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    server.unref()
    return { endpoint: `http://127.0.0.1:${server.address().port}`, requests, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const proxy = await startSamplingProxy()
    const report = path.resolve(process.env.SCAD_AGENT_SAMPLING_REPORT ?? `.build/native-sampling-${process.env.SCAD_AGENT_SCENARIO ?? 'author'}.json`)
    try {
        const child = spawn(process.execPath, ['scripts/customizer-native-agent.mjs'], { stdio: 'inherit', env: { ...process.env, SCAD_AGENT_OLLAMA_URL: proxy.endpoint, SCAD_AGENT_INFERENCE_PROFILE: 'Real native Agent/official Ollama provider via loopback forwarding; only options.temperature=0 added, full tools/messages preserved' } })
        const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1)) })
        process.exitCode = code
    } finally {
        await proxy.close()
        await mkdir(path.dirname(report), { recursive: true })
        const forwardedChatRequests = proxy.requests.filter(request => request.path === '/api/chat' && request.model === 'qwen3.5:2b-mlx').length
        if (!forwardedChatRequests) process.exitCode = 1
        await writeFile(report, JSON.stringify({ scope: 'Client-request sampling profile only; not model acceptance or proof of the server internal sampler', model: 'qwen3.5:2b-mlx', upstream: 'http://127.0.0.1:11434', requestedTemperature: 0, forwardedChatRequests, toolsAndMessagesModified: false, globalSettingsModified: false, requests: proxy.requests }, null, 2) + '\n')
        console.log(`Native sampling profile: ${report}`)
    }
}
