import type { Runtime } from './types'

const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function compareVersions(left: string, right: string): number {
    // Ignore trailing build metadata such as "(git abc123)" when comparing versions.
    const a = left.trim().match(/^(\d+(?:\.\d+)*)(?:-?([a-z][\w.-]*))?/i)
    const b = right.trim().match(/^(\d+(?:\.\d+)*)(?:-?([a-z][\w.-]*))?/i)
    if (!a || !b) {
        return a ? -1 : b ? 1 : natural.compare(right, left)
    }
    const aParts = a[1].split('.').map(Number)
    const bParts = b[1].split('.').map(Number)
    for (let index = 0; index < Math.max(aParts.length, bParts.length); index++) {
        const difference = (bParts[index] ?? 0) - (aParts[index] ?? 0)
        if (difference) {
            return difference
        }
    }
    // A final release follows test/pre-release builds of the same version.
    if (!a[2] || !b[2]) {
        return a[2] ? 1 : b[2] ? -1 : 0
    }
    return natural.compare(b[2], a[2])
}

/** Sort presentation data without changing discovery priority or the active runtime. */
export function sortRuntimesByVersion(runtimes: readonly Runtime[]): Runtime[] {
    return [...runtimes].sort((left, right) => compareVersions(left.version, right.version))
}
