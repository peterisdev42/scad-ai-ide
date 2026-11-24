type Point = readonly [x: number, y: number]
type Outline = { points: Point[]; closed?: boolean }
type Field = { code: string; value: string }

/** Draw the point, line and polyline entities emitted by OpenSCAD DXF exporters. */
export function dxfDrawingSvg(source: string): string {
    const lines = source.split(/\r?\n/)
    const outlines: Outline[] = []
    let inEntities = false
    let polyline: Outline | undefined
    for (let index = 0; index + 1 < lines.length;) {
        const code = lines[index++].trim()
        const type = lines[index++].trim()
        if (code !== '0') continue
        const fields: Field[] = []
        while (index + 1 < lines.length && lines[index].trim() !== '0') {
            fields.push({ code: lines[index++].trim(), value: lines[index++].trim() })
        }
        if (type === 'SECTION') inEntities = fields.some((field) => field.code === '2' && field.value === 'ENTITIES')
        else if (type === 'ENDSEC') {
            inEntities = false
            polyline = undefined
        }
        if (!inEntities) continue

        switch (type) {
            case 'POINT':
                outlines.push({ points: [point(fields, '10', '20')] })
                break
            case 'LINE':
                outlines.push({ points: [point(fields, '10', '20'), point(fields, '11', '21')] })
                break
            case 'LWPOLYLINE': {
                const xs = fields.filter((field) => field.code === '10')
                const ys = fields.filter((field) => field.code === '20')
                if (!xs.length || xs.length !== ys.length) throw new Error('Invalid DXF polyline coordinates.')
                outlines.push({ points: xs.map((field, i) => coordinates(field.value, ys[i].value)), closed: closed(fields) })
                break
            }
            case 'POLYLINE':
                polyline = { points: [], closed: closed(fields) }
                outlines.push(polyline)
                break
            case 'VERTEX':
                polyline?.points.push(point(fields, '10', '20'))
                break
            case 'SEQEND':
                polyline = undefined
                break
        }
    }

    let left = Infinity,
        top = Infinity,
        right = -Infinity,
        bottom = -Infinity
    for (const { points } of outlines)
        for (const [x, y] of points) {
            left = Math.min(left, x)
            right = Math.max(right, x)
            top = Math.min(top, -y)
            bottom = Math.max(bottom, -y)
        }
    const width = right - left,
        height = bottom - top
    if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('The DXF contains no viewable OpenSCAD drawing geometry.')
    const margin = Math.max(width, height, 1) * 0.05
    const geometry = outlines
        .filter(({ points }) => points.length)
        .map(({ points, closed }) => {
            if (points.length === 1) return `<circle cx="${points[0][0]}" cy="${-points[0][1]}" r="${margin / 12}" fill="#202124"/>`
            const path = points.map(([x, y]) => `${x} ${-y}`).join(' L ')
            return `<path d="M ${path}${closed ? ' Z' : ''}" vector-effect="non-scaling-stroke"/>`
        })
        .join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left - margin} ${top - margin} ${width + 2 * margin} ${height + 2 * margin}" fill="none" stroke="#202124" stroke-width="1.25">${geometry}</svg>`
}

function coordinates(rawX?: string, rawY?: string): Point {
    const x = Number(rawX),
        y = Number(rawY)
    if (!rawX || !rawY || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid DXF drawing coordinate.')
    return [x, y]
}

function point(fields: Field[], x: string, y: string): Point {
    return coordinates(fields.find((field) => field.code === x)?.value, fields.find((field) => field.code === y)?.value)
}

function closed(fields: Field[]): boolean {
    return Boolean(Number(fields.find((field) => field.code === '70')?.value) & 1)
}
