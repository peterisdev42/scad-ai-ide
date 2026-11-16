type Vec3 = [number, number, number]
export interface EvidenceDisplayPart {
    key: string
    partId: string | null
    role: 'baseline' | 'target'
    positions: Float32Array
    indices: Uint32Array
    mesh: number
    instanceId: string
    anchorHash: string
}
export interface EvidenceDisplay {
    version: 1
    origin: Vec3
    maxCoordinateError: number
    parts: EvidenceDisplayPart[]
}
export function decodeDisplay(bytes: Uint8Array): EvidenceDisplay {
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        decode = new TextDecoder()
    if (bytes.length < 8 || decode.decode(bytes.subarray(0, 4)) !== 'EVW1') throw new Error('Invalid frozen evidence format')
    const length = data.getUint32(4, true)
    if (length > 1048576 || length + 8 > bytes.length || bytes.length > 128 * 1048576) throw new Error('Evidence budget exceeded')
    const header = JSON.parse(decode.decode(bytes.subarray(8, 8 + length))) as Omit<EvidenceDisplay, 'parts'> & { parts: Array<Omit<EvidenceDisplayPart, 'positions' | 'indices'> & { positions: number; indices: number }> }
    if (header.version !== 1 || !Array.isArray(header.parts) || header.parts.length > 8192 || !Array.isArray(header.origin) || header.origin.length !== 3 || header.origin.some((n) => !Number.isFinite(n))) throw new Error('Invalid evidence metadata')
    let offset = 8 + length
    const parts = header.parts.map((p) => {
        if (!Number.isSafeInteger(p.positions) || !Number.isSafeInteger(p.indices) || p.positions < 0 || p.indices < 0 || p.positions % 3 || p.indices % 3 || offset + p.positions * 4 + p.indices * 4 > bytes.length) throw new Error('Invalid evidence arrays')
        const positions = new Float32Array(p.positions),
            indices = new Uint32Array(p.indices)
        for (let i = 0; i < positions.length; i++) {
            positions[i] = data.getFloat32(offset + i * 4, true)
            if (!Number.isFinite(positions[i])) throw new Error('Nonfinite evidence')
        }
        offset += positions.byteLength
        for (let i = 0; i < indices.length; i++) {
            indices[i] = data.getUint32(offset + i * 4, true)
            if (indices[i] >= positions.length / 3) throw new Error('Evidence index out of range')
        }
        offset += indices.byteLength
        return { ...p, positions, indices }
    })
    if (offset !== bytes.length) throw new Error('Unexpected evidence trailing bytes')
    return { ...header, parts }
}
