import type { Manifold, CrossSection, ManifoldToplevel, Vec2, Vec3, Mat3, Mat4 } from 'manifold-3d'
import { parseCsg, type CsgNode, type CsgValue } from './parser.js'
import type { CsgGeometry } from './types.js'
import { circularSegments } from './discretize.js'
import { Color, Matrix4, Quaternion, Vector3 } from 'three'
import type { Skeleton } from 'straight-skeleton'
import { linearExtrude } from './extrude.mjs'
import { octaSphere, rotateExtrude } from './curved.mjs'
import { polyhedronMesh } from './polyhedron.mjs'
import { initializeRoof, voronoiRoof } from './roof.mjs'

let skeletonBuilder: ((rings: number[][][]) => Skeleton | null) | undefined
export async function initializeGeometry(source: string) {
    if (/\broof\s*\(/.test(source)) await initializeRoof()
    if (/\broof\s*\(/.test(source) && !skeletonBuilder) {
        // This upstream CGAL build embeds its WASM and targets web workers.
        // Supply only the worker environment marker; external script loading is disabled.
        Object.assign(globalThis, {
            self: globalThis,
            importScripts: () => {
                throw new Error('External geometry scripts are disabled.')
            },
        })
        const { SkeletonBuilder } = await import('straight-skeleton')
        await SkeletonBuilder.init()
        skeletonBuilder = (rings) => SkeletonBuilder.buildFromPolygon(rings)
    }
}

type Shape = { solid: Manifold } | { section: CrossSection }
type Paint = { rgba: number[]; defaultColor: boolean }

/** CSG evaluation runs only inside a cancellable Node worker, never the UI thread. */
export function evaluateGeometry(source: string, module: ManifoldToplevel): CsgGeometry {
    const { Manifold: M, CrossSection: C } = module
    const owned = new Set<{ delete(): void }>()
    const own = <T extends { delete(): void }>(value: T): T => {
        owned.add(value)
        return value
    }
    const overlays: Manifold[] = []
    const num = (params: Record<string, CsgValue>, name: string, fallback = 0): number => (typeof params[name] === 'number' ? (params[name] as number) : fallback)
    const vector = (value: CsgValue | undefined, fallback: number[], size = fallback.length): number[] => {
        if (typeof value === 'number') return Array(size).fill(value)
        if (!Array.isArray(value) || value.length !== size || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) return fallback
        return value as number[]
    }
    const segments = (p: Record<string, CsgValue>, radius: number): number => {
        return circularSegments(p, radius)
    }
    const painted = (solid: Manifold, paint: Paint): Shape => ({
        solid: own(
            solid.setProperties(5, (props, _position, old) => {
                const preserve = paint.defaultColor && old.length >= 5 && old[4] < 0.5
                for (let i = 0; i < 4; i++) props[i] = preserve ? old[i] : paint.rgba[i]
                props[4] = preserve ? 0 : paint.defaultColor ? 1 : 0
            }),
        ),
    })
    const combine = (items: Shape[], operation: 'union' | 'difference' | 'intersection' = 'union'): Shape | undefined => {
        if (!items.length) return undefined
        if (items.length === 1) return items[0]
        if (items.every((s) => 'solid' in s)) return { solid: own(M[operation](items.map((s) => s.solid))) }
        if (items.every((s) => 'section' in s)) return { section: own(C[operation](items.map((s) => s.section))) }
        throw new Error('Unsupported CSG operation: mixed 2D and 3D geometry')
    }
    const visit = (node: CsgNode, paint: Paint): Shape | undefined => {
        if (node.modifiers.includes('*')) return undefined
        if (node.modifiers.includes('!')) throw new Error('Unsupported CSG operation: root modifier')
        // Native GeometryEvaluator ignores highlight inside an evaluated barrier
        // and excludes background children from its geometry.
        if (node.modifiers.includes('%')) return undefined
        if (node.modifiers.includes('#')) return visit({ ...node, modifiers: node.modifiers.replace(/#/g, '') }, paint)
        const p = node.params
        if (node.name === 'color') {
            const color = p.c ?? p.$0
            const rgba = vector(Array.isArray(color) && color.length === 3 ? [...color, 1] : color, paint.rgba, 4)
            if (typeof color === 'string') {
                const c = new Color(color)
                rgba.splice(0, 3, c.r, c.g, c.b)
            }
            return combine(node.children.map((child) => visit(child, paint.defaultColor ? { rgba: [...rgba.slice(0, 3), num(p, 'alpha', rgba[3])], defaultColor: false } : paint)).filter((s): s is Shape => !!s))
        }
        if (node.name === 'cube') {
            const size = vector(p.size ?? p.$0, [1, 1, 1]) as Vec3
            return size.some((n) => n <= 0) ? undefined : painted(own(M.cube(size, p.center === true)), paint)
        }
        if (node.name === 'sphere') {
            const r = num(p, 'r', num(p, 'd', 2) / 2)
            if (r <= 0) return undefined
            if (p.style === 'octa') return painted(own(octaSphere(r, segments(p, r), module)), paint)
            if (p.style !== undefined && p.style !== 'orig') throw new Error('Unsupported CSG sphere style.')
            // Latitude rings preserve OpenSCAD's half-step pole/equator placement.
            const count = segments(p, r),
                rings = Math.floor((count + 1) / 2)
            if (count * rings > 1000000) throw new Error('Unsupported CSG operation: sphere above one million vertices')
            const points: number[] = [],
                faces: number[] = []
            for (let row = 0; row < rings; row++) {
                const latitude = (Math.PI * (row + 0.5)) / rings
                for (let column = 0; column < count; column++) {
                    const longitude = (2 * Math.PI * column) / count
                    points.push(r * Math.sin(latitude) * Math.cos(longitude), r * Math.sin(latitude) * Math.sin(longitude), r * Math.cos(latitude))
                    if (row < rings - 1) {
                        const a = row * count + column,
                            b = row * count + ((column + 1) % count)
                        faces.push(a, a + count, b + count, a, b + count, b)
                    }
                }
            }
            const bottom = (rings - 1) * count
            for (let column = 1; column < count - 1; column++) faces.push(0, column, column + 1, bottom, bottom + column + 1, bottom + column)
            return painted(own(new M(new module.Mesh({ numProp: 3, vertProperties: new Float32Array(points), triVerts: new Uint32Array(faces) }))), paint)
        }
        if (node.name === 'cylinder') {
            const r = num(p, 'r', num(p, 'd', 2) / 2),
                r1 = num(p, 'r1', num(p, 'd1', r * 2) / 2),
                r2 = num(p, 'r2', num(p, 'd2', r * 2) / 2)
            if (num(p, 'h', 1) <= 0 || r1 < 0 || r2 < 0 || (r1 === 0 && r2 === 0)) return undefined
            return painted(own(M.cylinder(num(p, 'h', 1), r1, r2, segments(p, Math.max(r1, r2)), p.center === true)), paint)
        }
        if (node.name === 'square') return { section: own(C.square(vector(p.size ?? p.$0, [1, 1]) as Vec2, p.center === true)) }
        if (node.name === 'circle') {
            const r = num(p, 'r', num(p, 'd', 2) / 2)
            return { section: own(C.circle(r, segments(p, r))) }
        }
        if (node.name === 'polygon') {
            const points = p.points as number[][],
                paths = p.paths as number[][] | null
            if (!Array.isArray(points)) throw new Error('Invalid CSG polygon.')
            const contours = paths?.length ? paths.map((path) => path.map((i) => points[i] as Vec2)) : [points as Vec2[]]
            return { section: own(new C(contours, 'EvenOdd')) }
        }
        if (node.name === 'polyhedron') {
            const { mesh } = polyhedronMesh(node, module)
            const p = Buffer.from(mesh.properties, 'base64'),
                i = Buffer.from(mesh.indices, 'base64')
            const input = new module.Mesh({ numProp: mesh.stride, vertProperties: new Float32Array(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength)), triVerts: new Uint32Array(i.buffer.slice(i.byteOffset, i.byteOffset + i.byteLength)) })
            input.merge()
            return painted(own(new M(input)), paint)
        }
        if (!['group', 'union', 'render', 'difference', 'intersection', 'hull', 'multmatrix', 'linear_extrude', 'rotate_extrude', 'offset', 'minkowski', 'projection', 'resize', 'fill', 'roof', 'preview_center'].includes(node.name)) throw new Error(`Unsupported CSG operation: ${node.name}`)
        if (
            node.name === 'hull' &&
            node.children.some(function hasPolyhedron(node: CsgNode): boolean {
                return node.name === 'polyhedron' || node.children.some(hasPolyhedron)
            })
        ) {
            const points: Vec3[] = [],
                sections: CrossSection[] = []
            const collect = (child: CsgNode, matrix: Matrix4) => {
                if (/[%*]/.test(child.modifiers)) return
                if (child.name === 'polyhedron') {
                    const { mesh } = polyhedronMesh(child, module),
                        bytes = Buffer.from(mesh.properties, 'base64'),
                        indices = Buffer.from(mesh.indices, 'base64')
                    const used = new Set<number>()
                    for (let i = 0; i < indices.length; i += 4) used.add(indices.readUInt32LE(i))
                    for (const id of used) {
                        const offset = id * mesh.stride * 4
                        points.push(new Vector3(bytes.readFloatLE(offset), bytes.readFloatLE(offset + 4), bytes.readFloatLE(offset + 8)).applyMatrix4(matrix).toArray())
                    }
                    return
                }
                if (['group', 'union', 'color', 'multmatrix'].includes(child.name)) {
                    let transform = matrix
                    if (child.name === 'multmatrix') {
                        const rows = child.params.m ?? child.params.$0
                        if (!Array.isArray(rows) || rows.length !== 4 || rows.some((row) => !Array.isArray(row) || row.length !== 4 || row.some((v) => typeof v !== 'number' || !Number.isFinite(v)))) throw new Error('Invalid CSG transform.')
                        transform = matrix.clone().multiply(new Matrix4().fromArray((rows as number[][]).flat()).transpose())
                    }
                    child.children.forEach((node) => collect(node, transform))
                    return
                }
                const shape = visit(child, paint)
                if (!shape) return
                if ('section' in shape) {
                    sections.push(shape.section)
                    return
                }
                const mesh = shape.solid.getMesh()
                for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) points.push(new Vector3(...mesh.vertProperties.slice(i, i + 3)).applyMatrix4(matrix).toArray())
            }
            node.children.forEach((child) => collect(child, new Matrix4()))
            if (sections.length && points.length) throw new Error('Unsupported CSG operation: mixed 2D and 3D geometry')
            if (sections.length) return { section: own(C.hull(sections)) }
            return painted(own(M.hull(points)), paint)
        }
        const overlayStart = overlays.length
        const evaluated = node.children.map((child) => visit(child, paint))
        const operands = evaluated.filter((_shape, index) => !/[%*]/.test(node.children[index].modifiers))
        if (node.name === 'difference' && !operands[0]) return undefined
        if (node.name === 'intersection' && operands.some((shape) => !shape)) return undefined
        const children = operands.filter((s): s is Shape => !!s)
        if (['group', 'union', 'render'].includes(node.name)) return combine(children)
        if (node.name === 'difference' || node.name === 'intersection') return combine(children, node.name)
        const child = combine(children)
        if (node.name === 'hull') {
            if (children.every((s) => 'solid' in s)) return { solid: own(M.hull(children.map((s) => s.solid))) }
            if (children.every((s) => 'section' in s)) return { section: own(C.hull(children.map((s) => s.section))) }
        }
        if (node.name === 'multmatrix') {
            const matrix = (p.m ?? p.$0) as number[][]
            if (!Array.isArray(matrix) || matrix.length !== 4 || matrix.some((row) => !Array.isArray(row) || row.length !== 4 || row.some((n) => !Number.isFinite(n)))) throw new Error('Invalid CSG transform.')
            const transform = matrix[0].map((_, column) => matrix.map((row) => row[column])).flat() as Mat4
            for (let i = overlayStart; i < overlays.length; i++) overlays[i] = own(overlays[i].transform(transform))
            if (!child) return undefined
            if ('solid' in child) return { solid: own(child.solid.transform(transform)) }
            return { section: own(child.section.transform([matrix[0][0], matrix[1][0], 0, matrix[0][1], matrix[1][1], 0, matrix[0][3], matrix[1][3], 1] as Mat3)) }
        }
        if (!child) return undefined
        if (node.name === 'projection' && 'solid' in child) return { section: own(p.cut ? child.solid.slice(0) : child.solid.project()) }
        if (node.name === 'fill' && 'section' in child) {
            const contours = child.section.toPolygons().filter(
                (ring) =>
                    ring.reduce((area, v, i) => {
                        const b = ring[(i + 1) % ring.length]
                        return area + v[0] * b[1] - v[1] * b[0]
                    }, 0) > 0,
            )
            return { section: own(new C(contours, 'Positive')) }
        }
        if (node.name === 'resize' || node.name === 'preview_center') {
            const bounds = 'solid' in child ? child.solid.boundingBox() : child.section.bounds()
            const old = bounds.max.map((x, d) => x - bounds.min[d])
            if (node.name === 'preview_center') {
                const delta = old.map((_, d) => -(bounds.max[d] + bounds.min[d]) / 2)
                return 'solid' in child ? { solid: own(child.solid.translate(delta as Vec3)) } : { section: own(child.section.translate(delta as Vec2)) }
            }
            const target = vector(p.newsize, [0, 0, 0]),
                auto = Array.isArray(p.auto) ? p.auto : [p.auto, p.auto, p.auto]
            const ratios = old.map((v, d) => (target[d] > 0 && v > 0 ? target[d] / v : 0))
            const uniformRatio = ratios.find((r, d) => r > 0 && target[d] === Math.max(...target)) ?? ratios.find((r) => r > 0) ?? 1
            const scale = ratios.map((r, d) => r || (auto[d] ? uniformRatio : 1))
            return 'solid' in child ? { solid: own(child.solid.scale(scale as Vec3)) } : { section: own(child.section.scale(scale as Vec2)) }
        }
        if (node.name === 'linear_extrude' && 'section' in child) {
            return painted(own(linearExtrude(child.section, p, module)), paint)
        }
        if (node.name === 'rotate_extrude' && 'section' in child) {
            return painted(own(rotateExtrude(child.section, p, module)), paint)
        }
        if (node.name === 'offset' && 'section' in child) return { section: own(child.section.offset(num(p, 'r', num(p, 'delta', 1)), p.chamfer ? 'Square' : p.r === undefined ? 'Miter' : 'Round', 2, segments(p, Math.abs(num(p, 'r', 1))))) }
        if (node.name === 'minkowski' && 'solid' in child && children.every((s) => 'solid' in s)) {
            let solid = children[0].solid
            for (const next of children.slice(1)) solid = own(solid.minkowskiSum(next.solid))
            return { solid }
        }
        if (node.name === 'minkowski' && children.every((s) => 'section' in s)) {
            let sum = own(children[0].section.extrude(1))
            for (const next of children.slice(1)) sum = own(sum.minkowskiSum(own(next.section.extrude(1))))
            return { section: own(sum.slice(0.5)) }
        }
        if (node.name === 'roof' && 'section' in child) {
            if (!skeletonBuilder) throw new Error('Roof geometry kernel was not initialized.')
            const parts: Manifold[] = []
            for (const component of child.section.decompose()) {
                own(component)
                let rings: Vec2[][] = component.toPolygons()
                const native = p.method === 'straight' ? undefined : voronoiRoof(rings, p)
                if (native) rings = native.floor as Vec2[][]
                const skeleton = native
                    ? {
                          vertices: native.faces.flat(),
                          polygons: native.faces.map((face, i) => {
                              const offset = native.faces.slice(0, i).reduce((s, f) => s + f.length, 0)
                              return face.map((_, j) => offset + j)
                          }),
                      }
                    : skeletonBuilder(rings.map((ring) => [...ring, ring[0]]))
                if (!skeleton) throw new Error('Could not construct roof skeleton.')
                const points = skeleton.vertices.flat(),
                    faces: number[] = []
                for (const face of skeleton.polygons) {
                    const contour = face.map((i) => skeleton.vertices[i])
                    const normal = new Vector3()
                    contour.forEach((a, i) => {
                        const b = contour[(i + 1) % contour.length]
                        normal.x += (a[1] - b[1]) * (a[2] + b[2])
                        normal.y += (a[2] - b[2]) * (a[0] + b[0])
                        normal.z += (a[0] - b[0]) * (a[1] + b[1])
                    })
                    const axis = normal
                        .toArray()
                        .map(Math.abs)
                        .indexOf(Math.max(...normal.toArray().map(Math.abs)))
                    const dims = [(axis + 1) % 3, (axis + 2) % 3]
                    const ids = [...face],
                        projected = contour.map((v) => [v[dims[0]], v[dims[1]]] as Vec2)
                    if (normal.getComponent(axis) < 0) {
                        ids.reverse()
                        projected.reverse()
                    }
                    for (const tri of module.triangulate([projected])) {
                        const indices = tri.map((i) => ids[i])
                        faces.push(...(normal.getComponent(axis) < 0 ? indices.reverse() : indices))
                    }
                }
                const baseOffset = points.length / 3
                for (const ring of rings) for (const v of ring) points.push(v[0], v[1], 0)
                for (const tri of module.triangulate(rings)) faces.push(...tri.map((i) => i + baseOffset).reverse())
                const mesh = new module.Mesh({ numProp: 3, vertProperties: new Float32Array(points), triVerts: new Uint32Array(faces) })
                mesh.merge()
                parts.push(own(new M(mesh)))
            }
            return painted(own(M.union(parts)), paint)
        }
        throw new Error(`Unsupported CSG operation: ${node.name}`)
    }
    try {
        const trees = parseCsg(source)
        const shape = combine(trees.map((node) => visit(node, { rgba: [1, 1, 1, 1], defaultColor: true })).filter((s): s is Shape => !!s))
        const solids = [...(shape ? ['solid' in shape ? shape.solid : own(own(shape.section.extrude(1)).translate([0, 0, -0.5]))] : []), ...overlays]
        const meshes: CsgGeometry['meshes'] = []
        for (const solid of solids) {
            const status = solid.status()
            if (status !== 'NoError') throw new Error(`CSG geometry error: ${status}`)
            const mesh = solid.getMesh()
            if (mesh.triVerts.length) meshes.push({ properties: Buffer.from(mesh.vertProperties.buffer, mesh.vertProperties.byteOffset, mesh.vertProperties.byteLength).toString('base64'), indices: Buffer.from(mesh.triVerts.buffer, mesh.triVerts.byteOffset, mesh.triVerts.byteLength).toString('base64'), stride: mesh.numProp })
        }
        if (!meshes.length) throw new Error('CSG model is empty.')
        return { version: 1, meshes }
    } finally {
        for (const object of owned) object.delete()
    }
}
