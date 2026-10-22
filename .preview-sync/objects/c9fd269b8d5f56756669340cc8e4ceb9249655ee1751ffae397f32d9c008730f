import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import { viewportPanDelta, viewportOrbit, ORBIT_RADIANS_PER_PIXEL } from '../../features/preview/webview/preview/rigs/DirectPointerNavigation'
import { buildPlateOffset, buildPlateResetBounds, BUILD_PLATE_SIZE } from '../../features/preview/webview/preview/managers/BuildPlateLayout'
import { BuildPlateOrigin } from '../../features/preview/webview/contexts/ViewOptionsContext'

test('Mouse panning maps CSS pixel displacement 1:1 in both camera modes', () => {
    const width = 900,
        height = 600
    for (const distance of [25, 150, 900]) {
        for (const fov of [35, 75]) {
            const perspective = new PerspectiveCamera(fov, width / height, 0.1, 10000)
            const orthographic = new OrthographicCamera(-120, 120, 80, -80, 0.1, 10000)
            orthographic.zoom = 1.7
            orthographic.updateProjectionMatrix()
            for (const camera of [perspective, orthographic]) {
                const target = new Vector3(15, -7, 12)
                camera.position.copy(target).add(new Vector3(1, -2, 1).normalize().multiplyScalar(distance))
                camera.up.set(0, 0, 1)
                camera.lookAt(target)
                camera.updateMatrixWorld()
                const before = target.clone().project(camera)
                const delta = viewportPanDelta(camera, target, 83, -37, width, height)
                camera.position.add(delta)
                const movedTarget = target.clone().add(delta)
                camera.lookAt(movedTarget)
                camera.updateMatrixWorld()
                const after = target.clone().project(camera)
                assert.ok(Math.abs(((after.x - before.x) * width) / 2 - 83) < 1e-8)
                assert.ok(Math.abs((-(after.y - before.y) * height) / 2 + 37) < 1e-8)
                assert.ok(Math.abs(camera.position.distanceTo(movedTarget) - distance) < 1e-8)
            }
        }
    }
})

test('Build plate center and printable lower-left origins align correctly', () => {
    const half = BUILD_PLATE_SIZE / 2
    assert.deepEqual(buildPlateOffset(BuildPlateOrigin.Center).toArray(), [0, 0, 0])
    const offset = buildPlateOffset(BuildPlateOrigin.LowerLeft)
    assert.deepEqual(new Vector3(-half, -half, 0).add(offset).toArray(), [0, 0, 0])
    assert.deepEqual(new Vector3(half, half, 0).add(offset).toArray(), [BUILD_PLATE_SIZE, BUILD_PLATE_SIZE, 0])
})

test('Print-plate reset frames the plate for fitting XY models and the model for oversized XY', () => {
    const small = new Box3(new Vector3(10, 20, -5), new Vector3(80, 90, 600))
    const before = small.clone()
    for (const origin of [BuildPlateOrigin.Center, BuildPlateOrigin.LowerLeft]) {
        const bounds = buildPlateResetBounds(small, origin)
        const center = buildPlateOffset(origin)
        assert.equal(bounds.min.x, center.x - BUILD_PLATE_SIZE / 2)
        assert.equal(bounds.max.x, center.x + BUILD_PLATE_SIZE / 2)
        assert.equal(bounds.min.y, center.y - BUILD_PLATE_SIZE / 2)
        assert.equal(bounds.max.y, center.y + BUILD_PLATE_SIZE / 2)
        assert.equal(bounds.min.z, -5)
        assert.equal(bounds.max.z, 600, 'Model height must remain in frame')
        assert.ok(bounds.containsBox(small))
        const empty = buildPlateResetBounds(new Box3(), origin)
        assert.deepEqual(empty.getSize(new Vector3()).toArray(), [250, 250, 0])
    }
    assert.ok(small.equals(before), 'Reset bounds must not mutate the model bounds')
    for (const size of [
        [251, 10, 20],
        [10, 251, 20],
        [400, 500, 20],
    ]) {
        const min = new Vector3(1000, -800, 25)
        const model = new Box3(min, min.clone().add(new Vector3(...size)))
        for (const origin of [BuildPlateOrigin.Center, BuildPlateOrigin.LowerLeft]) assert.ok(buildPlateResetBounds(model, origin).equals(model), 'Any oversized XY dimension must use model framing')
    }
    const equal = new Box3(new Vector3(0, 0, 5), new Vector3(250, 250, 10))
    assert.equal(buildPlateResetBounds(equal, BuildPlateOrigin.LowerLeft).min.z, 0, 'Exact plate-size models still use plate framing')
    const displaced = new Box3(new Vector3(500, 500, 0), new Vector3(510, 510, 10))
    const frame = buildPlateResetBounds(displaced)
    assert.ok(frame.containsBox(displaced), 'Displaced small models must not be cropped')
    assert.ok(frame.containsPoint(new Vector3(-125, -125, 0)), 'Plate must remain in frame')
})

test('Turntable yaw/pitch use fixed angular gain, preserve target/distance and avoid accumulated roll', () => {
    const target = new Vector3(12, -8, 5)
    for (const fov of [35, 45, 75]) {
        const camera = new PerspectiveCamera(fov, 1.5, 0.1, 10000)
        camera.position.copy(target).add(new Vector3(0, -150, 75))
        camera.up.set(0, 0, 1)
        camera.lookAt(target)
        const radius = camera.position.distanceTo(target)
        const initial = camera.quaternion.clone()
        const elevation = Math.atan2(75, 150)
        viewportOrbit(camera, target, 100, 0)
        const offset = camera.position.clone().sub(target)
        assert.ok(Math.abs(Math.atan2(offset.y, offset.x) - (-Math.PI / 2 - 100 * ORBIT_RADIANS_PER_PIXEL)) < 1e-10)
        assert.ok(Math.abs(Math.asin(offset.z / radius) - elevation) < 1e-10)
        viewportOrbit(camera, target, 0, 50)
        assert.ok(Math.abs(Math.asin((camera.position.z - target.z) / radius) - (elevation + 50 * ORBIT_RADIANS_PER_PIXEL)) < 1e-10)
        viewportOrbit(camera, target, -100, 0)
        viewportOrbit(camera, target, 0, -50)
        assert.ok(initial.angleTo(camera.quaternion) < 1e-7, 'A rectangular mouse path must not accumulate Roll')
        assert.ok(Math.abs(camera.position.distanceTo(target) - radius) < 1e-8)
        assert.deepEqual(target.toArray(), [12, -8, 5])
    }
})

test('Turntable recovers rolled views and protects exact Top/Bottom without flipping', () => {
    const target = new Vector3()
    const camera = new PerspectiveCamera()
    for (const z of [-1, 1]) {
        for (const up of [new Vector3(0, 1, 0), new Vector3(1, 0, 0), new Vector3(0, -1, 0)]) {
            camera.position.set(0, 0, z * 150)
            camera.up.copy(up)
            camera.lookAt(target)
            viewportOrbit(camera, target, 30, 0)
            assert.ok(Math.abs(camera.position.z - z * 150) < 1e-8)
            viewportOrbit(camera, target, 0, z * 10000)
            assert.ok(Math.abs(camera.position.z - z * 150) < 1e-8, 'Dragging beyond a pole must stop without flipping')
            viewportOrbit(camera, target, 0, -z * 20)
            assert.ok(camera.position.z * z < 150, 'Reverse dragging must immediately leave the pole')
            const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
            assert.ok(Math.abs(right.z) < 1e-10)
            assert.ok(camera.up.z > 0)
        }
    }
    camera.position.set(100, -100, 100)
    camera.up.set(1, 0, 0)
    camera.lookAt(target)
    viewportOrbit(camera, target, 1, 1)
    assert.ok(Math.abs(new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).z) < 1e-10)
})
