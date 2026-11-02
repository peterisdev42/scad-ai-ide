import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three'
import { rasterRegion, entirelyPastNear } from '../../features/preview/webview/preview/csg/RasterRegion'

test('raster regions conservatively cover affine operands in shared top-left coordinates', () => {
    const camera = new PerspectiveCamera(45, 16 / 9, 0.1, 100)
    camera.updateMatrixWorld(true)
    const geometry = new BoxGeometry(2, 3, 4),
        mesh = new Mesh(geometry, new MeshBasicMaterial())
    geometry.computeBoundingBox()
    mesh.position.set(0.5, 1, -8)
    mesh.scale.set(-1.2, 0.8, 1.1)
    mesh.rotation.y = 0.3
    mesh.updateMatrixWorld(true)
    const top = rasterRegion(mesh, camera, 1920, 1080)!
    assert.equal(entirelyPastNear(mesh, camera), true)
    const positions = geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
        const point = mesh.localToWorld(new Vector3().fromBufferAttribute(positions, i)).project(camera)
        const x = (point.x + 1) * 960,
            y = (1 - point.y) * 540
        assert.ok(x >= top.x && x <= top.x + top.z && y >= top.y && y <= top.y + top.w)
    }
    mesh.position.set(1000, 0, -8)
    mesh.updateMatrixWorld(true)
    assert.equal(rasterRegion(mesh, camera, 1920, 1080), undefined)
    mesh.position.set(0, 0, 0)
    mesh.updateMatrixWorld(true)
    assert.equal(entirelyPastNear(mesh, camera), false)
    assert.deepEqual(rasterRegion(mesh, camera, 1920, 1080)?.toArray(), [0, 0, 1920, 1080])
    geometry.dispose()
    mesh.material.dispose()
})
