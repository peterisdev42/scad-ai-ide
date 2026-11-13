import type { DecodedMesh, RawMesh } from '../mesh/types'
/** Versioned Float64 geometry, preserving original indices and instance provenance. */
export function worldArtifact(parts: Array<{ id: string; decoded: DecodedMesh }>): Uint8Array {
    const metadata = Buffer.from(
            JSON.stringify({
                schemaVersion: 1,
                numericType: 'float64',
                parts: parts.map((p) => ({
                    id: p.id,
                    meshes: p.decoded.meshes.map((m) => ({ instanceId: m.instanceId, objectId: m.objectId, positions: m.positions.length, indices: m.indices.length })),
                })),
            }),
        ),
        chunks: Buffer[] = []
    const header = Buffer.alloc(8)
    header.write('ASW1')
    header.writeUInt32LE(metadata.length, 4)
    chunks.push(header, metadata)
    for (const p of parts)
        for (const m of p.decoded.meshes) {
            const positions = Buffer.alloc(m.positions.byteLength),
                indices = Buffer.alloc(m.indices.byteLength)
            m.positions.forEach((v, i) => positions.writeDoubleLE(v, i * 8))
            m.indices.forEach((v, i) => indices.writeUInt32LE(v, i * 4))
            chunks.push(positions, indices)
        }
    return Buffer.concat(chunks)
}

export function readWorldArtifact(bytes: Uint8Array, selected: string[]): DecodedMesh {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (buffer.length < 8 || buffer.toString('ascii', 0, 4) !== 'ASW1') throw new Error('WORLD_ARTIFACT_INVALID')
    const length = buffer.readUInt32LE(4)
    if (length > 1048576 || length + 8 > buffer.length) throw new Error('WORLD_ARTIFACT_INVALID')
    const metadata = JSON.parse(buffer.toString('utf8', 8, 8 + length)) as {
        schemaVersion: number
        parts: Array<{ id: string; meshes: Array<{ instanceId: string; objectId: string; positions: number; indices: number }> }>
    }
    if (metadata.schemaVersion !== 1) throw new Error('WORLD_ARTIFACT_VERSION')
    let offset = 8 + length
    const meshes: RawMesh[] = []
    for (const p of metadata.parts)
        for (const m of p.meshes) {
            if (
                !Number.isInteger(m.positions) ||
                m.positions < 0 ||
                m.positions % 3 ||
                !Number.isInteger(m.indices) ||
                m.indices < 0 ||
                m.indices % 3 ||
                offset + m.positions * 8 + m.indices * 4 > buffer.length
            )
                throw new Error('WORLD_ARTIFACT_INVALID')
            if (selected.includes(p.id)) {
                const positions = new Float64Array(m.positions),
                    indices = new Uint32Array(m.indices)
                positions.forEach((_, i) => (positions[i] = buffer.readDoubleLE(offset + i * 8)))
                indices.forEach((_, i) => (indices[i] = buffer.readUInt32LE(offset + m.positions * 8 + i * 4)))
                meshes.push({ ...m, positions, indices, instanceId: p.id + ':' + m.instanceId, reflected: false, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] })
            }
            offset += m.positions * 8 + m.indices * 4
        }
    if (offset !== buffer.length) throw new Error('WORLD_ARTIFACT_INVALID')
    return {
        format: 'stl',
        units: 'mm',
        sourceUnit: 'frozen-world-mm',
        scale: 1,
        meshes,
        limitations: [],
        rawTriangles: meshes.reduce((n, m) => n + m.indices.length / 3, 0),
        rawVertices: meshes.reduce((n, m) => n + m.positions.length / 3, 0),
    }
}
