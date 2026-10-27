import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type * as vscode from 'vscode'
import { strToU8, zipSync } from 'fflate'
import { createGitHubRequest, type GitHubRequest } from '../platform/github/client'
import { UserWarning } from '../core/feedback'
import { fetchRuntimeBuilds } from '../platform/runtime/releases'
import { installRuntimeBuild } from '../platform/runtime/installation'

const api = 'https://api.github.com/repos/example/project/releases'

test('GitHub client uses the current token, preserves request headers and remains anonymous after logout', async () => {
    let token: string | undefined = 'test-token-one'
    const calls: Headers[] = []
    const request = createGitHubRequest(
        async () => token,
        async (_url, options) => {
            calls.push(new Headers(options?.headers))
            return new Response('[]')
        },
    )
    const headers = new Headers({ Accept: 'application/octet-stream', 'Content-Type': 'application/json', 'X-Custom': 'preserved' })
    await request(api, { headers })
    assert.equal(calls[0].get('authorization'), 'Bearer test-token-one')
    assert.equal(calls[0].get('accept'), 'application/octet-stream')
    assert.equal(calls[0].get('x-custom'), 'preserved')
    assert.equal(calls[0].get('content-type'), 'application/json')
    assert.equal(calls[0].get('user-agent'), 'scad-ai-ide')
    assert.ok(calls[0].get('x-github-api-version'))
    assert.equal(headers.get('authorization'), null)
    token = 'test-token-two'
    await request(api)
    assert.equal(calls[1].get('authorization'), 'Bearer test-token-two')
    token = undefined
    await request(api)
    assert.equal(calls[2].get('authorization'), null)
})

test('concurrent GitHub requests share an in-flight session lookup without caching tokens across later requests', async () => {
    let lookups = 0
    let resolve!: (token: string | undefined) => void
    const pending = new Promise<string | undefined>((done) => {
        resolve = done
    })
    const request = createGitHubRequest(
        async () => {
            lookups++
            return pending
        },
        async () => new Response('[]'),
    )
    const requests = [request(api), request(api)]
    assert.equal(lookups, 1)
    resolve('test-token')
    await Promise.all(requests)
    await request(api)
    assert.equal(lookups, 2)
})

test('GitHub tokens are never attached to insecure, lookalike or non-GitHub URLs', async () => {
    let lookups = 0
    const request = createGitHubRequest(
        async () => {
            lookups++
            return 'test-token'
        },
        async (_url, options) => {
            assert.equal(new Headers(options?.headers).get('authorization'), null)
            return new Response('ok')
        },
    )
    for (const url of ['https://example.com/archive', 'https://api.github.com.example.com/releases', 'http://api.github.com/releases', 'https://api.github.com:8443/releases', 'https://release-assets.githubusercontent.com/signed-asset']) {
        await request(url, { headers: { Authorization: 'caller-token' } })
    }
    assert.equal(lookups, 0)
})

async function listen(server: Server): Promise<string> {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function close(server: Server): Promise<void> {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

test('host fetch preserves same-origin authentication and strips it on cross-origin download redirects', async () => {
    const seen: Array<{ authorization?: string; cookie?: string }> = []
    const asset = createServer((request, response) => {
        seen.push({ authorization: request.headers.authorization, cookie: request.headers.cookie })
        response.end('archive')
    })
    const assetUrl = await listen(asset)
    const github = createServer((request, response) => {
        seen.push({ authorization: request.headers.authorization, cookie: request.headers.cookie })
        response.writeHead(302, { Location: request.url === '/start' ? '/same-origin' : assetUrl + '/archive' })
        response.end()
    })
    const githubUrl = await listen(github)
    try {
        const request = createGitHubRequest(
            async () => 'test-token',
            async (_url, options) => {
                assert.equal(options?.redirect, undefined)
                // Exercise native fetch against local servers with a synthetic token only.
                return fetch(githubUrl + '/start', options)
            },
        )
        const response = await request('https://github.com/example/project/releases/download/v1/file.zip', { headers: { Cookie: 'example=1' } })
        assert.equal(await response.text(), 'archive')
        assert.equal(seen.length, 3)
        assert.equal(seen[0].authorization, 'Bearer test-token')
        assert.equal(seen[1].authorization, 'Bearer test-token')
        assert.equal(seen[2].authorization, undefined)
        assert.equal(seen[2].cookie, undefined)
    } finally {
        await Promise.all([close(github), close(asset)])
    }
})

test('authenticated and anonymous API requests keep the host network path instead of forcing manual redirects', async () => {
    let token: string | undefined = 'test-token'
    let calls = 0
    const request = createGitHubRequest(
        async () => token,
        async (_url, options) => {
            calls++
            // VS Code selects a different fetch/proxy stack for redirect:"manual".
            if (options?.redirect === 'manual') {
                throw new Error('UND_ERR_CONNECT_TIMEOUT')
            }
            return new Response('[]')
        },
    )
    assert.equal((await request(api)).status, 200)
    token = undefined
    assert.equal((await request(api)).status, 200)
    assert.equal(calls, 2)
    await assert.rejects(request(api, { signal: AbortSignal.abort() }))
    assert.equal(calls, 2)
})

test('explicit redirect options and request signals are delegated to the host fetch unchanged', async () => {
    const signal = new AbortController().signal
    const calls: RequestInit[] = []
    const request = createGitHubRequest(
        async () => undefined,
        async (_url, options) => {
            calls.push(options!)
            return new Response(null, { status: 302 })
        },
    )
    await request(api, { redirect: 'manual', signal })
    await request(api, { redirect: 'error', signal })
    assert.equal(calls[0].redirect, 'manual')
    assert.equal(calls[1].redirect, 'error')
    assert.ok(calls.every((options) => options.signal === signal))
})

test('unavailable GitHub authentication falls back to anonymous requests and reports the authentication error', async () => {
    const unavailable = new Error('GitHub authentication provider unavailable')
    const reported: unknown[] = []
    const request = createGitHubRequest(
        async () => {
            throw unavailable
        },
        async (_url, options) => {
            assert.equal(new Headers(options?.headers).get('authorization'), null)
            return new Response('ok')
        },
        (error) => reported.push(error),
    )
    await request(api)
    assert.deepEqual(reported, [unavailable])
})

async function mockVSCodeGitHub() {
    const file = path.join(__dirname, '../features/github/registerGitHub.js')
    const code = await readFile(file, 'utf8')
    let token: string | undefined
    let responseStatus = 200
    let authenticationError: Error | undefined
    let delayed: Promise<{ accessToken: string; account: { label: string } } | undefined> | undefined
    class MockEmitter<T> {
        listeners = new Set<(event: T) => void>()
        event = (listener: (event: T) => void) => {
            this.listeners.add(listener)
            return {
                dispose: () => {
                    this.listeners.delete(listener)
                },
            }
        }
        fire(event: T) {
            this.listeners.forEach((listener) => listener(event))
        }
        dispose() {
            this.listeners.clear()
        }
    }
    const sessionChanges = new MockEmitter<{ provider: { id: string } }>()
    const sessions: Array<{ provider: string; scopes: string[]; options: vscode.AuthenticationGetSessionOptions }> = []
    const requests: Headers[] = []
    const logs: string[] = []
    const subscriptions: vscode.Disposable[] = []
    const mock = {
        EventEmitter: MockEmitter,
        authentication: {
            onDidChangeSessions: sessionChanges.event,
            getSession: async (provider: string, scopes: string[], options: vscode.AuthenticationGetSessionOptions) => {
                sessions.push({ provider, scopes, options })
                if (authenticationError) {
                    throw authenticationError
                }
                if (delayed) {
                    const pending = delayed
                    delayed = undefined
                    return pending
                }
                if (options.createIfNone) {
                    token = 'test-connected-token'
                }
                return token ? { accessToken: token, account: { label: 'maker' } } : undefined
            },
        },
        window: { createOutputChannel: () => ({ appendLine: (message: string) => logs.push(message), show() {}, dispose() {} }) },
    }
    const sandbox = {
        exports: {} as { registerGitHub?: typeof import('../features/github/registerGitHub').registerGitHub },
        require: (id: string) => (id === 'vscode' ? mock : require(path.resolve(path.dirname(file), id))),
        fetch: async (_url: string, options?: RequestInit) => {
            requests.push(new Headers(options?.headers))
            return new Response('[]', { status: responseStatus })
        },
    }
    vm.runInNewContext(code, sandbox, { filename: file })
    const client = sandbox.exports.registerGitHub!({ subscriptions } as vscode.ExtensionContext)
    return {
        client,
        sessions,
        requests,
        logs,
        subscriptions,
        sessionChanges,
        setResponseStatus: (status: number) => {
            responseStatus = status
        },
        setError: (error: Error) => {
            authenticationError = error
        },
        deferNextSession: (pending: NonNullable<typeof delayed>) => {
            delayed = pending
        },
        setToken: (value: string | undefined) => {
            token = value
        },
    }
}

test('VS Code GitHub adapter uses silent Authentication API access and never passes tokens into logs', async () => {
    const mock = await mockVSCodeGitHub()
    mock.setToken('test-existing-session')
    await mock.client.request(api)
    assert.equal(mock.sessions[0].provider, 'github')
    assert.equal(mock.sessions[0].scopes.length, 0)
    assert.equal(mock.sessions[0].options.silent, true)
    assert.equal(mock.sessions[0].options.createIfNone, undefined)
    assert.equal(mock.requests[0].get('authorization'), 'Bearer test-existing-session')
    assert.ok(!mock.logs.join('\n').includes('test-existing-session'))
    mock.setToken(undefined)
    await mock.client.request(api)
    assert.equal(mock.requests[1].get('authorization'), null)
})

test('VS Code GitHub sign-in is interactive only when Connect is explicitly called', async () => {
    const mock = await mockVSCodeGitHub()
    await mock.client.request(api)
    assert.equal(mock.requests[0].get('authorization'), null)
    assert.equal(mock.sessions[0].options.silent, true)
    await mock.client.connect()
    assert.equal(mock.sessions[1].options.createIfNone, true)
    assert.equal(mock.sessions[1].options.silent, undefined)
    await mock.client.request(api)
    assert.equal(mock.requests[1].get('authorization'), 'Bearer test-connected-token')
})

test('release pagination, runtime downloads and checksums all use the shared authenticated GitHub client', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'scad-github-client-'))
    try {
        const bytes = Buffer.from(zipSync({ 'openscad-cli-windows-x86_64/bin/openscad.exe': strToU8('test executable') }))
        const download = 'https://github.com/peterisdev42/scad-ai-ide-builder/releases/download/test/openscad-cli-windows-x86_64.zip'
        const checksum = require('node:crypto').createHash('sha256').update(bytes).digest('hex')
        const calls: string[] = []
        const request = createGitHubRequest(
            async () => 'test-shared-token',
            async (url, options) => {
                calls.push(url)
                const headers = new Headers(options?.headers)
                assert.equal(headers.get('authorization'), 'Bearer test-shared-token')
                if (url === download) {
                    return new Response(bytes)
                }
                if (url === download + '.sha256') {
                    return new Response(`${checksum}  openscad-cli-windows-x86_64.zip`)
                }
                if (url.includes('page=2')) {
                    return new Response('[]')
                }
                return new Response(
                    JSON.stringify([
                        {
                            tag_name: 'test',
                            assets: [
                                { id: 100, name: 'openscad-cli-windows-x86_64.zip', browser_download_url: download, size: bytes.length },
                                { id: 101, name: 'openscad-cli-windows-x86_64.zip.sha256', browser_download_url: download + '.sha256' },
                            ],
                        },
                    ]),
                    { headers: { link: '<next>; rel="next"' } },
                )
            },
        )
        const system = { platform: 'win32', architecture: 'x64', name: '', version: '' }
        const builds = await fetchRuntimeBuilds(system, request)
        await installRuntimeBuild(root, system, builds[0], {
            request,
            check: async (candidate) => {
                assert.equal(await readFile(candidate.command.executable, 'utf8'), 'test executable')
                return { ...candidate, id: 'test', version: '2021.01', platform: 'win32', status: 'available' }
            },
        })
        assert.equal(calls.length, 4)
        assert.ok(calls.some((url) => url.includes('page=2')))
        assert.ok(calls.includes(download + '.sha256'))
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('More GitHub state follows authorized sessions and logout without serializing the access token', async () => {
    const mock = await mockVSCodeGitHub()
    const states: unknown[] = []
    mock.client.onDidChange(() => states.push(mock.client.getState()))
    mock.setToken('test-secret-not-for-panel')
    await mock.client.refresh()
    assert.equal(mock.client.getState().mode, 'authenticated')
    assert.equal(mock.client.getState().account, 'maker')
    assert.equal(mock.client.getState().busy, false)
    assert.ok(!JSON.stringify(mock.client.getState()).includes('test-secret-not-for-panel'))
    assert.ok(!JSON.stringify(states).includes('test-secret-not-for-panel'))
    const lookups = mock.sessions.length
    mock.sessionChanges.fire({ provider: { id: 'microsoft' } })
    assert.equal(mock.sessions.length, lookups)
    mock.setToken(undefined)
    await new Promise<void>((resolve) => {
        const listener = mock.client.onDidChange(() => {
            const state = mock.client.getState()
            if (state.mode === 'anonymous' && !state.busy) {
                listener.dispose()
                resolve()
            }
        })
        mock.sessionChanges.fire({ provider: { id: 'github' } })
    })
    assert.equal(mock.client.getState().mode, 'anonymous')
    assert.equal(mock.client.getState().account, undefined)
})

test('More exposes authentication failure reasons and continues anonymous GitHub access', async () => {
    const mock = await mockVSCodeGitHub()
    mock.setError(new Error('The GitHub authentication provider is disabled'))
    await mock.client.refresh()
    assert.equal(mock.client.getState().mode, 'anonymous')
    assert.equal(mock.client.getState().busy, false)
    assert.match(mock.client.getState().message!, /authentication provider is disabled/)
    await mock.client.request(api)
    assert.equal(mock.requests[0].get('authorization'), null)
    assert.match(mock.logs.join('\n'), /authentication provider is disabled/)
})

test('a late stale authentication check cannot overwrite the current More connection state', async () => {
    const mock = await mockVSCodeGitHub()
    let resolve!: (value: undefined) => void
    mock.deferNextSession(
        new Promise((done) => {
            resolve = done
        }),
    )
    const oldCheck = mock.client.refresh()
    mock.setToken('test-current-session')
    await mock.client.refresh()
    assert.equal(mock.client.getState().mode, 'authenticated')
    resolve(undefined)
    await oldCheck
    assert.equal(mock.client.getState().mode, 'authenticated')
    assert.equal(mock.client.getState().account, 'maker')
    mock.subscriptions.forEach((subscription) => subscription.dispose())
})

test('anonymous GitHub failures suggest sign-in without consuming responses or replacing the original error', async () => {
    let token: string | undefined
    let failure: Error | undefined
    let suggestions = 0
    let status = 403
    const request = createGitHubRequest(
        async () => token,
        async () => {
            if (failure) {
                throw failure
            }
            return new Response('upstream reason', { status })
        },
        undefined,
        () => suggestions++,
    )
    const response = await request(api)
    assert.equal(suggestions, 1)
    assert.equal(await response.text(), 'upstream reason')
    token = 'test-authenticated'
    await request(api)
    assert.equal(suggestions, 1)
    token = undefined
    await request('https://example.com/failure')
    assert.equal(suggestions, 1)
    status = 200
    await request(api)
    assert.equal(suggestions, 1)
    failure = new Error('original network error')
    await assert.rejects(request(api), (error) => error === failure)
    assert.equal(suggestions, 2)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(request(api, { signal: controller.signal }))
    assert.equal(suggestions, 2)
})

test('More retains the shared sign-in hint across anonymous checks and clears it after connecting', async () => {
    const mock = await mockVSCodeGitHub()
    mock.setResponseStatus(403)
    await mock.client.request(api)
    assert.equal(mock.client.getState().loginSuggested, true)
    await mock.client.refresh()
    assert.equal(mock.client.getState().loginSuggested, true)
    await mock.client.connect()
    assert.equal(mock.client.getState().mode, 'authenticated')
    assert.equal(mock.client.getState().loginSuggested, undefined)
    await mock.client.request(api)
    assert.equal(mock.client.getState().loginSuggested, undefined)
})

test('all panels receive anonymous failure guidance and route to the same More GitHub page', async () => {
    const file = path.join(__dirname, '../features/panels/PanelManager.js')
    const code = await readFile(file, 'utf8')
    const pages = ['ai', 'bricks', 'libraries', 'runtime', 'more']
    type Listener = (message: unknown) => Promise<void>
    const panels = new Map<string, { messages: Array<{ type: string; state?: unknown; severity?: string; action?: string }>; receive?: Listener; reveals: number; html: string }>()
    let changed!: () => void
    let state = { mode: 'anonymous', busy: false, loginSuggested: false }
    const disposable = { dispose() {} }
    const mock = {
        Uri: { joinPath: (...parts: unknown[]) => parts.join('/') },
        ViewColumn: { Active: 1 },
        workspace: { fs: { readFile: async () => Buffer.from('{{page}}') } },
        window: {
            createWebviewPanel: (viewType: string) => {
                const record = { messages: [] as Array<{ type: string; state?: unknown; severity?: string; action?: string }>, receive: undefined as Listener | undefined, reveals: 0, html: '' }
                panels.set(viewType.replace('scad-ai.', ''), record)
                return {
                    webview: {
                        postMessage: async (message: { type: string; state?: unknown; severity?: string; action?: string }) => record.messages.push(message),
                        onDidReceiveMessage: (listener: Listener) => {
                            record.receive = listener
                            return disposable
                        },
                        asWebviewUri: (uri: string) => uri,
                        set html(value: string) {
                            record.html = value
                        },
                    },
                    reveal: () => record.reveals++,
                    onDidDispose: () => disposable,
                }
            },
        },
    }
    const sandbox = {
        Buffer,
        exports: {} as { PanelManager: typeof import('../features/panels/PanelManager').PanelManager },
        require: (id: string) => (id === 'vscode' ? mock : id.includes('QuickAccessTreeProvider') ? { quickAccess: pages.map((id) => ({ id, title: id })) } : id.startsWith('.') ? require(path.resolve(path.dirname(file), id)) : require(id)),
    }
    vm.runInNewContext(code, sandbox, { filename: file })
    const manager = new sandbox.exports.PanelManager(
        'extension' as unknown as vscode.Uri,
        {
            onDidChange: () => disposable,
            getState: () => ({}),
            loadBuilds: async () => {},
            browse: async () => {
                throw new UserWarning('Trust this workspace')
            },
        } as unknown as ConstructorParameters<typeof sandbox.exports.PanelManager>[1],
        {
            onDidChange: (listener: () => void) => {
                changed = listener
                return disposable
            },
            getState: () => state,
            refresh: async () => {},
        } as unknown as ReturnType<typeof import('../features/github/registerGitHub').registerGitHub>,
    )
    for (const id of pages) {
        await manager.open(id as Parameters<typeof manager.open>[0])
        await panels.get(id)!.receive!({ action: 'ready' })
        assert.ok(panels.get(id)!.messages.some((message) => message.type === 'githubState'))
    }
    state = { ...state, loginSuggested: true }
    changed()
    for (const id of pages) {
        const panel = panels.get(id)!
        assert.equal((panel.messages.at(-1)?.state as typeof state).loginSuggested, true)
        await panel.receive!({ action: 'openGitHubConnection' })
    }
    assert.equal(panels.size, 5)
    assert.equal(panels.get('more')!.reveals, 5)
    assert.equal(panels.get('more')!.html, 'more')
    await panels.get('runtime')!.receive!({ action: 'browse' })
    assert.equal(panels.get('runtime')!.messages.at(-2)?.type, 'error')
    assert.equal(panels.get('runtime')!.messages.at(-2)?.severity, 'warning')
    assert.equal(panels.get('runtime')!.messages.at(-2)?.action, 'browse')
    assert.equal(panels.get('runtime')!.messages.at(-1)?.type, 'actionComplete')
})

test('background GitHub session checks preserve the connected UI without showing interactive loading', async () => {
    const mock = await mockVSCodeGitHub()
    mock.setToken('test-existing-session')
    await mock.client.refresh()
    const states: ReturnType<typeof mock.client.getState>[] = []
    mock.client.onDidChange(() => states.push(mock.client.getState()))
    await mock.client.request(api)
    assert.ok(states.length > 0)
    assert.ok(states.every((state) => state.mode === 'authenticated' && !state.busy))
})
