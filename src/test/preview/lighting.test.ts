import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, DirectionalLight, Vector3 } from 'three'
import { fitDirectionalShadow } from '../../features/preview/webview/preview/managers/Lighting'

test('Key light shadow camera covers small, large and displaced models', () => {
    const light = new DirectionalLight()
    for (const scale of [0.1, 100, 1000]) {
        const center = new Vector3(5000, -3000, 0)
        const half = new Vector3(scale, scale * 0.5, scale * 2)
        const bounds = new Box3(center.clone().sub(half), center.clone().add(half))
        light.position.copy(center).add(new Vector3(-2, -3, 5).multiplyScalar(scale * 2))
        fitDirectionalShadow(light, bounds)
        const camera = light.shadow.camera
        camera.updateMatrixWorld()
        for (let i = 0; i < 8; i++) {
            const point = new Vector3(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z).project(camera)
            assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1, `Shadow map must cover ${point.toArray()}`)
        }
        assert.ok(light.target.position.equals(center))
        assert.equal(light.shadow.mapSize.x, 2048)
        assert.ok(light.shadow.normalBias > 0)
    }
})
