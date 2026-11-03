import assert from 'node:assert/strict'
import test from 'node:test'
import { BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from 'three'
import { geometryParts } from '../../features/preview/webview/preview/managers/PartColors'
import { MaterialManager } from '../../features/preview/webview/preview/managers/MaterialManager'
import { readPreviewTheme } from '../../features/preview/webview/preview/Theme'

function geometry() {
    return new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 10, 0, 0, 11, 0, 0, 10, 1, 0], 3))
}
const theme = readPreviewTheme({ getPropertyValue: () => '' })

test('part detection welds STL seams but keeps disconnected shells separate, for indexed and nonindexed meshes', () => {
    for (const indexed of [false, true]) {
        const mesh = geometry()
        if (indexed) mesh.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8])
        const result = geometryParts(mesh)
        assert.equal(result.count, 2)
        assert.deepEqual([...result.ids], [0, 0, 0, 0, 0, 0, 1, 1, 1])
    }
    assert.equal(geometryParts(new BufferGeometry()).count, 0)
})

test('part colors distinguish shells and restore source vertex colors and manual overrides', () => {
    const group = new Group(),
        mesh = new Mesh(geometry(), new MeshStandardMaterial({ color: '#556677', vertexColors: true }))
    const source = new Float32BufferAttribute(new Float32Array(27).fill(0.3), 3)
    mesh.geometry.setAttribute('color', source)
    group.add(mesh)
    const manager = new MaterialManager()
    manager.setTheme(group, theme, '#ff0000')
    manager.setTheme(group, theme, '#ff0000', true)
    const colors = mesh.geometry.getAttribute('color')
    assert.notDeepEqual([colors.getX(0), colors.getY(0), colors.getZ(0)], [colors.getX(6), colors.getY(6), colors.getZ(6)])
    assert.equal(mesh.material.color.getHex(), 0xffffff)
    assert.equal(mesh.material.vertexColors, true)
    manager.setTheme(group, theme, '#ff0000', false)
    assert.equal(mesh.geometry.getAttribute('color'), source)
    assert.equal(mesh.material.color.getHex(), 0xff0000)
    assert.equal(mesh.material.vertexColors, false)
    manager.setTheme(group, theme, null)
    assert.equal(mesh.material.color.getHex(), 0x556677)
    assert.equal(mesh.material.vertexColors, true)
})

test('shared 3MF instances receive independent colors and retain their original material after toggling', () => {
    const sharedGeometry = geometry(),
        sharedMaterial = new MeshStandardMaterial({ color: '#abcdef' })
    const first = new Mesh(sharedGeometry, sharedMaterial),
        second = new Mesh(sharedGeometry, sharedMaterial)
    const group = new Group().add(first, second),
        manager = new MaterialManager()
    manager.setTheme(group, theme)
    manager.setTheme(group, theme, null, true)
    assert.notEqual(first.geometry, second.geometry)
    assert.notEqual(first.material, second.material)
    assert.notEqual(first.geometry.getAttribute('color').getX(0), second.geometry.getAttribute('color').getX(0))
    for (let i = 0; i < 2; i++) {
        manager.setTheme(group, theme, null, false)
        for (const mesh of [first, second]) {
            assert.equal(mesh.geometry.hasAttribute('color'), false)
            assert.ok(mesh.material.color.equals(new Color('#abcdef')))
            assert.equal(mesh.material.vertexColors, false)
        }
        manager.setTheme(group, theme, null, true)
    }
})
