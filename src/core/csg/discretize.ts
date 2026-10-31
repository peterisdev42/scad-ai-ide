import type { CsgValue } from './parser'

/** CurveDiscretizer at OpenSCAD fe482c3, including experimental $fe. */
export function circularSegments(p: Record<string, CsgValue>, radius: number, angle = 360): number {
    const n = (key: string, fallback: number) => (typeof p[key] === 'number' ? (p[key] as number) : fallback)
    const fn = n('$fn', 0),
        r = Math.abs(radius),
        fe = n('$fe', 0)
    let count: number
    if (fn > 0) count = Math.ceil(Math.max(fn, 3))
    else if (fe >= 1e-6 && r > 0) count = Math.min(Math.max(5, Math.min(360 / 0.01, (r * 2 * Math.PI) / 0.01)), fe / r >= 0.1909830056 ? 5 : Math.PI / Math.acos(1 - fe / r))
    else count = Math.ceil(Math.max(5, Math.min(360 / Math.max(n('$fa', 12), 0.01), (r * 2 * Math.PI) / Math.max(n('$fs', 2), 0.01))))
    const result = Math.max(1, Math.ceil((count * Math.abs(angle)) / 360))
    if (!Number.isFinite(result) || result > 65536) throw new Error('CSG discretization exceeds the 65536 segment resource budget.')
    return result
}
