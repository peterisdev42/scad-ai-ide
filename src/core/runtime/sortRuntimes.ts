const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
const versionPattern = /^(?:openscad(?:-cli)?-)?(\d{4})\.(\d{1,2})(?:\.(\d{1,2}))?(?:[-.]([\w][\w.-]*))?(?:\s+\(.*\))?$/i

function versionParts(value: string) {
    const match = versionPattern.exec(value.trim())
    if (!match) return undefined
    return { date: [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)], suffix: match[4] ?? '' }
}

/** Descending year, month, day, then natural suffix order; ties keep their input order. */
export function compareRuntimeVersions(left: string, right: string): number {
    const a = versionParts(left)
    const b = versionParts(right)
    if (!a || !b) return a ? -1 : b ? 1 : 0
    for (let index = 0; index < a.date.length; index++) {
        const difference = b.date[index] - a.date[index]
        if (difference) return difference
    }
    return natural.compare(b.suffix, a.suffix)
}

type VersionedRuntime = { release?: string; tag?: string; version?: string }

function sortingVersion(runtime: VersionedRuntime): string {
    return [runtime.release, runtime.tag, runtime.version].find((value) => value !== undefined && versionParts(value)) ?? ''
}

/** Sort presentation data without changing discovery priority or the active runtime. */
export function sortRuntimesByVersion<T extends VersionedRuntime>(runtimes: readonly T[]): T[] {
    return [...runtimes].sort((left, right) => compareRuntimeVersions(sortingVersion(left), sortingVersion(right)))
}
