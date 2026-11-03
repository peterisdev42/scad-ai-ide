import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { configureMeshTopologyWorker, queryMeshTopology } from '../../core/formats/meshTopology'
import { decodeFloats } from '../../core/preview/query'
import { zipSync, strToU8 } from 'fflate'
configureMeshTopologyWorker(resolve('dist/mesh-topology-worker.mjs'))
async function cubeStl() {
    const topology = JSON.parse(await readFile(new URL('./fixtures/prepared/cube.topology.json', import.meta.url), 'utf8')),
        positions = decodeFloats(topology.meshes[0].properties)
    let stl = 'solid cube\n'
    for (let i = 0; i < positions.length; i += 9) stl += `facet normal 0 0 0\nouter loop\n${[0, 3, 6].map((k) => `vertex ${Array.from(positions.subarray(i + k, i + k + 3)).join(' ')}`).join('\n')}\nendloop\nendfacet\n`
    return Buffer.from(stl + 'endsolid cube\n').toString('base64')
}
test('standalone STL clipping uses only the mesh worker and requires no CLI/exporter', async () => {
    const geometry = await queryMeshTopology(await cubeStl(), 'stl', undefined, [{ normal: [0, 0, -1], constant: 0 }])
    assert.equal(geometry.meshes.length, 1)
    const m = geometry.meshes[0],
        p = decodeFloats(m.properties)
    let low = Infinity,
        high = -Infinity
    for (let i = 2; i < p.length; i += m.stride) {
        low = Math.min(low, p[i])
        high = Math.max(high, p[i])
    }
    assert.equal(low, -10)
    assert.equal(high, 0)
})
test('standard 3MF colors, units and clipping stay independent from prepared previews', async () => {
    const xml = '<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><basematerials id="2"><base name="red" displaycolor="#FF0000FF"/></basematerials><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices><triangles><triangle v1="0" v2="2" v3="1" pid="2" p1="0"/><triangle v1="0" v2="1" v3="3" pid="2" p1="0"/><triangle v1="0" v2="3" v3="2" pid="2" p1="0"/><triangle v1="1" v2="2" v3="3" pid="2" p1="0"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>'
    const archive = zipSync({ '3D/3dmodel.model': strToU8(xml), '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') })
    const geometry = await queryMeshTopology(Buffer.from(archive).toString('base64'), '3mf', undefined, [{ normal: [0, 0, -1], constant: 5 }])
    assert.ok(geometry.meshes.length)
    const m = geometry.meshes[0],
        p = decodeFloats(m.properties)
    assert.equal(m.stride, 8)
    assert.ok(p.some((x, i) => i % m.stride === 3 && x > 0.99))
})
