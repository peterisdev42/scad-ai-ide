import type { Manifold, CrossSection, ManifoldToplevel, Vec2, Vec3, Mat3, Mat4 } from 'manifold-3d'
import { parseCsg, type CsgNode, type CsgValue } from './parser.js'
import type { CsgScene } from './types.js'

type Shape = { solid: Manifold } | { section: CrossSection }
type Paint = { rgba: number[]; defaultColor: boolean }

/** CSG evaluation runs only inside a cancellable Node worker, never the UI thread. */
export function evaluateCsg(source: string, module: ManifoldToplevel): CsgScene {
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
        const count = Math.max(3, Math.floor(num(p, '$fn') > 0 ? num(p, '$fn') : Math.max(5, Math.ceil(Math.min(360 / Math.max(num(p, '$fa', 12), 0.01), (2 * Math.PI * Math.abs(radius)) / Math.max(num(p, '$fs', 2), 0.01))))))
        if (count > 4096) throw new Error('Unsupported CSG operation: fragment count above 4096')
        return count
    }
    const painted = (solid: Manifold, paint: Paint): Shape => ({
        solid: own(
            solid.setProperties(5, (props) => {
                for (let i = 0; i < 4; i++) props[i] = paint.rgba[i]
                props[4] = paint.defaultColor ? 1 : 0
            }),
        ),
    })
    const combine = (items: Shape[], operation: 'union' | 'difference' | 'intersection' = 'union'): Shape | undefined => {
        if (!items.length) return undefined
        if (items.every((s) => 'solid' in s)) return { solid: own(M[operation](items.map((s) => s.solid))) }
        if (items.every((s) => 'section' in s)) return { section: own(C[operation](items.map((s) => s.section))) }
        throw new Error('Unsupported CSG operation: mixed 2D and 3D geometry')
    }
    const visit = (node: CsgNode, paint: Paint): Shape | undefined => {
        if (node.modifiers.includes('*')) return undefined
        if (node.modifiers.includes('!')) throw new Error('Unsupported CSG operation: root modifier')
        if (node.modifiers.includes('%') || node.modifiers.includes('#')) {
            const highlight = { rgba: node.modifiers.includes('#') ? [1, 0.2, 0.1, 0.65] : [0.6, 0.6, 0.6, 0.35], defaultColor: false }
            const result = visit({ ...node, modifiers: node.modifiers.replace(/[%#]/g, '') }, highlight)
            if (result && 'section' in result) throw new Error('Unsupported CSG operation: 2D preview modifier')
            if (result && 'solid' in result) {
                const overlay = painted(result.solid, highlight)
                if ('solid' in overlay) overlays.push(overlay.solid)
            }
            if (node.modifiers.includes('%')) return undefined
            return visit({ ...node, modifiers: node.modifiers.replace(/[%#]/g, '') }, paint)
        }
        const p = node.params
        if (node.name === 'color') {
            const color = p.c ?? p.$0
            const rgba = vector(Array.isArray(color) && color.length === 3 ? [...color, 1] : color, paint.rgba, 4)
            if (typeof p.c === 'string' || typeof p.$0 === 'string') throw new Error('Unsupported CSG operation: named color')
            return combine(node.children.map((child) => visit(child, { rgba: [...rgba.slice(0, 3), num(p, 'alpha', rgba[3])], defaultColor: false })).filter((s): s is Shape => !!s))
        }
        if (node.name === 'cube') {
            const size = vector(p.size ?? p.$0, [1, 1, 1]) as Vec3
            return size.some((n) => n <= 0) ? undefined : painted(own(M.cube(size, p.center === true)), paint)
        }
        if (node.name === 'sphere') {
            const r = num(p, 'r', num(p, 'd', 2) / 2)
            if (r <= 0) return undefined
            if (p.style !== undefined && p.style !== 'orig') throw new Error('Unsupported CSG operation: sphere style')
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
            const points = p.points as number[][],
                faces = (p.faces ?? p.triangles) as number[][]
            if (!Array.isArray(points) || !Array.isArray(faces)) throw new Error('Invalid CSG polyhedron.')
            const triangles: number[] = []
            for (const face of faces) {
                // OpenSCAD's polyhedron faces use clockwise winding viewed from outside.
                const contour = [...face].reverse().map((i) => points[i] as Vec3)
                if (face.length === 3) triangles.push(...[...face].reverse())
                else throw new Error('Unsupported CSG operation: non-triangular polyhedron face')
                if (!contour.every((v) => Array.isArray(v) && v.length === 3)) throw new Error('Invalid CSG polyhedron vertices.')
            }
            return painted(own(new M(new module.Mesh({ numProp: 3, vertProperties: new Float32Array(points.flat()), triVerts: new Uint32Array(triangles) }))), paint)
        }
        if (!['group', 'union', 'render', 'difference', 'intersection', 'hull', 'multmatrix', 'linear_extrude', 'rotate_extrude', 'offset', 'minkowski'].includes(node.name)) throw new Error(`Unsupported CSG operation: ${node.name}`)
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
        if (node.name === 'linear_extrude' && 'section' in child) {
            if (num(p, 'twist') !== 0) throw new Error('Unsupported CSG operation: twisted extrusion')
            if (p.v !== undefined && JSON.stringify(p.v) !== '[0,0,1]') throw new Error('Unsupported CSG operation: directed extrusion')
            const solid = own(child.section.extrude(num(p, 'height', 1), Math.max(0, num(p, 'slices', 1) - 1), -num(p, 'twist'), vector(p.scale, [1, 1]) as Vec2))
            return painted(p.center ? own(solid.translate([0, 0, -num(p, 'height', 1) / 2])) : solid, paint)
        }
        if (node.name === 'rotate_extrude' && 'section' in child) {
            const angle = num(p, 'angle', 360),
                bounds = child.section.bounds()
            if (angle <= 0 || angle > 360 || bounds.min[0] < 0) throw new Error('Unsupported CSG operation: signed rotational extrusion')
            const count = Math.max(1, Math.ceil((segments(p, bounds.max[0]) * angle) / 360))
            return painted(own(own(child.section.revolve(count, angle)).rotate([0, 0, num(p, 'start')])), paint)
        }
        if (node.name === 'offset' && 'section' in child) return { section: own(child.section.offset(num(p, 'r', num(p, 'delta', 1)), p.chamfer ? 'Square' : p.r === undefined ? 'Miter' : 'Round', 2, segments(p, Math.abs(num(p, 'r', 1))))) }
        if (node.name === 'minkowski' && 'solid' in child && children.every((s) => 'solid' in s)) {
            let solid = children[0].solid
            for (const next of children.slice(1)) solid = own(solid.minkowskiSum(next.solid))
            return { solid }
        }
        throw new Error(`Unsupported CSG operation: ${node.name}`)
    }
    try {
        const trees = parseCsg(source)
        const shape = combine(trees.map((node) => visit(node, { rgba: [1, 1, 1, 1], defaultColor: true })).filter((s): s is Shape => !!s))
        const solids = [...(shape ? ['solid' in shape ? shape.solid : own(shape.section.extrude(0.01))] : []), ...overlays]
        const meshes: CsgScene['meshes'] = []
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
