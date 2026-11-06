/** Bounded diagnostic preview. Keys and string token patterns are redacted before serialization. */
export function safePreview(value: unknown, maxBytes = 8192): unknown {
    let entries = 0
    const seen = new Set<object>()
    const visit = (item: unknown, depth: number, key = ''): unknown => {
        if (/api.?key|access.?key|passphrase|connection.?string|token|secret|password|credential|authorization|cookie|private.?key|session|prompt|email/i.test(key)) return '[REDACTED]'
        if (++entries > 100 || depth > 5) return '[TRUNCATED]'
        if (typeof item === 'string' && /-----BEGIN.*PRIVATE KEY-----/.test(item)) return '[REDACTED]'
        if (typeof item === 'string') return item.replace(/(?:Bearer\s+\S+|gh[pousr]_[A-Za-z0-9_]+|github_pat_\S+|sk-[A-Za-z0-9_-]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi, '[REDACTED]').slice(0, 512)
        if (item && typeof item === 'object') {
            if (seen.has(item)) return '[CIRCULAR]'
            seen.add(item)
            if (Array.isArray(item)) return item.slice(0, 30).map((entry) => visit(entry, depth + 1))
            return Object.fromEntries(Object.entries(item).slice(0, 30).map(([name, entry]) => [name, visit(entry, depth + 1, name)]))
        }
        return item
    }
    const result = visit(value, 0)
    const json = JSON.stringify(result) ?? 'null'
    return Buffer.byteLength(json) <= maxBytes ? result : { truncated: true, preview: Buffer.from(json).subarray(0, maxBytes).toString('utf8') }
}
