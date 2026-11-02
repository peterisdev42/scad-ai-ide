import { Matrix3, SplineCurve, Vector2, Vector4 } from 'three'
import { NURBSCurve } from 'three/addons/curves/NURBSCurve.js'
import DxfModule from 'dxf-parser'
import type { IDxf } from 'dxf-parser'
import type { CsgValue } from './parser.js'
import { circularSegments } from './discretize.js'
const DxfParser = DxfModule as unknown as new () => { parseSync(source: string): IDxf | null }

interface Entity {
    type: string
    layer?: string
    vertices?: { x: number; y: number; bulge?: number }[]
    shape?: boolean
    closed?: boolean
    center?: { x: number; y: number }
    radius?: number
    startAngle?: number
    endAngle?: number
    angleLength?: number
    majorAxisEndPoint?: { x: number; y: number }
    axisRatio?: number
    controlPoints?: { x: number; y: number; z?: number }[]
    fitPoints?: { x: number; y: number }[]
    knotValues?: number[]
    degreeOfSplineCurve?: number
    name?: string
    position?: { x: number; y: number }
    xScale?: number
    yScale?: number
    rotation?: number
    rowCount?: number
    columnCount?: number
    rowSpacing?: number
    columnSpacing?: number
    extrusionDirectionZ?: number
}

export function dxfContours(source: string, p: Record<string, CsgValue>): number[][][] {
    const drawing = new DxfParser().parseSync(source)
    if (!drawing) throw new Error('Invalid DXF document.')
    const segments: number[][][] = [],
        finished: number[][][] = []
    const sample = (radius: number, angle: number, point: (t: number) => number[]) => {
        const count = circularSegments(p, radius, (angle * 180) / Math.PI)
        return Array.from({ length: count + 1 }, (_, i) => point(i / count))
    }
    const visit = (entities: Entity[], matrix: Matrix3, depth = 0) => {
        if (depth > 64) throw new Error('DXF block nesting limit exceeded.')
        for (const e of entities) {
            if (p.layer && e.layer !== p.layer && e.layer !== '0') continue
            let contour: number[][] = []
            if (e.type === 'INSERT') {
                const block = drawing.blocks[e.name ?? '']
                if (!block) throw new Error(`Missing DXF block: ${e.name}`)
                for (let row = 0; row < (e.rowCount ?? 1); row++)
                    for (let col = 0; col < (e.columnCount ?? 1); col++) {
                        const angle = ((e.rotation ?? 0) * Math.PI) / 180,
                            c = Math.cos(angle),
                            s = Math.sin(angle),
                            sx = e.xScale ?? 1,
                            sy = e.yScale ?? 1
                        const transform = new Matrix3().set(c * sx, -s * sy, (e.position?.x ?? 0) + col * (e.columnSpacing ?? 0), s * sx, c * sy, (e.position?.y ?? 0) + row * (e.rowSpacing ?? 0), 0, 0, 1)
                        const base = block.position
                        transform.multiply(new Matrix3().set(1, 0, -(base?.x ?? 0), 0, 1, -(base?.y ?? 0), 0, 0, 1))
                        visit(block.entities as unknown as Entity[], matrix.clone().multiply(transform), depth + 1)
                    }
                continue
            }
            if (e.type === 'CIRCLE' || e.type === 'ARC') {
                if (!e.center || !e.radius) continue
                const start = e.type === 'CIRCLE' ? 0 : (e.startAngle ?? 0)
                let angle = e.type === 'CIRCLE' ? Math.PI * 2 : (e.angleLength ?? (e.endAngle ?? 0) - start)
                if (angle <= 0) angle += Math.PI * 2
                contour = sample(e.radius, angle, (t) => [e.center!.x + e.radius! * Math.cos(start + t * angle), e.center!.y + e.radius! * Math.sin(start + t * angle)])
            } else if (e.type === 'ELLIPSE') {
                if (!e.center || !e.majorAxisEndPoint) throw new Error('Invalid DXF ellipse.')
                const a = e.majorAxisEndPoint,
                    ratio = e.axisRatio ?? 1,
                    start = e.startAngle ?? 0,
                    angle = (e.endAngle ?? Math.PI * 2) - start
                contour = sample(Math.hypot(a.x, a.y), angle, (t) => {
                    const u = start + t * angle,
                        c = Math.cos(u),
                        s = Math.sin(u)
                    return [e.center!.x + a.x * c - a.y * ratio * s, e.center!.y + a.y * c + a.x * ratio * s]
                })
            } else if (e.type === 'SPLINE') {
                if (e.controlPoints?.length && e.knotValues?.length) {
                    const curve = new NURBSCurve(
                        e.degreeOfSplineCurve ?? 3,
                        e.knotValues,
                        e.controlPoints.map((v) => new Vector4(v.x, v.y, v.z ?? 0, 1)),
                        e.degreeOfSplineCurve ?? 3,
                        e.knotValues.length - (e.degreeOfSplineCurve ?? 3) - 1,
                    )
                    const count = typeof p.$fn === 'number' && p.$fn > 0 ? Math.max(3, Math.floor(p.$fn)) : Math.max(8, e.controlPoints.length * 8)
                    contour = curve.getPoints(count).map((v) => [v.x, v.y])
                } else if (e.fitPoints?.length) {
                    const curve = new SplineCurve(e.fitPoints.map((v) => new Vector2(v.x, v.y)))
                    contour = curve.getPoints(Math.max(8, e.fitPoints.length * 8)).map((v) => v.toArray())
                } else throw new Error('Invalid DXF spline.')
            } else if (['LINE', 'LWPOLYLINE', 'POLYLINE', 'SOLID', '3DFACE'].includes(e.type) && e.vertices?.length) {
                const vertices = e.vertices,
                    closed = e.shape || e.closed || e.type === 'SOLID' || e.type === '3DFACE'
                const count = closed ? vertices.length : vertices.length - 1
                for (let i = 0; i < count; i++) {
                    const a = vertices[i],
                        b = vertices[(i + 1) % vertices.length],
                        bulge = a.bulge ?? 0
                    if (!bulge) contour.push([a.x, a.y])
                    else {
                        const dx = b.x - a.x,
                            dy = b.y - a.y,
                            center = [(a.x + b.x) / 2 - (dy * (1 - bulge * bulge)) / (4 * bulge), (a.y + b.y) / 2 + (dx * (1 - bulge * bulge)) / (4 * bulge)]
                        const radius = (Math.hypot(dx, dy) * (1 + bulge * bulge)) / (4 * Math.abs(bulge)),
                            start = Math.atan2(a.y - center[1], a.x - center[0]),
                            angle = 4 * Math.atan(bulge)
                        contour.push(...sample(radius, angle, (t) => [center[0] + radius * Math.cos(start + t * angle), center[1] + radius * Math.sin(start + t * angle)]).slice(0, -1))
                    }
                }
                contour.push(closed ? contour[0] : [vertices[vertices.length - 1].x, vertices[vertices.length - 1].y])
            } else throw new Error(`Unsupported DXF entity: ${e.type}`)
            contour = contour.map((v) => new Vector2(e.extrusionDirectionZ === -1 ? -v[0] : v[0], v[1]).applyMatrix3(matrix).toArray())
            if (contour.length > 1) segments.push(contour)
        }
    }
    visit(drawing.entities as unknown as Entity[], new Matrix3())
    const equal = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-7
    while (segments.length) {
        const chain = segments.pop()!
        while (!equal(chain[0], chain[chain.length - 1])) {
            const end = chain[chain.length - 1],
                index = segments.findIndex((s) => equal(end, s[0]) || equal(end, s[s.length - 1]))
            if (index < 0) throw new Error('DXF contains an open contour with no solid area.')
            const next = segments.splice(index, 1)[0]
            if (!equal(end, next[0])) next.reverse()
            chain.push(...next.slice(1))
        }
        chain.pop()
        if (chain.length >= 3) finished.push(chain)
    }
    const origin = Array.isArray(p.origin) ? (p.origin as number[]) : [0, 0],
        scale = typeof p.scale === 'number' ? p.scale : 1
    return finished.map((r) => r.map((v) => [(v[0] - origin[0]) * scale, (v[1] - origin[1]) * scale]))
}
