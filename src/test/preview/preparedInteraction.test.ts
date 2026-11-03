import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three'
import { ModelRepresentation } from '../../features/preview/webview/preview/models/ModelRepresentation'
import { decodeFloats } from '../../core/preview/query'

test('standard mesh picking and measurement follow translation and nonuniform scaling without native queries', async () => {
    const mesh = new Mesh(new BoxGeometry(20, 20, 20), new MeshStandardMaterial()),
        group = new Group()
    group.add(mesh)
    mesh.position.x = 10
    mesh.scale.x = 2
    group.updateMatrixWorld(true)
    let queries = 0
    const representation = new ModelRepresentation(group, 1, async () => {
        queries++
        throw new Error('Unexpected native query')
    })
    const hits = representation.pick(new Raycaster(new Vector3(40, 0, 0), new Vector3(-1, 0, 0))).value
    assert.equal(hits[0].point.x, 30)
    assert.equal(hits[0].distance, 10)
    const topology = (await representation.queryTopology()).value
    assert.deepEqual(topology.origin, [10, 0, 0])
    const points = decodeFloats(topology.meshes[0].properties)
    assert.equal(Math.max(...points.filter((_, i) => i % 3 === 0)), 20)
    assert.equal(queries, 0)
    representation.dispose()
    assert.throws(() => representation.pick(new Raycaster()), /disposed/)
})
