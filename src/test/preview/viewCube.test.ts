import assert from 'node:assert/strict'
import test from 'node:test'
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { createCubeRegions, cubeRegionGeometry, cubeViewDirection, cubeLabelQuaternion, cubeViewUp } from '../../features/preview/webview/preview/widgets/ViewCubeGeometry'

test('View cube exposes exactly 6 face, 12 edge and 8 corner directions', () => {
    const regions = createCubeRegions()
    assert.equal(regions.length, 26)
    for (const [kind, count] of [
        ['face', 6],
        ['edge', 12],
        ['corner', 8],
    ] as const) {
        assert.equal(regions.filter((region) => region.kind === kind).length, count)
    }
    assert.equal(new Set(regions.map((region) => region.direction.toArray().join(','))).size, 26)
    for (const region of regions) {
        assert.ok(Math.abs(region.direction.length() - 1) < 1e-10)
        assert.ok(Math.abs(cubeViewDirection(region.direction).length() - 1) < 1e-10)
        assert.ok(cubeViewDirection(region.direction).distanceTo(region.direction) < 2e-6)
    }
})

test('All 26 cube regions are independently pickable by outward-facing geometry', () => {
    const regions = createCubeRegions()
    const material = new MeshBasicMaterial()
    const meshes = regions.map((region) => new Mesh(cubeRegionGeometry(region), material))
    for (const mesh of meshes) mesh.updateMatrixWorld()
    for (const [index, region] of regions.entries()) {
        const ray = new Raycaster(region.direction.clone().multiplyScalar(6), region.direction.clone().negate())
        const hits = ray.intersectObjects(meshes, false)
        assert.equal(hits[0]?.object, meshes[index], `${region.label} must hit its own ${region.kind}`)
    }
    // The bevels should form a closed surface, with no gaps to click through.
    for (let i = 0; i < 300; i++) {
        const z = 1 - (2 * (i + 0.5)) / 300
        const phi = i * Math.PI * (3 - Math.sqrt(5))
        const radius = Math.sqrt(1 - z * z)
        const direction = new Vector3(radius * Math.cos(phi), radius * Math.sin(phi), z)
        assert.ok(new Raycaster(direction.clone().multiplyScalar(6), direction.negate()).intersectObjects(meshes, false).length)
    }
    for (const mesh of meshes) mesh.geometry.dispose()
    material.dispose()
})

test('Face labels follow OpenSCAD Z-up coordinates and pole directions are exact', () => {
    const faces = createCubeRegions().filter((region) => region.kind === 'face')
    for (const [label, direction] of [
        ['Top', [0, 0, 1]],
        ['Bottom', [0, 0, -1]],
        ['Front', [0, -1, 0]],
        ['Right', [1, 0, 0]],
        ['Back', [0, 1, 0]],
        ['Left', [-1, 0, 0]],
    ] as const) {
        assert.deepEqual(faces.find((face) => face.label === label)?.direction.toArray(), [...direction])
    }
    const top = cubeViewDirection(new Vector3(0, 0, 1))
    assert.deepEqual(top.toArray(), [0, 0, 1])
})

test('Face labels have fixed, outward-facing orientations tied to the requested adjacent faces', () => {
    const expectedUp: Record<string, number[]> = {
        Front: [0, 0, 1],
        Back: [0, 0, 1],
        Left: [0, 0, 1],
        Right: [0, 0, 1],
        Top: [0, 1, 0],
        Bottom: [0, -1, 0],
    }
    for (const face of createCubeRegions().filter((region) => region.kind === 'face')) {
        const rotation = cubeLabelQuaternion(face.direction)
        const up = new Vector3(0, 1, 0).applyQuaternion(rotation)
        const right = new Vector3(1, 0, 0).applyQuaternion(rotation)
        const outward = new Vector3(0, 0, 1).applyQuaternion(rotation)
        assert.ok(up.distanceTo(new Vector3(...expectedUp[face.label])) < 1e-10, `${face.label} text top must point at its fixed adjacent face`)
        assert.ok(outward.distanceTo(face.direction) < 1e-10, `${face.label} text must remain on its outward face`)
        assert.ok(right.clone().cross(up).distanceTo(outward) < 1e-10, `${face.label} texture must not be mirrored`)
    }
})

test('Every cube target has a valid reference pose', () => {
    for (const region of createCubeRegions()) {
        const up = cubeViewUp(region.direction)
        assert.ok(Math.abs(up.dot(region.direction)) < 1e-10)
        assert.ok(Math.abs(up.length() - 1) < 1e-10)
        if (Math.abs(region.direction.z) === 1) {
            assert.deepEqual(up.toArray(), [0, region.direction.z, 0])
        } else {
            assert.ok(up.z > 0, 'Non-pole views must have world Z pointing up')
        }
        const right = up.clone().cross(region.direction).normalize()
        if (region.kind === 'face') {
            assert.ok(Math.max(Math.abs(up.x), Math.abs(up.y), Math.abs(up.z)) > 1 - 1e-10)
        } else if (region.kind === 'edge') {
            const along = [region.direction.x, region.direction.y, region.direction.z].findIndex((value) => Math.abs(value) < 1e-10)
            const edgeAxis = new Vector3().setComponent(along, 1)
            if (along === 2) {
                assert.ok(Math.abs(edgeAxis.dot(right)) < 1e-10, 'Side edge must be vertical')
                assert.ok(Math.abs(edgeAxis.dot(up) - 1) < 1e-10)
            } else {
                assert.ok(Math.abs(edgeAxis.dot(up)) < 1e-10, 'Top/bottom edge must be horizontal')
                assert.ok(Math.abs(Math.abs(edgeAxis.dot(right)) - 1) < 1e-10)
            }
        } else {
            assert.ok(Math.abs(right.z) < 1e-10, 'Isometric views must not roll vertical cube edges sideways')
            assert.ok(Math.abs(up.z - Math.sqrt(2 / 3)) < 1e-10)
        }
    }
})

test('Side, edge and corner clicks restore Z-up while poles retain the nearest local roll', () => {
    for (const region of createCubeRegions()) {
        const base = cubeViewUp(region.direction)
        for (let i = 0; i < 360; i++) {
            const preferred = base.clone().applyAxisAngle(region.direction, (i * Math.PI) / 180)
            const actual = cubeViewUp(region.direction, preferred)
            if (Math.abs(region.direction.z) > 1 - 1e-10) {
                assert.ok(actual.angleTo(preferred) <= Math.PI / 4 + 1e-9)
            } else {
                assert.ok(actual.distanceTo(base) < 1e-10)
            }
            assert.ok(Math.abs(actual.dot(region.direction)) < 1e-10)
            assert.ok(Math.abs(actual.length() - 1) < 1e-10)
            assert.ok(cubeViewUp(region.direction, actual).distanceTo(actual) < 1e-10, 'Repeated clicks must keep a calibrated screen pose stable')
        }
    }
})
