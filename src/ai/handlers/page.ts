export function page<T>(items: T[], input: Record<string, unknown>) {
    const offset = Number(input.offset ?? 0)
    const result = items.slice(offset, offset + Number(input.limit ?? 20))
    const next = offset + result.length
    return { total: items.length, offset, items: result, hasMore: next < items.length, nextOffset: next < items.length ? next : null }
}
