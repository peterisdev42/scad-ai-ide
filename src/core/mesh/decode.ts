import { MeshInputError, meshLimits, type DecodedMesh, type RawMesh } from './types'
import { decodeThreeMf } from './threeMf'
export function finiteNumber(token: string): number {
    if (token.length > 256 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) throw new MeshInputError('MESH_NUMBER_INVALID', 'Invalid mesh numeric token.')
    const value = Number(token)
    if (!Number.isFinite(value)) throw new MeshInputError('MESH_NONFINITE', 'Mesh coordinates must be finite.')
    return Object.is(value, -0) ? 0 : value
}
/** Preserve decimal equivalence independently of floating point decoding. */
export function decimalIdentity(token: string): string {
    const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(token)!
    let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, ''),
        exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0)
    if (!digits) return '0'
    while (digits.endsWith('0')) {
        digits = digits.slice(0, -1)
        exponent++
    }
    return `${match[1] === '-' ? '-' : ''}${digits}e${exponent}`
}
export class NumericReader {
    readonly limitations = new Set<string>()
    private seen = new Map<number, string>()
    read(token: string) {
        const value = finiteNumber(token),
            identity = decimalIdentity(token),
            prior = this.seen.get(value)
        if (prior !== undefined && prior !== identity) this.limitations.add('NUMERIC_QUANTIZATION_COLLAPSE')
        if (value === 0 && identity !== '0') this.limitations.add('NUMERIC_UNDERFLOW')
        if (this.seen.size < meshLimits.vertices * 3) this.seen.set(value, identity)
        else this.limitations.add('NUMERIC_IDENTITY_BUDGET')
        return value
    }
}
function decodeStl(bytes: Uint8Array): DecodedMesh {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        decoder = new TextDecoder('utf-8', { fatal: true })
    const count = bytes.length >= 84 ? view.getUint32(80, true) : 0
    let positions: Float64Array,
        indices: Uint32Array,
        limitations: string[] = []
    if (bytes.length >= 84 && 84 + count * 50 === bytes.length) {
        if (count > meshLimits.triangles) throw new MeshInputError('MESH_TRIANGLE_BUDGET', 'Triangle count exceeds the analysis budget.', true)
        positions = new Float64Array(count * 9)
        indices = new Uint32Array(count * 3)
        for (let t = 0; t < count; t++) {
            for (let i = 0; i < 12; i++) {
                const value = view.getFloat32(84 + t * 50 + i * 4, true)
                if (!Number.isFinite(value)) throw new MeshInputError('MESH_NONFINITE', `Non-finite STL data at triangle ${t}.`)
                if (i >= 3) positions[t * 9 + i - 3] = value === 0 ? 0 : value
            }
            indices.set([t * 3, t * 3 + 1, t * 3 + 2], t * 3)
        }
    } else {
        let text: string
        try {
            text = decoder.decode(bytes)
        } catch {
            throw new MeshInputError('MESH_STL_LENGTH', 'Binary STL length does not match its triangle count.')
        }
        const header = /^\s*solid[^\r\n]*\r?\n/.exec(text),
            end = /(?:^|\r?\n)\s*endsolid[^\r\n]*\s*$/.exec(text)
        if (!header || !end || end.index < header[0].length) throw new MeshInputError('MESH_STL_FORMAT', 'Malformed or truncated STL.')
        const body = text.slice(header[0].length, end.index),
            values: number[] = [],
            numbers = new NumericReader()
        const facet = /\s*facet\s+normal\s+(\S+)\s+(\S+)\s+(\S+)\s+outer\s+loop\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+endloop\s+endfacet/iy
        let offset = 0
        while (offset < body.length) {
            if (!body.slice(offset).trim()) break
            if (values.length / 9 >= meshLimits.triangles) throw new MeshInputError('MESH_TRIANGLE_BUDGET', 'Triangle count exceeds the analysis budget.', true)
            facet.lastIndex = offset
            const match = facet.exec(body)
            if (!match) throw new MeshInputError('MESH_STL_FORMAT', 'Malformed ASCII STL facet.')
            for (const token of match.slice(1, 4)) finiteNumber(token)
            for (const token of match.slice(4)) values.push(numbers.read(token))
            offset = facet.lastIndex
        }
        positions = Float64Array.from(values)
        indices = Uint32Array.from({ length: values.length / 3 }, (_, i) => i)
        limitations = [...numbers.limitations]
    }
    const mesh: RawMesh = { positions, indices, instanceId: 'stl:0', objectId: 'stl', transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], reflected: false }
    return { meshes: [mesh], format: 'stl', units: 'modelUnits', sourceUnit: 'undeclared', scale: 1, limitations, rawVertices: positions.length / 3, rawTriangles: indices.length / 3 }
}
export function decodeMesh(bytes: Uint8Array, format: 'stl' | '3mf'): DecodedMesh {
    if (bytes.length > meshLimits.inputBytes) throw new MeshInputError('MESH_INPUT_BUDGET', 'Input exceeds 128 MiB.', true)
    return format === 'stl' ? decodeStl(bytes) : decodeThreeMf(bytes)
}
