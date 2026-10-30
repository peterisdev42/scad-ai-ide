import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, Color, Vector3 } from 'three'
import { CameraRig } from '../../features/preview/webview/preview/rigs/CameraRig'
import { CameraMode } from '../../features/preview/webview/contexts/ViewOptionsContext'
import { createCubeRegions, cubeViewUp } from '../../features/preview/webview/preview/widgets/ViewCubeGeometry'

// Keep the actual CameraRig, TrackballControls, cameras and animation update loop.
// Only the DOM event surface and animation clock are supplied by this fixture.
function fixture() {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const previousPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance')
    let now = 0
    Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), { pageXOffset: 0, pageYOffset: 0 }) })
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } })
    const element = Object.assign(new EventTarget(), {
        style: {},
        ownerDocument: Object.assign(new EventTarget(), { documentElement: { clientLeft: 0, clientTop: 0 } }),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    })
    const rig = new CameraRig('test', 800, 600, element as unknown as HTMLElement, new Color())
    const target = new Vector3(10, -20, 30)
    rig.getControls().target.copy(target)
    rig.getPerspectiveCamera()
        .position.copy(target)
        .add(new Vector3(90, -120, 150))
    rig.update()
    const distance = rig.getPerspectiveCamera().position.distanceTo(target)
    return {
        rig,
        target,
        distance,
        advance: (milliseconds: number) => {
            now += milliseconds
            rig.update()
        },
        dispose: () => {
            rig.dispose()
            for (const [name, descriptor] of [
                ['window', previousWindow],
                ['performance', previousPerformance],
            ] as const) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor)
                else Reflect.deleteProperty(globalThis, name)
            }
        },
    }
}

function assertPose(state: ReturnType<typeof fixture>, direction: Vector3) {
    const { rig, target, distance } = state
    const camera = rig.activeCamera
    const actual = camera.position.clone().sub(target).normalize()
    assert.ok(actual.distanceTo(direction) < 1e-9, `Expected ${direction.toArray()}, received ${actual.toArray()}`)
    assert.ok(Math.abs(camera.position.distanceTo(target) - distance) < 1e-8, 'Keep orbit distance')
    assert.ok(rig.getControls().target.distanceTo(target) < 1e-10, 'Keep orbit target')
    if (Math.abs(direction.z) < 1 - 1e-10) {
        const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
        assert.ok(up.distanceTo(cubeViewUp(direction)) < 1e-9, 'Restore canonical Z-up without leftover roll')
    }
    assert.ok(rig.getPerspectiveCamera().quaternion.angleTo(camera.quaternion) < 1e-7, 'Sync perspective and orthographic cameras')
}

const regions = createCubeRegions()

for (const mode of [CameraMode.Perspective, CameraMode.Orthographic]) {
    test(`Cube edges snap to exact 45-degree views after every corner (${mode})`, () => {
        const state = fixture()
        try {
            state.rig.setMode(mode)
            for (const corner of regions.filter((region) => region.kind === 'corner')) {
                for (const edge of regions.filter((region) => region.kind === 'edge')) {
                    state.rig.orientTo(corner.direction, 0)
                    state.rig.orientToEdge(edge.direction)
                    state.advance(140)
                    state.advance(140)
                    assertPose(state, edge.direction)
                    const before = state.rig.activeCamera.quaternion.clone()
                    state.rig.orientToEdge(edge.direction, 0)
                    assert.ok(before.angleTo(state.rig.activeCamera.quaternion) < 1e-7, 'Repeated clicks keep the same view')
                }
            }
        } finally {
            state.dispose()
        }
    })
}

test('All 26 cube views converge from every other view, including opposites and rolled cameras', () => {
    const state = fixture()
    try {
        for (const from of regions) {
            for (const to of regions) {
                state.rig.orientTo(from.direction, 0)
                state.rig.roll(Math.PI / 2, 0)
                state.rig.orientTo(to.direction)
                state.advance(100)
                state.advance(180)
                assertPose(state, to.direction)
            }
        }
    } finally {
        state.dispose()
    }
})

test('An edge selection interrupts an unfinished corner animation and stays at the selected edge', () => {
    const state = fixture()
    try {
        const corner = regions.find((region) => region.label === 'Right · Front · Top')!
        const edge = regions.find((region) => region.label === 'Front · Top')!
        state.rig.orientTo(corner.direction)
        state.advance(80)
        state.rig.orientToEdge(edge.direction)
        state.advance(280)
        assertPose(state, edge.direction)
        state.advance(500)
        assertPose(state, edge.direction)
    } finally {
        state.dispose()
    }
})

test('Initial Top–Left–Front fit keeps tall and wide models in frame in both projections', () => {
    const state = fixture()
    try {
        for (const mode of [CameraMode.Perspective, CameraMode.Orthographic]) {
            state.rig.setMode(mode)
            for (const size of [new Vector3(10, 15, 900), new Vector3(800, 20, 20), new Vector3(0.1, 0.1, 0.1)]) {
                for (const [width, height] of [
                    [800, 600],
                    [400, 900],
                ]) {
                    state.rig.resize(width, height)
                    const min = new Vector3(400, -300, 20)
                    const bounds = new Box3(min, min.clone().add(size))
                    state.rig.resetView(bounds, 0, new Vector3(-1, -1, 1))
                    const camera = state.rig.activeCamera
                    const center = bounds.getCenter(new Vector3())
                    assert.ok(
                        camera.position
                            .clone()
                            .sub(center)
                            .normalize()
                            .distanceTo(new Vector3(-1, -1, 1).normalize()) < 1e-9,
                    )
                    camera.updateMatrixWorld()
                    for (let index = 0; index < 8; index++) {
                        const point = new Vector3(index & 1 ? bounds.max.x : bounds.min.x, index & 2 ? bounds.max.y : bounds.min.y, index & 4 ? bounds.max.z : bounds.min.z).project(camera)
                        assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) <= 1, 'The complete model must fit')
                    }
                }
            }
        }
        state.rig.resetView(new Box3(new Vector3(-10, -10, -10), new Vector3(10, 10, 10)), 0)
        assert.ok(
            state.rig.activeCamera.position
                .clone()
                .normalize()
                .distanceTo(new Vector3(0, 0, 1)) < 1e-9,
            'Explicit Reset keeps its Top behavior',
        )
    } finally {
        state.dispose()
    }
})
