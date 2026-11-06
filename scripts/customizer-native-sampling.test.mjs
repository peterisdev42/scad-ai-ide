import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { startSamplingProxy } from './customizer-native-sampling.mjs'

test('native sampling transport preserves real request content, stream bytes and upstream failures; denies writes and model changes', async () => {
    const received = []
    const stream = '{"message":{"content":"Ω"},"done":false}\n{"done":true}\n'
    const upstream = createServer(async (request, response) => {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const body = Buffer.concat(chunks).toString('utf8')
        received.push({ path: request.url, body: body ? JSON.parse(body) : undefined })
        if (request.url === '/api/show') {
            response.writeHead(503, { 'content-type': 'application/json' })
            response.end('{"error":"fixture unavailable"}')
        } else {
            response.writeHead(200, { 'content-type': 'application/x-ndjson' })
            response.write(stream.slice(0, 18))
            setImmediate(() => response.end(stream.slice(18)))
        }
    })
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
    const proxy = await startSamplingProxy(`http://127.0.0.1:${upstream.address().port}`)
    const post = (path, body) => fetch(proxy.endpoint + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    try {
        const input = { model: 'qwen3.5:2b-mlx', messages: [{ role: 'user', content: 'synthetic Ω' }], tools: [{ type: 'function', function: { name: 'fixture_read', parameters: { type: 'object' } } }], options: { num_ctx: 32768 }, stream: true }
        const response = await post('/api/chat', input)
        assert.equal(response.status, 200)
        assert.equal(await response.text(), stream)
        assert.deepEqual(received[0], { path: '/api/chat', body: { ...input, options: { num_ctx: 32768, temperature: 0 } } })
        const failure = await post('/api/show', { model: input.model })
        assert.equal(failure.status, 503)
        assert.equal(await failure.text(), '{"error":"fixture unavailable"}')
        for (const [path, body] of [['/api/create', { model: input.model }], ['/api/chat', { ...input, model: 'unapproved-model' }]]) {
            const denied = await post(path, body)
            assert.equal(denied.status, 502)
            await denied.text()
        }
        assert.equal(received.length, 2, 'Denied operations never reach the upstream server')
        assert.equal(proxy.requests.filter(request => request.path === '/api/chat' && request.status === 200).length, 1)
    } finally {
        await proxy.close()
        upstream.closeAllConnections()
        await new Promise(resolve => upstream.close(resolve))
    }
})
