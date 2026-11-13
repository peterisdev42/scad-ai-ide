import type { DecodedMesh } from './types'
/** Display-only Float32 STL. Original topology/measurements always use the unmodified decoded input. */
export function displayMesh(decoded: DecodedMesh): { bytes: Uint8Array; maxCoordinateError: number } | undefined {
    const count = decoded.meshes.reduce((n, m) => n + m.indices.length / 3, 0),
        bytes = new Uint8Array(84 + count * 50),
        view = new DataView(bytes.buffer)
    view.setUint32(80, count, true)
    let face = 0,
        maxCoordinateError = 0
    for (const mesh of decoded.meshes)
        for (let t = 0; t < mesh.indices.length; t += 3) {
            for (let v = 0; v < 3; v++)
                for (let axis = 0; axis < 3; axis++) {
                    const value = mesh.positions[mesh.indices[t + v] * 3 + axis],
                        rounded = Math.fround(value)
                    if (!Number.isFinite(rounded)) return undefined
                    maxCoordinateError = Math.max(maxCoordinateError, Math.abs(rounded - value))
                    view.setFloat32(84 + face * 50 + 12 + (v * 3 + axis) * 4, rounded, true)
                }
            face++
        }
    return { bytes, maxCoordinateError }
}
