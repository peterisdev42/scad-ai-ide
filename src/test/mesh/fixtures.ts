import { strToU8, zipSync } from 'fflate'
import type { Vec3 } from '../../core/mesh/types'
export const boxFaces = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
]
export function box(size: Vec3 = [1, 1, 1], origin: Vec3 = [0, 0, 0]) {
    const points = [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1],
    ].map((p) => p.map((v, i) => v * size[i] + origin[i]) as Vec3)
    return boxFaces.map((face) => face.map((i) => points[i]))
}
export function stl(triangles = box(), ascii = false): Uint8Array {
    if (ascii) return strToU8('solid model\n' + triangles.map((t) => 'facet normal 0 0 0\nouter loop\n' + t.map((p) => 'vertex ' + p.join(' ')).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid model\n')
    const bytes = new Uint8Array(84 + triangles.length * 50),
        view = new DataView(bytes.buffer)
    view.setUint32(80, triangles.length, true)
    triangles.forEach((tri, t) => tri.flat().forEach((v, i) => view.setFloat32(84 + t * 50 + 12 + i * 4, v, true)))
    return bytes
}
export function threeMf(options: { unit?: string; transform?: string; extra?: string; required?: boolean; components?: boolean; build?: string } = {}) {
    const points = box().flat(),
        vertices = points.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join(''),
        triangles = Array.from({ length: 12 }, (_, i) => `<triangle v1="${i * 3}" v2="${i * 3 + 1}" v3="${i * 3 + 2}"/>`).join('')
    const model = `<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="${options.unit ?? 'millimeter'}"${options.required ? ' xmlns:x="urn:unsupported" requiredextensions="x"' : ''}><resources><object id="1"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>${options.components ? '<object id="2"><components><component objectid="1"/></components></object>' : ''}${options.extra ?? ''}</resources><build>${options.build ?? `<item objectid="${options.components ? '2' : '1'}"${options.transform ? ` transform="${options.transform}"` : ''}/>`}</build></model>`
    return zipSync({ '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/Models/main.model"/></Relationships>'), 'Models/main.model': strToU8(model) })
}
