import { Unzip, UnzipInflate } from 'fflate'
import { SaxesParser } from 'saxes'
import { MeshInputError, meshLimits, type DecodedMesh, type RawMesh } from './types'
import { NumericReader, finiteNumber } from './decode'
const core = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
function fail(message: string): never {
    throw new MeshInputError('MESH_3MF_FORMAT', message)
}
function budget(message: string): never {
    throw new MeshInputError('MESH_3MF_BUDGET', message, true)
}
function zipPath(name: string) {
    if (
        !name ||
        name.length > 4096 ||
        name.startsWith('/') ||
        /[\\\x00:]/.test(name) ||
        name
            .replace(/\/$/, '')
            .split('/')
            .some((p) => !p || p === '.' || p === '..')
    )
        fail('Invalid archive part path.')
    return name
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
    return n >>> 0
})
function crc(bytes: Uint8Array) {
    let n = 0xffffffff
    for (const byte of bytes) n = crcTable[(n ^ byte) & 255] ^ (n >>> 8)
    return (n ^ 0xffffffff) >>> 0
}
/** Validate central sizes/CRC before and after bounded streaming decompression. */
function archive(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        utf8 = new TextDecoder('utf-8', { fatal: true })
    const safe = (n: bigint) => {
        if (n > BigInt(Number.MAX_SAFE_INTEGER)) budget('ZIP64 field exceeds safe range.')
        return Number(n)
    }
    let end = -1
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
        if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {
            end = i
            break
        }
    if (end < 0) fail('Missing ZIP directory.')
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail('Multi-disk archives are not supported.')
    let count = view.getUint16(end + 10, true),
        offset = view.getUint32(end + 16, true),
        directorySize = view.getUint32(end + 12, true)
    if (count === 65535 || offset === 0xffffffff || directorySize === 0xffffffff) {
        if (end < 20 || view.getUint32(end - 20, true) !== 0x07064b50) fail('Missing ZIP64 locator.')
        const at = safe(view.getBigUint64(end - 12, true))
        if (at + 56 > bytes.length || view.getUint32(at, true) !== 0x06064b50) fail('Invalid ZIP64 directory.')
        count = safe(view.getBigUint64(at + 32, true))
        directorySize = safe(view.getBigUint64(at + 40, true))
        offset = safe(view.getBigUint64(at + 48, true))
    }
    if (count > 4096) budget('Too many archive entries.')
    if (offset + directorySize > end) fail('ZIP directory exceeds archive.')
    const metadata = new Map<string, { bytes: number; crc: number }>()
    let cursor = offset,
        declared = 0,
        largest = 0
    for (let i = 0; i < count; i++) {
        if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) fail('Invalid ZIP entry.')
        const flags = view.getUint16(cursor + 8, true),
            method = view.getUint16(cursor + 10, true),
            nameSize = view.getUint16(cursor + 28, true),
            extraSize = view.getUint16(cursor + 30, true),
            commentSize = view.getUint16(cursor + 32, true)
        if (flags & 1) throw new MeshInputError('MESH_3MF_ENCRYPTED', 'Encrypted archive is unavailable.', true)
        if (method !== 0 && method !== 8) throw new MeshInputError('MESH_3MF_COMPRESSION', 'Unsupported archive compression.', true)
        if (cursor + 46 + nameSize + extraSize + commentSize > offset + directorySize) fail('Truncated ZIP entry.')
        const name = zipPath(utf8.decode(bytes.subarray(cursor + 46, cursor + 46 + nameSize)))
        let size = view.getUint32(cursor + 24, true)
        if (size === 0xffffffff) {
            let e = cursor + 46 + nameSize,
                found = false
            while (e + 4 <= cursor + 46 + nameSize + extraSize) {
                const length = view.getUint16(e + 2, true)
                if (e + 4 + length > cursor + 46 + nameSize + extraSize) fail('Malformed ZIP64 extra field.')
                if (view.getUint16(e, true) === 1 && length >= 8) {
                    size = safe(view.getBigUint64(e + 4, true))
                    found = true
                    break
                }
                e += 4 + length
            }
            if (!found) fail('ZIP64 entry has no expanded size.')
        }
        declared += size
        largest = Math.max(largest, size)
        if (declared + largest + bytes.length > meshLimits.arrayBytes) budget('Archive arrays exceed the 256 MiB budget.')
        if (declared > meshLimits.expandedBytes) budget('Expanded archive exceeds 256 MiB.')
        if (metadata.has(name)) fail('Duplicate ZIP entry.')
        metadata.set(name, { bytes: size, crc: view.getUint32(cursor + 16, true) })
        cursor += 46 + nameSize + extraSize + commentSize
    }
    if (cursor !== offset + directorySize) fail('Unexpected ZIP directory content.')
    const files = new Map<string, Uint8Array>(),
        seen = new Set<string>()
    let expanded = 0
    const unzip = new Unzip((file) => {
        const name = zipPath(file.name),
            info = metadata.get(name)
        if (!info || seen.has(name)) fail('ZIP local entries disagree with directory.')
        seen.add(name)
        const chunks: Uint8Array[] = []
        let size = 0
        file.ondata = (error, data, final) => {
            if (error) fail('ZIP decompression failed.')
            size += data.length
            expanded += data.length
            if (size > info.bytes || expanded > meshLimits.expandedBytes) {
                file.terminate()
                budget('Expanded archive exceeded its declared budget.')
            }
            chunks.push(data)
            if (final) {
                if (size !== info.bytes) fail('ZIP expanded size mismatch.')
                const joined = new Uint8Array(size)
                let at = 0
                for (const chunk of chunks) {
                    joined.set(chunk, at)
                    at += chunk.length
                }
                if (crc(joined) !== info.crc) fail('ZIP CRC mismatch.')
                files.set(name, joined)
            }
        }
        file.start()
    })
    unzip.register(UnzipInflate)
    // Chunking prevents a decompressor from returning an unbounded output batch.
    for (let at = 0; at < bytes.length; at += 65536) unzip.push(bytes.subarray(at, at + 65536), at + 65536 >= bytes.length)
    if (files.size !== metadata.size) fail('Archive has incomplete entries.')
    return files
}
type Attributes = Record<string, string>
function xml(bytes: Uint8Array, open: (name: string, uri: string, attributes: Attributes, namespaces: Record<string, string>) => void, close: (name: string, uri: string) => void = () => {}) {
    if (bytes.length > 32 * 1048576) budget('XML model exceeds 32 MiB.')
    const parser = new SaxesParser({ xmlns: true })
    let nodes = 0,
        depth = 0
    parser.on('doctype', () => fail('XML document types and external entities are forbidden.'))
    parser.on('error', () => fail('Malformed XML.'))
    parser.on('opentag', (tag) => {
        if (++nodes > 3000000 || ++depth > 128) budget('XML structure exceeds budget.')
        const attrs: Attributes = {}
        for (const attribute of Object.values(tag.attributes)) {
            if (!attribute.uri) attrs[attribute.local] = attribute.value
        }
        open(tag.local, tag.uri, attrs, tag.ns)
    })
    parser.on('closetag', (tag) => {
        close(tag.local, tag.uri)
        depth--
    })
    try {
        parser.write(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).close()
    } catch (error) {
        if (error instanceof MeshInputError) throw error
        fail('Invalid XML encoding or structure.')
    }
}
function partTarget(target: string) {
    let decoded: string
    try {
        decoded = decodeURIComponent(target)
    } catch {
        return fail('Invalid part URI.')
    }
    return zipPath(decoded.replace(/^\//, ''))
}
function multiply(a: number[], b: number[]) {
    const out = new Array<number>(12).fill(0)
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) for (let k = 0; k < 3; k++) out[row * 3 + col] += a[row * 3 + k] * b[k * 3 + col]
    for (let col = 0; col < 3; col++) {
        out[9 + col] = b[9 + col]
        for (let k = 0; k < 3; k++) out[9 + col] += a[9 + k] * b[k * 3 + col]
    }
    return out
}
function matrix(value?: string) {
    if (!value) return [...identity]
    const fields = value.trim().split(/\s+/)
    if (fields.length !== 12) fail('A transform requires 12 numbers.')
    return fields.map(finiteNumber)
}
function objectId(value?: string) {
    if (!value || !/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) fail('Invalid object resource ID.')
    return value
}
export function decodeThreeMf(bytes: Uint8Array): DecodedMesh {
    let files: Map<string, Uint8Array>
    try {
        files = archive(bytes)
    } catch (error) {
        if (error instanceof MeshInputError) throw error
        return fail('Malformed archive.')
    }
    const rels = files.get('_rels/.rels')
    if (!rels) fail('Missing package relationships.')
    let start: string | undefined
    xml(rels, (name, uri, attrs) => {
        if (name === 'Relationship' && uri === 'http://schemas.openxmlformats.org/package/2006/relationships' && attrs.Type === 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel') {
            if (start || attrs.TargetMode === 'External') fail('Invalid primary model relationship.')
            start = partTarget(attrs.Target ?? '')
        }
    })
    const model = start && files.get(start)
    if (!model) fail('Primary model part is missing.')
    interface ObjectData {
        id: string
        positions: number[]
        indices: number[]
        components: Array<{ id: string; matrix: number[] }>
        kind?: 'mesh' | 'components'
        verticesSeen?: boolean
        trianglesSeen?: boolean
    }
    const objects = new Map<string, ObjectData>(),
        builds: Array<{ id: string; matrix: number[] }> = [],
        numbers = new NumericReader()
    let current: ObjectData | undefined,
        rootSeen = false,
        resourcesSeen = false,
        buildSeen = false,
        unit = 'millimeter',
        rawVertices = 0,
        rawTriangles = 0
    const stack: string[] = []
    xml(
        model,
        (name, uri, attrs, namespaces) => {
            const parent = stack.at(-1)
            stack.push(`${uri}:${name}`)
            if (name === 'model' && uri === core) {
                if (rootSeen || stack.length !== 1) fail('Invalid model root.')
                rootSeen = true
                unit = attrs.unit ?? 'millimeter'
                for (const prefix of (attrs.requiredextensions ?? '').split(/\s+/).filter(Boolean)) if (namespaces[prefix] !== core) throw new MeshInputError('MESH_3MF_REQUIRED_EXTENSION', `Unsupported required extension: ${prefix}`, true)
            }
            if (uri !== core) return
            if (name === 'resources') {
                if (parent !== `${core}:model` || resourcesSeen || buildSeen) fail('Invalid resources node.')
                resourcesSeen = true
            }
            if (name === 'vertices' || name === 'triangles') {
                if (!current || current.kind !== 'mesh' || parent !== `${core}:mesh`) fail('Invalid mesh container hierarchy.')
                if (name === 'vertices') {
                    if (current.verticesSeen || current.trianglesSeen) fail('Invalid vertex array order.')
                    current.verticesSeen = true
                } else {
                    if (current.trianglesSeen || !current.verticesSeen) fail('Invalid triangle array order.')
                    current.trianglesSeen = true
                }
            }
            if (name === 'object') {
                if (parent !== `${core}:resources` || current) fail('Invalid object hierarchy.')
                const id = objectId(attrs.id)
                if (objects.has(id)) fail('Duplicate object resource.')
                if (objects.size >= meshLimits.objects) budget('Too many object resources.')
                current = { id, positions: [], indices: [], components: [] }
                objects.set(id, current)
                if (attrs.type && attrs.type !== 'model') numbers.limitations.add('NON_MODEL_OBJECT_TYPE')
            }
            if (name === 'mesh' || name === 'components') {
                if (!current || parent !== `${core}:object` || current.kind) fail('Object requires one mesh or components node.')
                current.kind = name
            }
            if (name === 'vertex') {
                if (!current || parent !== `${core}:vertices` || current.kind !== 'mesh') fail('Vertex outside mesh.')
                if (++rawVertices > meshLimits.vertices) budget('Vertex budget exceeded.')
                current.positions.push(numbers.read(attrs.x ?? ''), numbers.read(attrs.y ?? ''), numbers.read(attrs.z ?? ''))
            }
            if (name === 'triangle') {
                if (!current || parent !== `${core}:triangles` || current.kind !== 'mesh') fail('Triangle outside mesh.')
                if (++rawTriangles > meshLimits.triangles) budget('Triangle budget exceeded.')
                for (const key of ['v1', 'v2', 'v3']) {
                    const value = attrs[key]
                    if (!/^\d+$/.test(value ?? '') || Number(value) > 2147483647) fail('Invalid triangle index.')
                    current.indices.push(Number(value))
                }
            }
            if (name === 'component') {
                if (!current || parent !== `${core}:components`) fail('Component outside components node.')
                current.components.push({ id: objectId(attrs.objectid), matrix: matrix(attrs.transform) })
                if (current.components.length > meshLimits.objects) budget('Component count exceeded.')
            }
            if (name === 'build') {
                if (parent !== `${core}:model` || buildSeen || !resourcesSeen) fail('Invalid build node.')
                buildSeen = true
            }
            if (name === 'item') {
                if (parent !== `${core}:build`) fail('Build item outside build.')
                builds.push({ id: objectId(attrs.objectid), matrix: matrix(attrs.transform) })
                if (builds.length > meshLimits.objects) budget('Too many build instances.')
            }
        },
        (name, uri) => {
            if (uri === core && name === 'object') {
                if (!current?.kind || (current.kind === 'mesh' && (!current.verticesSeen || !current.trianglesSeen)) || (current.kind === 'components' && !current.components.length)) fail('Object geometry is incomplete.')
                current = undefined
            }
            stack.pop()
        },
    )
    if (!rootSeen || !buildSeen) fail('Missing model/build structure.')
    const scales: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 },
        scale = scales[unit]
    if (!scale) throw new MeshInputError('MESH_3MF_UNIT', 'Unknown 3MF unit.', true)
    const archiveBytes = bytes.length + [...files.values()].reduce((n, file) => n + file.length, 0)
    const meshes: RawMesh[] = []
    let expandedVertices = 0,
        expandedTriangles = 0
    const visit = (id: string, transform: number[], path: string[], instance: string) => {
        if (path.includes(id)) fail('Component reference cycle.')
        if (path.length >= 64) budget('Component nesting exceeds budget.')
        const object = objects.get(id)
        if (!object) fail('Missing object reference.')
        if (object.kind === 'components') {
            for (let i = 0; i < object.components.length; i++) {
                const c = object.components[i]
                visit(c.id, multiply(c.matrix, transform), [...path, id], `${instance}/${i}:${c.id}`)
            }
            return
        }
        if (object.kind !== 'mesh') fail('Object has no geometry.')
        expandedVertices += object.positions.length / 3
        expandedTriangles += object.indices.length / 3
        if (archiveBytes + expandedVertices * 24 + expandedTriangles * 12 > meshLimits.arrayBytes) budget('Decoded arrays exceed 256 MiB.')
        if (expandedVertices > meshLimits.vertices || expandedTriangles > meshLimits.triangles || meshes.length >= meshLimits.objects) budget('Expanded instance geometry exceeds budget.')
        const determinant = transform[0] * (transform[4] * transform[8] - transform[5] * transform[7]) - transform[1] * (transform[3] * transform[8] - transform[5] * transform[6]) + transform[2] * (transform[3] * transform[7] - transform[4] * transform[6])
        const norm = Math.max(...transform.slice(0, 9).map(Math.abs)),
            reflected = determinant < 0
        if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-12 * norm ** 3) numbers.limitations.add('NUMERIC_SINGULAR_TRANSFORM')
        const positions = new Float64Array(object.positions.length),
            indices = Uint32Array.from(object.indices),
            transformed = new Map<string, string>()
        for (let v = 0; v < positions.length; v += 3) {
            for (let c = 0; c < 3; c++) {
                positions[v + c] = (object.positions[v] * transform[c] + object.positions[v + 1] * transform[3 + c] + object.positions[v + 2] * transform[6 + c] + transform[9 + c]) * scale
                if (!Number.isFinite(positions[v + c])) throw new MeshInputError('NUMERIC_TRANSFORM_OVERFLOW', 'Transformed coordinate exceeds numeric range.', true)
            }
            const key = `${positions[v]},${positions[v + 1]},${positions[v + 2]}`,
                original = object.positions.slice(v, v + 3).join(','),
                prior = transformed.get(key)
            if (prior !== undefined && prior !== original) numbers.limitations.add('NUMERIC_TRANSFORM_COLLAPSE')
            transformed.set(key, original)
        }
        for (let t = 0; t < indices.length; t += 3) {
            if ([indices[t], indices[t + 1], indices[t + 2]].some((i) => i >= positions.length / 3)) fail('Triangle index is outside vertex array.')
            if (reflected) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]]
        }
        meshes.push({ positions, indices, instanceId: instance, objectId: id, transform, reflected })
    }
    for (let i = 0; i < builds.length; i++) visit(builds[i].id, builds[i].matrix, [], `${i}:${builds[i].id}`)
    return { expandedBytes: archiveBytes, meshes, format: '3mf', units: 'mm', sourceUnit: unit, scale, limitations: [...numbers.limitations], rawVertices, rawTriangles }
}
