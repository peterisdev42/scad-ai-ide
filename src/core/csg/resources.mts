import { readFile, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { extname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BufferGeometry, Mesh, Vector3 } from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js'
import { nefGeometry } from './nef.mjs'
import { svgGeometry } from './svg.mjs'
import { threeMfMillimeterScale } from '../formats/threeMf.js'
import { DOMParser } from 'linkedom'
import { PNG } from 'pngjs'
import { dxfContours } from './dxf.mjs'
import { circularSegments } from './discretize.js'
import { parseCsg, selectCsgRoots, type CsgNode, type CsgValue } from './parser.js'
import { serializeCsg } from './evaluate.mjs'

export interface ResolvedCsgFont {
    path: string
    index: number
}
export interface CsgResourceResolver {
    read(path: string): Promise<Uint8Array>
    font(pattern: string): Promise<string | ResolvedCsgFont>
    stamp(path: string): Promise<string>
    triangulate?: (contours: number[][][]) => number[][]
}

export const nodeResourceResolver: CsgResourceResolver = {
    read: readFile,
    stamp: async (path) => {
        const s = await stat(path)
        return `${s.mtimeMs}:${s.size}`
    },
    font: async (pattern) => {
        const liberation = /^(?:Liberation )?(Sans|Serif|Mono)(?::style=(.*))?$/i.exec(pattern || 'Sans')
        if (liberation) {
            const family = liberation[1][0].toUpperCase() + liberation[1].slice(1).toLowerCase()
            const style = /bold/i.test(liberation[2] ?? '') ? (/italic|oblique/i.test(liberation[2] ?? '') ? 'BoldItalic' : 'Bold') : /italic|oblique/i.test(liberation[2] ?? '') ? 'Italic' : 'Regular'
            return fileURLToPath(new URL(`./fonts/Liberation${family}-${style}.ttf`, import.meta.url))
        }
        if (/\.(?:ttf|otf|ttc)$/i.test(pattern)) return resolve(pattern)
        const matched = await new Promise<string | undefined>((done) => execFile('fc-match', ['-f', '%{file}\n%{index}', pattern || 'Liberation Sans'], { timeout: 3000 }, (error, stdout) => done(error ? undefined : stdout.trim())))
        if (matched) {
            const [path, index] = matched.split('\n')
            return { path, index: Number(index) || 0 }
        }
        const candidates = process.platform === 'win32' ? ['C:/Windows/Fonts/arial.ttf'] : process.platform === 'darwin' ? ['/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial Unicode.ttf'] : ['/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf']
        for (const candidate of candidates)
            try {
                await stat(candidate)
                return candidate
            } catch {
                /* try next installed font */
            }
        return fileURLToPath(new URL('./fonts/LiberationSans-Regular.ttf', import.meta.url))
    },
}

const node = (name: string, params: Record<string, CsgValue> = {}, children: CsgNode[] = []): CsgNode => ({ name, params, children, modifiers: '' })
const polygon = (contours: number[][][]) => {
    const points: number[][] = [],
        paths: number[][] = []
    for (const contour of contours.filter((c) => c.length > 2)) {
        paths.push(
            contour.map((point) => {
                points.push(point)
                return points.length - 1
            }),
        )
    }
    return node('polygon', { points, paths })
}

function polyhedron(geometry: BufferGeometry, transform?: Mesh['matrixWorld'], materials?: Mesh['material']): CsgNode {
    const positions = geometry.getAttribute('position'),
        indices = geometry.getIndex()
    const points: number[][] = [],
        remap: number[] = [],
        cache = new Map<string, number>()
    for (let i = 0; i < positions.count; i++) {
        const p = new Vector3().fromBufferAttribute(positions, i)
        if (transform) p.applyMatrix4(transform)
        const key = p.toArray().join(',')
        let id = cache.get(key)
        if (id === undefined) {
            id = points.length
            points.push(p.toArray())
            cache.set(key, id)
        }
        remap.push(id)
    }
    const faces: number[][] = [],
        face_colors: number[][] = []
    const vertexColors = geometry.getAttribute('color'),
        palette = materials ? (Array.isArray(materials) ? materials : [materials]) : []
    for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
        const face = [0, 1, 2].map((d) => remap[indices ? indices.getX(i + d) : i + d])
        faces.push(transform && transform.determinant() < 0 ? face : face.reverse())
        const group = geometry.groups.find((g) => i >= g.start && i < g.start + g.count),
            material = palette[group?.materialIndex ?? 0] as (Mesh['material'] & { color?: { r: number; g: number; b: number }; opacity?: number }) | undefined
        const v = indices ? indices.getX(i) : i
        face_colors.push(vertexColors ? [vertexColors.getX(v), vertexColors.getY(v), vertexColors.getZ(v), material?.opacity ?? 1] : material?.color ? [material.color.r, material.color.g, material.color.b, material.opacity ?? 1] : [1, 1, 1, 1])
    }
    return node('polyhedron', { points, faces, ...(vertexColors || palette.some((m) => 'color' in m) ? { face_colors } : {}) })
}

/** Prepare already-loaded standard meshes without file I/O or another CLI call. */
export function meshResource(bytes: Uint8Array, format: 'stl' | '3mf' | 'obj'): CsgNode {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    if (format === 'stl') return polyhedron(new STLLoader().parse(buffer))
    if (format === '3mf') Object.assign(globalThis, { DOMParser })
    const group = format === 'obj' ? new OBJLoader().parse(new TextDecoder().decode(bytes)) : new ThreeMFLoader().parse(buffer)
    if (format === '3mf') group.scale.multiplyScalar(threeMfMillimeterScale(bytes))
    group.updateMatrixWorld(true)
    const children: CsgNode[] = []
    group.traverse((object) => {
        if (object instanceof Mesh) children.push(polyhedron(object.geometry, object.matrixWorld, object.material))
    })
    return node('union', {}, children)
}

async function textGeometry(n: CsgNode, cwd: string, resolver: CsgResourceResolver, read: (path: string) => Promise<Uint8Array>): Promise<CsgNode> {
    const { textContours } = await import('./font.mjs')
    const pattern = String(n.params.font ?? '')
    const resolved = await resolver.font(/\.(?:ttf|otf|ttc|otc)$/i.test(pattern) ? resolve(cwd, pattern) : pattern)
    const font = typeof resolved === 'string' ? { path: resolved, index: 0 } : resolved
    const bytes = await read(font.path)
    return node('union', {}, (await textContours(bytes, n.params, font.index)).map(polygon))
}

function surfaceGeometry(bytes: Uint8Array, p: CsgNode['params']): CsgNode {
    let rows: number[][]
    if (bytes[0] === 137 && bytes[1] === 80) {
        const png = PNG.sync.read(Buffer.from(bytes), { skipRescale: true })
        rows = Array.from({ length: png.height }, (_, y) =>
            Array.from({ length: png.width }, (_, x) => {
                const i = ((png.height - 1 - y) * png.width + x) * 4
                const value = ((0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]) * 100) / (Number(png.colorType) === 3 ? 255 : 2 ** png.depth - 1)
                return p.invert ? -value : value
            }),
        )
    } else
        rows = new TextDecoder()
            .decode(bytes)
            .split(/\r?\n/)
            .map((s) => s.replace(/#.*/, '').trim())
            .filter(Boolean)
            .map((s) => s.split(/\s+/).map(Number))
    const h = rows.length,
        w = Math.max(0, ...rows.map((r) => r.length))
    if (h < 2 || w < 2 || rows.some((r) => r.length !== w || r.some((v) => !Number.isFinite(v)))) throw new Error('Invalid CSG surface data.')
    const low = Math.min(...rows.flat(), bytes[0] === 137 && bytes[1] === 80 ? Infinity : 1) - 1,
        ox = p.center ? -(w - 1) / 2 : 0,
        oy = p.center ? -(h - 1) / 2 : 0
    const points: number[][] = [],
        faces: number[][] = []
    const face = (vertices: number[][]) => {
        const ids = vertices.map((v) => {
            points.push(v)
            return points.length - 1
        })
        faces.push(ids.reverse())
    }
    for (let y = 0; y < h - 1; y++)
        for (let x = 0; x < w - 1; x++) {
            const corners = [
                [x + ox, y + oy, rows[y][x]],
                [x + 1 + ox, y + oy, rows[y][x + 1]],
                [x + 1 + ox, y + 1 + oy, rows[y + 1][x + 1]],
                [x + ox, y + 1 + oy, rows[y + 1][x]],
            ]
            const center = [x + ox + 0.5, y + oy + 0.5, corners.reduce((s, c) => s + c[2], 0) / 4]
            for (let i = 0; i < 4; i++) face([corners[i], corners[(i + 1) % 4], center])
        }
    const perimeter: number[][] = []
    for (let x = 0; x < w; x++) perimeter.push([x + ox, oy, rows[0][x]])
    for (let y = 1; y < h; y++) perimeter.push([w - 1 + ox, y + oy, rows[y][w - 1]])
    for (let x = w - 2; x >= 0; x--) perimeter.push([x + ox, h - 1 + oy, rows[h - 1][x]])
    for (let y = h - 2; y > 0; y--) perimeter.push([ox, y + oy, rows[y][0]])
    for (let i = 0; i < perimeter.length; i++) {
        const a = perimeter[i],
            b = perimeter[(i + 1) % perimeter.length]
        face([b, a, [a[0], a[1], low], [b[0], b[1], low]])
    }
    const bottomCenter = [ox + (w - 1) / 2, oy + (h - 1) / 2, low]
    for (let i = 0; i < perimeter.length; i++) {
        const a = perimeter[i],
            b = perimeter[(i + 1) % perimeter.length]
        face([[b[0], b[1], low], [a[0], a[1], low], bottomCenter])
    }
    // Merge shared positions before the local manifold kernel validates closure.
    const unique: number[][] = [],
        map = new Map<string, number>()
    const remap = points.map((p) => {
        const key = p.join(',')
        let id = map.get(key)
        if (id === undefined) {
            id = unique.length
            unique.push(p)
            map.set(key, id)
        }
        return id
    })
    return node('polyhedron', { points: unique, faces: faces.map((f) => f.map((i) => remap[i])) })
}

export async function prepareCsgResources(source: string, cwd: string, resolver = nodeResourceResolver): Promise<{ source: string; dependencies: { path: string; stamp: string }[] }> {
    const dependencies = new Map<string, string>()
    const read = async (path: string) => {
        const stamp = await resolver.stamp(path),
            bytes = await resolver.read(path)
        if ((await resolver.stamp(path)) !== stamp) throw new Error(`CSG resource changed while being read: ${path}`)
        dependencies.set(path, stamp)
        return bytes
    }
    const visit = async (n: CsgNode): Promise<CsgNode> => {
        if (n.modifiers.includes('*')) return n
        let result = n
        if (n.name === 'text') result = await textGeometry(n, cwd, resolver, read)
        if (n.name === 'surface' || n.name === 'import') {
            const file = String(n.params.file ?? n.params.filename ?? n.params.$0 ?? '')
            const path = isAbsolute(file) ? file : resolve(cwd, file)
            const bytes = await read(path),
                text = () => new TextDecoder().decode(bytes)
            if (n.name === 'surface') result = surfaceGeometry(bytes, n.params)
            else {
                const ext = extname(path).toLowerCase()
                if (['.stl', '.obj', '.3mf'].includes(ext)) result = meshResource(bytes, ext.slice(1) as 'stl' | 'obj' | '3mf')
                else if (ext === '.off') {
                    const tokens = text().replace(/#.*/g, '').trim().split(/\s+/)
                    if (tokens.shift() !== 'OFF') throw new Error('Invalid OFF header.')
                    const count = Number(tokens.shift()),
                        faceCount = Number(tokens.shift())
                    tokens.shift()
                    const points = Array.from({ length: count }, () => [Number(tokens.shift()), Number(tokens.shift()), Number(tokens.shift())])
                    const faces = Array.from({ length: faceCount }, () => Array.from({ length: Number(tokens.shift()) }, () => Number(tokens.shift())).reverse())
                    result = node('polyhedron', { points, faces })
                } else if (ext === '.svg') {
                    result = svgGeometry(text(), n.params)
                } else if (ext === '.nef3') {
                    if (!resolver.triangulate) throw new Error('NEF3 import requires the host triangulation kernel.')
                    result = nefGeometry(text(), resolver.triangulate)
                } else if (ext === '.dxf') {
                    result = polygon(dxfContours(text(), n.params))
                } else throw new Error(`Unsupported CSG import format: ${ext}`)
                if (n.params.center && ext !== '.svg' && ext !== '.nef3') {
                    // Centering is applied to the imported result by the local geometry adapter.
                    result = node('preview_center', {}, [result])
                }
            }
            result.modifiers = n.modifiers
        }
        if (result !== n) result.modifiers = n.modifiers
        return { ...result, children: await Promise.all(result.children.map(visit)) }
    }
    const trees = await Promise.all(selectCsgRoots(parseCsg(source)).map(visit))
    return { source: trees.map(serializeCsg).join(''), dependencies: [...dependencies].map(([path, stamp]) => ({ path, stamp })) }
}
