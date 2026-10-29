import type { GitHubRequest } from './client'

// Preserve the upstream error, including Node's DNS/TLS/connection cause chain.
export function describeRequestError(error: unknown): string {
    const parts: string[] = []
    const visited = new Set<unknown>()
    const visit = (value: unknown) => {
        if (visited.has(value)) {
            return
        }
        visited.add(value)
        if (value && typeof value === 'object') {
            const detail = value as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown; errors?: unknown }
            if (typeof detail.message === 'string' && detail.message) {
                const name = typeof detail.name === 'string' && detail.name !== 'Error' ? `${detail.name}: ` : ''
                const code = typeof detail.code === 'string' && !detail.message.includes(detail.code) ? ` (${detail.code})` : ''
                parts.push(`${name}${detail.message}${code}`)
            } else if (typeof detail.code === 'string') {
                parts.push(detail.code)
            }
            if (detail.cause !== undefined) {
                visit(detail.cause)
            }
            if (Array.isArray(detail.errors)) {
                detail.errors.forEach(visit)
            }
        } else if (value !== undefined) {
            parts.push(String(value))
        }
    }
    visit(error)
    return [...new Set(parts)].join('\n') || String(error)
}

async function githubResponseError(response: Response, requestUrl: string, source: string): Promise<Error> {
    const statusNames: Record<number, string> = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' }
    const status = response.statusText || statusNames[response.status] || ''
    const lines = [`${source} error: HTTP ${response.status}${status ? ` ${status}` : ''}`, `Request: ${requestUrl}`]
    try {
        const body = await response.text()
        let payload: unknown
        try {
            payload = JSON.parse(body)
        } catch {
            // Proxies and GitHub service failures may return plain text or HTML.
        }
        if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string') {
            lines.push(payload.message)
            if ('errors' in payload && payload.errors) {
                lines.push(`Details: ${JSON.stringify(payload.errors)}`)
            }
            if ('documentation_url' in payload && typeof payload.documentation_url === 'string') {
                lines.push(`GitHub documentation: ${payload.documentation_url}`)
            }
        } else if (body.trim()) {
            lines.push(body.trim())
        }
    } catch (error) {
        lines.push(`Could not read the error response: ${describeRequestError(error)}`)
    }
    const remaining = response.headers.get('x-ratelimit-remaining')
    const limit = response.headers.get('x-ratelimit-limit')
    if (remaining !== null) {
        lines.push(`GitHub API requests remaining: ${remaining}${limit ? ` / ${limit}` : ''}`)
    }
    const reset = response.headers.get('x-ratelimit-reset')
    if (reset && /^\d+$/.test(reset)) {
        const date = new Date(Number(reset) * 1000)
        if (!Number.isNaN(date.getTime())) {
            lines.push(`Rate limit resets at: ${date.toISOString()} (UTC)`)
        }
    }
    const retry = response.headers.get('retry-after')
    if (retry) {
        lines.push(`Retry after: ${/^\d+$/.test(retry) ? `${retry} seconds` : retry}`)
    }
    const requestId = response.headers.get('x-github-request-id')
    if (requestId) {
        lines.push(`GitHub request ID: ${requestId}`)
    }
    return new Error(lines.join('\n'))
}

export async function requestGitHub(request: GitHubRequest, url: string, options: RequestInit, source = 'GitHub API'): Promise<Response> {
    let response: Response
    try {
        response = await request(url, options)
    } catch (error) {
        throw new Error(`${source} request failed.\nRequest: ${url}\n${describeRequestError(error)}`, { cause: error })
    }
    if (!response.ok) {
        throw await githubResponseError(response, url, source)
    }
    return response
}
