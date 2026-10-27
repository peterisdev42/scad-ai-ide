export type GitHubRequest = (url: string, options?: RequestInit) => Promise<Response>

const credentialHosts = new Set(['api.github.com', 'github.com', 'uploads.github.com', 'raw.githubusercontent.com'])

/** Shared transport for GitHub calls. Tokens are resolved per request, never persisted. */
export function createGitHubRequest(getAccessToken: () => Promise<string | undefined>, transport: GitHubRequest = (url, options) => fetch(url, options), onAuthenticationError?: (error: unknown) => void, onAnonymousRequestFailure?: () => void): GitHubRequest {
    let pendingToken: Promise<string | undefined> | undefined
    const accessToken = () => {
        pendingToken ??= getAccessToken()
            .catch((error) => {
                onAuthenticationError?.(error)
                return undefined
            })
            .finally(() => {
                pendingToken = undefined
            })
        return pendingToken
    }
    return async (input, options = {}) => {
        const url = new URL(input)
        options.signal?.throwIfAborted()
        const trusted = url.protocol === 'https:' && credentialHosts.has(url.hostname) && !url.port && !url.username && !url.password
        const token = trusted ? await accessToken() : undefined
        options.signal?.throwIfAborted()
        const headers = new Headers(options.headers)
        headers.delete('Authorization')
        if (token) {
            headers.set('Authorization', `Bearer ${token}`)
        }
        if (!headers.has('User-Agent')) {
            headers.set('User-Agent', 'scad-ai-ide')
        }
        if (url.hostname === 'api.github.com') {
            if (!headers.has('Accept')) {
                headers.set('Accept', 'application/vnd.github+json')
            }
            if (!headers.has('X-GitHub-Api-Version')) {
                headers.set('X-GitHub-Api-Version', '2022-11-28')
            }
        }
        // Keep the host's default fetch implementation and redirect behavior. VS Code
        // routes redirect:"manual" through a different network stack from Electron fetch.
        // Standard fetch removes Authorization on cross-origin redirects.
        try {
            const response = await transport(url.toString(), { ...options, headers })
            if (trusted && !token && response.status >= 400) {
                onAnonymousRequestFailure?.()
            }
            return response
        } catch (error) {
            if (trusted && !token && options.signal?.reason?.name !== 'AbortError') {
                onAnonymousRequestFailure?.()
            }
            throw error
        }
    }
}

export const anonymousGitHubRequest = createGitHubRequest(async () => undefined)
