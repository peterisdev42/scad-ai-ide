import test from 'node:test'
import assert from 'node:assert/strict'
import { subjects, geometryDigest, printScreen, encodeDisplay, pickSurface } from '../../core/review/geometry'
import { decodeDisplay } from '../../core/review/display'
import { box, stl, threeMf } from '../mesh/fixtures'
import { parsePrintProfile } from '../../core/review/profile'
import type { SubjectInput, PrintProfile } from '../../core/review/types'
const input = (bytes = stl()): SubjectInput => ({ id: 'body', format: 'stl', bytes, units: 'mm' })
const profile: PrintProfile = { schemaVersion: 1, units: 'mm', process: 'fdm', buildVolumeMm: [10, 10, 10], buildPose: { translate: [0, 0, 0], rotate: [0, 0, 0] }, maxOverhangFromVerticalDeg: 45 }
const hash = (i: SubjectInput) => geometryDigest(subjects([i])[0])
test('oriented geometry identity ignores STL headers, triangle order and cyclic indexing; preserves winding and units', () => {
    const original = stl(),
        header = original.slice()
    header.fill(12, 0, 80)
    const base = hash(input(original))
    assert.equal(hash(input(header)).geometryHash, base.geometryHash)
    assert.notEqual(hash(input(header)).anchorHash, base.anchorHash)
    assert.equal(
        hash(
            input(
                stl(
                    box()
                        .reverse()
                        .map((t) => [t[1], t[2], t[0]]),
                ),
            ),
        ).geometryHash,
        base.geometryHash,
    )
    assert.equal(hash(input(stl(box(), true))).geometryHash, base.geometryHash)
    assert.notEqual(hash(input(stl(box().map((t) => t.reverse())))).geometryHash, base.geometryHash)
    assert.notEqual(hash({ ...input(), units: 'modelUnits' }).geometryHash, base.geometryHash)
    assert.notEqual(hash({ id: 'x', format: '3mf', units: 'mm', bytes: threeMf() }).geometryHash, base.geometryHash, 'container fill semantics remain distinct')
})
test('frozen display rebases Float64 coordinates, preserves source triangle mapping and bounds transport', () => {
    const source = input(stl(box([1, 2, 3], [1e10, 0, 0]), true)),
        prepared = subjects([source]),
        packet = encodeDisplay(prepared, 'target'),
        display = decodeDisplay(packet.display)
    assert.equal(display.parts.length, 1)
    assert.equal(display.parts[0].indices.length, 36)
    assert.equal(display.parts[0].mesh, 0)
    assert.ok(display.origin[0] >= 1e10)
    assert.equal(display.maxCoordinateError, 0)
    assert.equal(Math.max(...display.parts[0].positions.filter((_, i) => i % 3 === 0)), 0.5)
    const broken = packet.display.slice()
    new DataView(broken.buffer, broken.byteOffset).setUint32(4, 0xffffffff, true)
    assert.throws(() => decodeDisplay(broken), /INVALID|budget|Invalid/i)
})
test('host pick verifies a finite nondegenerate original Float64 triangle; invalid triangle/ray is rejected', () => {
    const source = input(),
        hit = pickSurface(source, { mesh: 0, triangle: 2, ray: { origin: [0.75, 0.25, 3], direction: [0, 0, -1] }, camera: {} })
    assert.deepEqual(hit.position, [0.75, 0.25, 1])
    assert.deepEqual(hit.normal, [0, 0, 1])
    assert.equal(hit.instanceId, 'stl:0')
    assert.throws(() => pickSurface(source, { mesh: 0, triangle: 999, ray: { origin: [0, 0, 3], direction: [0, 0, -1] }, camera: null }), /PICK/)
    assert.throws(() => pickSurface(source, { mesh: 0, triangle: 2, ray: { origin: [3, 3, 3], direction: [0, 0, -1] }, camera: null }), /PICK/)
    const invalid = input(
        stl([
            [
                [0, 0, 0],
                [0, 0, 0],
                [0, 0, 0],
            ],
        ]),
    )
    assert.throws(() => pickSurface(invalid, { mesh: 0, triangle: 0, ray: { origin: [0, 0, 1], direction: [0, 0, -1] }, camera: null }), /PICK/)
})
test('explicit print profile requires millimeters, finite positive envelope, FDM and a complete build pose', () => {
    assert.equal(parsePrintProfile(JSON.stringify(profile)).profile.units, 'mm')
    for (const bad of [
        { ...profile, units: 'modelUnits' },
        { ...profile, process: 'sla' },
        { ...profile, buildVolumeMm: [0, 1, 1] },
        { ...profile, buildPose: { translate: [0, 0, 0] } },
        { ...profile, maxOverhangFromVerticalDeg: 90 },
        { ...profile, extra: true },
    ])
        assert.throws(() => parsePrintProfile(JSON.stringify(bad)), /PRINT_PROFILE_INVALID/)
})
test('print envelope uses local geometry and explicit print pose, with exact bed exclusion and floating candidates', () => {
    const source = { ...input(), transform: { translate: [1000, 0, 0] as [number, number, number] } },
        onbed = printScreen(source, profile, true)
    assert.equal(onbed.envelope.status, 'PASS')
    assert.equal(onbed.overhang.candidateCount, 0)
    const floating = printScreen(source, { ...profile, buildPose: { rotate: [0, 0, 0], translate: [0, 0, 1] } }, true)
    assert.equal(floating.overhang.candidateCount, 2)
    assert.equal(floating.overhang.candidateArea, 1)
    assert.equal(printScreen(source, { ...profile, buildVolumeMm: [0.5, 1, 1] }, true).envelope.status, 'FAIL')
    assert.equal(printScreen(source, profile, false).overhang.status, 'UNRESOLVED')
    const near = printScreen(input(stl(box([1, 1, 1], [1e-12, 0, 0]), true)), { ...profile, buildVolumeMm: [1, 1, 1] }, true)
    assert.equal(near.envelope.status, 'FAIL')
})
