// OpenSCAD fe482c3 import_svg/libsvg display units and tessellation semantics.
// SPDX-License-Identifier: GPL-2.0-or-later
import { DOMParser } from 'linkedom'
import { EllipseCurve, Matrix3, Path, Vector2 } from 'three'
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'
import { circularSegments } from './discretize.js'
import type { CsgNode, CsgValue } from './parser.js'

interface SvgElement {
    localName: string
    getAttribute(name: string): string | null
    parentElement: SvgElement | null
}

const node = (name: string, params: Record<string, CsgValue> = {}, children: CsgNode[] = []): CsgNode => ({ name, params, children, modifiers: '' })
const polygon = (contours: number[][][]) => {
    const points: number[][] = [],
        paths = contours
            .filter((c) => c.length > 2)
            .map((c) =>
                c.map((v) => {
                    points.push(v)
                    return points.length - 1
                }),
            )
    return node('polygon', { points, paths })
}
const length = (value: string | null, viewbox: number, valid: boolean, dpi: number) => {
    if (value === null) return valid ? (25.4 * viewbox) / dpi : 0
    const match = /^\s*([+-]?[\d.]+)(\w+|%)?/.exec(value)
    if (!match) return 0
    const number = Number(match[1]),
        unit = match[2] ?? ''
    const factors: Record<string, number> = { '': 25.4 / dpi, px: 25.4 / 96, pt: 25.4 / 72, pc: 25.4 / 6, in: 25.4, cm: 10, mm: 1, '%': valid ? (25.4 * viewbox) / 100 / dpi : 0 }
    return number * (factors[unit] ?? (valid ? 1 : 0))
}
const style = (element: SvgElement, name: string, fallback: string) => element.getAttribute(name) ?? new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(element.getAttribute('style') ?? '')?.[1]?.trim() ?? fallback

export function svgGeometry(source: string, p: Record<string, CsgValue>): CsgNode {
    Object.assign(globalThis, { DOMParser })
    const document = new DOMParser().parseFromString(source, 'image/svg+xml'),
        root = document.documentElement
    if (root.localName !== 'svg') throw new Error('Invalid SVG document root.')
    const viewbox = (root.getAttribute('viewBox') ?? '')
            .trim()
            .split(/[\s,]+/)
            .map(Number),
        valid = viewbox.length === 4 && viewbox.every(Number.isFinite) && viewbox[2] > 0 && viewbox[3] > 0,
        dpi = typeof p.dpi === 'number' ? p.dpi : 72
    if (!(dpi > 0)) throw new Error('Invalid SVG DPI.')
    const width = length(root.getAttribute('width'), viewbox[2], valid, dpi),
        height = length(root.getAttribute('height'), viewbox[3], valid, dpi)
    let sx = valid ? width / viewbox[2] : 1,
        sy = valid ? height / viewbox[3] : 1,
        ax = 0,
        ay = 0
    const aspect = root.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet'
    if (valid && !aspect.includes('none')) {
        sx = sy = aspect.includes('slice') ? Math.max(sx, sy) : Math.min(sx, sy)
        ax = aspect.includes('xMax') ? width - sx * viewbox[2] : aspect.includes('xMin') ? 0 : (width - sx * viewbox[2]) / 2
        ay = aspect.includes('YMax') ? height - sy * viewbox[3] : aspect.includes('YMin') ? 0 : (height - sy * viewbox[3]) / 2
    }
    // libsvg interprets shape lengths as numbers; physical units belong to the page.
    for (const element of Array.from(root.querySelectorAll('*')))
        for (const attr of ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'r', 'rx', 'ry', 'cx', 'cy']) {
            const value = element.getAttribute(attr)
            if (value && Number.isFinite(parseFloat(value))) element.setAttribute(attr, String(parseFloat(value)))
        }
    // Use libsvg's ellipse phase and exact elliptical corner arcs rather than
    // SVGLoader's cubic approximation for rounded rectangles.
    for (const element of Array.from(document.querySelectorAll('circle,ellipse,rect') as ArrayLike<SvgElement & { attributes: ArrayLike<{ name: string; value: string }>; replaceWith(node: unknown): void }>)) {
        const n = (key: string, fallback = 0) => parseFloat(element.getAttribute(key) ?? String(fallback)) || 0
        let replacement
        if (element.localName === 'rect') {
            const x = n('x'),
                y = n('y'),
                w = n('width'),
                h = n('height'),
                rx = Math.min(n('rx', n('ry')), w / 2),
                ry = Math.min(n('ry', n('rx')), h / 2)
            if (!(rx > 0 && ry > 0)) continue
            replacement = document.createElement('path')
            for (const attribute of Array.from(element.attributes)) replacement.setAttribute(attribute.name, attribute.value)
            replacement.setAttribute('d', `M${x + rx},${y} H${x + w - rx} A${rx},${ry} 0 0 1 ${x + w},${y + ry} V${y + h - ry} A${rx},${ry} 0 0 1 ${x + w - rx},${y + h} H${x + rx} A${rx},${ry} 0 0 1 ${x},${y + h - ry} V${y + ry} A${rx},${ry} 0 0 1 ${x + rx},${y} Z`)
        } else {
            const cx = n('cx'),
                cy = n('cy'),
                rx = n('rx', n('r')),
                ry = n('ry', n('r')),
                count = Math.max(40, circularSegments(p, Math.max(rx, ry)))
            replacement = document.createElement('polygon')
            for (const attribute of Array.from(element.attributes)) replacement.setAttribute(attribute.name, attribute.value)
            replacement.setAttribute(
                'points',
                Array.from({ length: count }, (_, i) => {
                    const angle = ((i + 1) * Math.PI * 2) / count
                    return `${cx + rx * Math.sin(angle)},${cy + ry * Math.cos(angle)}`
                }).join(' '),
            )
        }
        element.replaceWith(replacement)
    }
    const svg = new SVGLoader().parse(document.toString()),
        rawGroups: number[][][][] = []
    const sample = (path: Path, element: SvgElement) => {
        const result: Vector2[] = []
        for (const curve of path.curves) {
            let count = curve.type === 'LineCurve' ? 1 : Math.max(20, typeof p.$fn === 'number' ? Math.trunc(p.$fn) : 0)
            if (curve instanceof EllipseCurve) {
                let angle = curve.aEndAngle - curve.aStartAngle
                if (Math.abs(angle) < 1e-12) angle = Math.PI * 2
                const degrees = (Math.abs(angle) * 180) / Math.PI
                count = /^(circle|ellipse)$/.test(element.localName) ? Math.max(40, circularSegments(p, Math.max(curve.xRadius, curve.yRadius))) : Math.max(circularSegments(p, Math.max(curve.xRadius, curve.yRadius), degrees), Math.floor((degrees * 10) / 180 + 4))
            }
            for (const point of curve.getPoints(count)) if (!result.length || !point.equals(result[result.length - 1])) result.push(point)
        }
        if (path.autoClose && result.length && !result[0].equals(result[result.length - 1])) result.push(result[0].clone())
        return result
    }
    for (const path of svg.paths) {
        const element = path.userData?.node as SvgElement | undefined
        if (!element) continue
        let id = !p.id,
            layer = !p.layer,
            hidden = false
        for (let parent: SvgElement | null = element; parent; parent = parent.parentElement) {
            if (parent.getAttribute('id') === p.id) id = true
            if (parent.getAttribute('inkscape:groupmode') === 'layer' && parent.getAttribute('inkscape:label') === p.layer) layer = true
            if (style(parent, 'display', '') === 'none') hidden = true
        }
        if (!id || !layer || hidden) continue
        const closed: number[][][] = []
        for (const subpath of path.subPaths) {
            const points = sample(subpath, element)
            if (points.length < 2) continue
            const isStroke = ['line', 'polyline'].includes(element.localName) || (!subpath.autoClose && points[0].distanceTo(points[points.length - 1]) > 0.1)
            if (!isStroke) {
                closed.push(points.map((v) => v.toArray()))
                continue
            }
            const transform = (path.userData?.transform as Matrix3 | undefined) ?? new Matrix3(),
                inverse = transform.clone().invert(),
                localPoints = points.map((v) => v.clone().applyMatrix3(inverse)),
                width = Math.max(0.01, parseFloat(style(element, 'stroke-width', '1')) || 1)
            const geometry = SVGLoader.pointsToStroke(localPoints, SVGLoader.getStrokeStyle(width, 'black', style(element, 'stroke-linejoin', 'miter'), style(element, 'stroke-linecap', 'butt'), 2), Math.max(4, Math.ceil(circularSegments(p, width / 2) / 4)), 1e-10)
            if (!geometry) continue
            const position = geometry.getAttribute('position')
            for (let i = 0; i < position.count; i += 3) rawGroups.push([[0, 1, 2].map((d) => new Vector2(position.getX(i + d), position.getY(i + d)).applyMatrix3(transform).toArray())])
            geometry.dispose()
        }
        if (closed.length) rawGroups.push(closed)
    }
    const points = rawGroups.flat(2),
        min = [Infinity, Infinity],
        max = [-Infinity, -Infinity]
    for (const point of points) {
        min[0] = Math.min(min[0], point[0] * sx)
        max[0] = Math.max(max[0], point[0] * sx)
        min[1] = Math.min(min[1], point[1] * sy)
        max[1] = Math.max(max[1], point[1] * sy)
    }
    const cx = p.center ? (min[0] + max[0]) / 2 : -ax,
        cy = p.center ? (min[1] + max[1]) / 2 : height - ay
    const vx = valid ? viewbox[0] * (root.getAttribute('width')?.endsWith('%') ? parseFloat(root.getAttribute('width')!) / 100 : 1) : 0,
        vy = valid ? viewbox[1] * (root.getAttribute('height')?.endsWith('%') ? parseFloat(root.getAttribute('height')!) / 100 : 1) : 0
    const geometries = rawGroups.map((contours) => polygon(contours.map((contour) => contour.map((v) => [sx * (v[0] - vx) - cx, sy * (-v[1] - vy) + cy]))))
    // Stroke triangles overlap at joins: union them locally rather than applying
    // even/odd fill across unrelated stroke triangles.
    return node('render', {}, [node('union', {}, geometries)])
}
