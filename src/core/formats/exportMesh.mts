import { unzipSync } from 'fflate'
import { BufferGeometry, Color, Float32BufferAttribute, Group, LoadingManager, Mesh, MeshStandardMaterial, ShapeUtils, SRGBColorSpace, Vector2, Vector3 } from 'three'
import { AMFLoader } from 'three/examples/jsm/loaders/AMFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { VRMLLoader } from 'three/examples/jsm/loaders/VRMLLoader.js'
import { ModelFormat, type MeshFormat } from '../../features/preview/shared/types/ModelFormat.js'

type ExportMeshFormat = Exclude<MeshFormat, ModelFormat.STL | ModelFormat.ThreeMF>

export function isExportMeshFormat(format: ModelFormat): format is ExportMeshFormat {
    return format === ModelFormat.OFF || format === ModelFormat.OBJ || format === ModelFormat.VRML || format === ModelFormat.AMF || format === ModelFormat.POV
}

/** Load the geometry written by OpenSCAD without resolving referenced assets. */
export function parseExportMesh(format: `${ExportMeshFormat}`, buffer: ArrayBuffer): Group {
    if (format === ModelFormat.AMF) return loadAmf(buffer)
    const source = new TextDecoder().decode(buffer)
    switch (format) {
        case ModelFormat.OBJ:
            return new OBJLoader().parse(source)
        case ModelFormat.VRML: {
            const manager = new LoadingManager().setURLModifier(() => {
                throw new Error('External textures are unavailable in VRML preview.')
            })
            // VRMLLoader returns a Scene whose children are ordinary Three.js objects.
            return new Group().add(new VRMLLoader(manager).parse(source, ''))
        }
        case ModelFormat.OFF:
            return loadOff(source)
        case ModelFormat.POV:
            return loadPov(source)
    }
    throw new Error(`Unsupported mesh format: ${format}`)
}

function loadAmf(buffer: ArrayBuffer): Group {
    const bytes = new Uint8Array(buffer)
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        let found = false
        const entries = unzipSync(bytes, {
            filter: ({ name, originalSize }) => {
                if (!/\.amf$/i.test(name)) return false
                if (found) throw new Error('The AMF archive must contain one model.')
                if (originalSize > 128 * 1024 * 1024) throw new Error('The compressed AMF model is too large to preview.')
                found = true
                return true
            },
        })
        const models = Object.values(entries)
        if (models.length !== 1) throw new Error('The AMF archive must contain one model.')
        buffer = new Uint8Array(models[0]).buffer
    }
    return new AMFLoader().parse(buffer)
}

function vertex(values: string[]): Vector3 {
    const [x, y, z] = values.map(Number)
    if (![x, y, z].every((value) => Number.isFinite(Math.fround(value)))) throw new Error('Invalid mesh vertex.')
    return new Vector3(x, y, z)
}

function color(values: string[], scale: number): Color | undefined {
    const [r, g, b] = values.map(Number)
    if ([r, g, b].every((value) => Number.isFinite(value) && value >= 0 && value <= scale)) {
        return new Color().setRGB(r / scale, g / scale, b / scale, SRGBColorSpace)
    }
}

function loadOff(source: string): Group {
    const rows = source
        .split(/\r?\n/)
        .map((line) => line.split('#', 1)[0].trim())
        .filter(Boolean)
        .map((line) => line.split(/\s+/))
    const header = rows.shift()
    if (header?.shift() !== 'OFF') throw new Error('Invalid OFF header.')
    const [vertexCount, faceCount] = (header.length ? header : (rows.shift() ?? [])).map(Number)
    if (!Number.isSafeInteger(vertexCount) || !Number.isSafeInteger(faceCount) || vertexCount < 1 || faceCount < 1 || vertexCount + faceCount > rows.length) {
        throw new Error('Invalid OFF vertex or face count.')
    }
    const points = rows.slice(0, vertexCount).map((row) => vertex(row.slice(0, 3)))
    const indices: number[] = []
    const colors: Array<Color | undefined> = []
    for (const row of rows.slice(vertexCount, vertexCount + faceCount)) {
        const count = Number(row[0])
        const face = row.slice(1, 1 + count).map(Number)
        if (!Number.isSafeInteger(count) || count < 3 || face.length !== count || face.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= points.length)) {
            throw new Error('Invalid OFF face.')
        }
        const rgb = row.slice(count + 1, count + 4)
        const faceColor = color(rgb, rgb.some((value) => /[.e]/i.test(value)) && rgb.every((value) => Number(value) <= 1) ? 1 : 255)
        for (const triangle of triangulate(face.map((index) => points[index]))) {
            indices.push(...triangle.map((index) => face[index]))
            colors.push(faceColor)
        }
    }
    return mesh(points, indices, colors)
}

function loadPov(source: string): Group {
    const points: Vector3[] = []
    const indices: number[] = []
    const colors: Array<Color | undefined> = []
    // The CLI writes closed polygon blocks followed by their material and camera settings.
    for (const body of source.split(/^[\t ]*polygon\s*\{/m).slice(1)) {
        const block = /^\s*(\d+)\s*,([^{}]+)/.exec(body)
        if (!block) throw new Error('Invalid OpenSCAD POV-Ray polygon.')
        const face = [...block[2].matchAll(/<([^>]+)>/g)].map((tuple) => vertex(tuple[1].split(',')))
        if (face.length < 4 || face.length !== Number(block[1]) || !face[0].equals(face.at(-1)!)) throw new Error('Invalid OpenSCAD POV-Ray polygon.')
        face.pop()
        const start = points.length
        const rgb = /\bcolor\s+rgbf\s*<([^>]+)>/.exec(body)?.[1].split(',').slice(0, 3)
        const faceColor = rgb && color(rgb, 1)
        for (const triangle of triangulate(face)) {
            indices.push(...triangle.map((index) => index + start))
            colors.push(faceColor)
        }
        for (const point of face) points.push(point)
    }
    return mesh(points, indices, colors)
}

function triangulate(points: Vector3[]): number[][] {
    if (points.length === 3) return [[0, 1, 2]]
    const normal = new Vector3()
    const edge = new Vector3()
    for (let i = 0; i < points.length; i++) normal.add(edge.crossVectors(points[i], points[(i + 1) % points.length]))
    const [x, y, z] = normal.toArray().map(Math.abs)
    const axis = x >= y && x >= z ? 'x' : y >= z ? 'y' : 'z'
    const projected = points.map((point) => (axis === 'x' ? new Vector2(point.y, point.z) : axis === 'y' ? new Vector2(point.z, point.x) : new Vector2(point.x, point.y)))
    return ShapeUtils.triangulateShape(projected, []).map((face) => (normal[axis] < 0 ? [face[0], face[2], face[1]] : face))
}

function mesh(points: Vector3[], indices: number[], colors: Array<Color | undefined>): Group {
    if (!indices.length) throw new Error('The file contains no mesh polygons.')
    const geometry = new BufferGeometry()
    const colored = colors.some(Boolean)
    if (colored) {
        const positions = new Float32Array(indices.length * 3)
        const vertexColors = new Float32Array(positions.length).fill(1)
        const themeDefaults = new Float32Array(indices.length)
        indices.forEach((index, i) => {
            points[index].toArray(positions, i * 3)
            const faceColor = colors[Math.floor(i / 3)]
            if (faceColor) faceColor.toArray(vertexColors, i * 3)
            else themeDefaults[i] = 1
        })
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
        geometry.setAttribute('color', new Float32BufferAttribute(vertexColors, 3))
        geometry.setAttribute('scadDefaultColor', new Float32BufferAttribute(themeDefaults, 1))
    } else {
        geometry.setAttribute(
            'position',
            new Float32BufferAttribute(
                points.flatMap((point) => point.toArray()),
                3,
            ),
        )
        geometry.setIndex(indices)
    }
    geometry.computeVertexNormals()
    const material = new MeshStandardMaterial({ vertexColors: colored })
    if (!colored) material.userData.previewThemeColor = 'additive'
    return new Group().add(new Mesh(geometry, material))
}
