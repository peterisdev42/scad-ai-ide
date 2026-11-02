import { strFromU8, unzipSync } from 'fflate'

/** Three's loader preserves raw coordinates; 3MF models declare physical units. */
export function threeMfMillimeterScale(bytes: Uint8Array): number {
    const archive = unzipSync(bytes)
    const path = Object.keys(archive).find((p) => /^3D\/3dmodel\.model$/i.test(p)) ?? Object.keys(archive).find((p) => /\.model$/i.test(p))
    if (!path) throw new Error('3MF archive has no model document.')
    const header = /<(?:\w+:)?model\b[^>]*>/i.exec(strFromU8(archive[path]))?.[0] ?? ''
    const unit = /\bunit\s*=\s*["']([^"']+)["']/i.exec(header)?.[1] ?? 'millimeter'
    const factor: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }
    if (!(unit in factor)) throw new Error(`Unsupported 3MF unit: ${unit}`)
    return factor[unit]
}
