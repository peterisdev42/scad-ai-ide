import assert from 'node:assert/strict'
import test from 'node:test'
import { zipSync, strToU8 } from 'fflate'
import { DOMParser } from 'linkedom'
import { Box3, Mesh, Vector3 } from 'three'
import { dxfDrawingSvg } from '../../core/formats/dxfDrawing'
import { parseExportMesh } from '../../core/formats/exportMesh.mjs'

const encode = (text: string) => new TextEncoder().encode(text).buffer

test('OpenSCAD OFF and POV polygons retain their shape, winding and face color', () => {
    const points = ['0 0 0', '4 0 0', '4 4 0', '2 2 0', '0 4 0']
    const face = points.map((point) => `<${point.split(' ').join(', ')}>`)
    const formats = [
        ['off', `OFF\n5 1 0\n${points.join('\n')}\n5 0 1 2 3 4 255 0 0\n`],
        ['pov', `polygon { 6, ${[...face, face[0]].join(', ')}\ntexture { pigment { color rgbf <1, 0, 0, 0> } }\n}\n`],
    ] as const
    for (const [format, source] of formats) {
        const [mesh] = parseExportMesh(format, encode(source)).children as Mesh[]
        const positions = mesh.geometry.getAttribute('position')
        const normals = mesh.geometry.getAttribute('normal')
        const colors = mesh.geometry.getAttribute('color')
        assert.equal(positions.count, 9)
        assert.deepEqual([normals.getZ(0), colors.getX(0), colors.getY(0)], [1, 1, 0])
        let area = 0
        for (let i = 0; i < positions.count; i += 3) {
            const a = new Vector3().fromBufferAttribute(positions, i)
            const b = new Vector3().fromBufferAttribute(positions, i + 1)
            const c = new Vector3().fromBufferAttribute(positions, i + 2)
            area += b.sub(a).cross(c.sub(a)).z / 2
        }
        assert.equal(area, 12)
    }
})

test('VRML, OBJ and legacy plain or compressed AMF produce mesh geometry', () => {
    Object.assign(globalThis, { DOMParser })
    const amf =
        '<amf unit="millimeter"><object id="0"><mesh><vertices>' +
        [
            [0, 0, 0],
            [4, 0, 0],
            [0, 4, 0],
        ]
            .map(([x, y, z]) => `<vertex><coordinates><x>${x}</x><y>${y}</y><z>${z}</z></coordinates></vertex>`)
            .join('') +
        '</vertices><volume><triangle><v1>0</v1><v2>1</v2><v3>2</v3></triangle></volume></mesh></object></amf>'
    const files = [
        ['obj', encode('v 0 0 0\nv 4 0 0\nv 0 4 0\nf 1 2 3\n')],
        ['wrl', encode('#VRML V2.0 utf8\nShape { geometry IndexedFaceSet { coord Coordinate { point [0 0 0, 4 0 0, 0 4 0] } coordIndex [0, 1, 2, -1] } }')],
        ['amf', encode(amf)],
        ['amf', new Uint8Array(zipSync({ 'model.amf': strToU8(amf) })).buffer],
    ] as const
    for (const [format, bytes] of files) {
        const box = new Box3().setFromObject(parseExportMesh(format, bytes))
        assert.deepEqual(box.getSize(new Vector3()).toArray(), [4, 4, 0], format)
    }
})

test('DXF preview retains separate outlines, inverts the vertical axis and checks invalid geometry', () => {
    const drawing = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '70', '1', '10', '0', '20', '0', '10', '10', '20', '0', '10', '10', '20', '15', '0', 'LINE', '10', '2', '20', '3', '11', '5', '21', '7', '0', 'ENDSEC', '0', 'EOF'].join('\r\n')
    const svg = dxfDrawingSvg(drawing)
    assert.match(svg, /M 0 0 L 10 0 L 10 -15 Z/)
    assert.match(svg, /M 2 -3 L 5 -7/)
    assert.throws(() => dxfDrawingSvg(drawing.replace('15', 'invalid')), /Invalid DXF drawing coordinate/)
})
