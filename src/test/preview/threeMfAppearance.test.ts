import assert from 'node:assert/strict'
import test from 'node:test'
import { BufferGeometry, Group, Mesh, MeshPhongMaterial, MeshStandardMaterial, Texture, DoubleSide, Float32BufferAttribute } from 'three'
import { prepareThreeMfAppearance } from '../../features/preview/webview/preview/managers/ThreeMfAppearance'
import { studioSurface } from '../../features/preview/webview/preview/managers/StudioAppearance'
import { MaterialManager } from '../../features/preview/webview/preview/managers/MaterialManager'
import { readPreviewTheme } from '../../features/preview/webview/preview/Theme'

test('ordinary 3MF colors use the same PBR studio surface as STL without changing source RGB', () => {
    const source = new MeshPhongMaterial({ color: '#FFD52A', flatShading: true, name: 'Cheese' })
    const geometry = new BufferGeometry()
    const group = new Group()
    const mesh = new Mesh(geometry, source)
    group.add(mesh)
    prepareThreeMfAppearance(group)
    assert.ok(mesh.material instanceof MeshStandardMaterial)
    const surface = mesh.material as unknown as MeshStandardMaterial
    assert.equal(surface.color.getHexString(), 'ffd52a')
    assert.equal(surface.roughness, studioSurface.roughness)
    assert.equal(surface.metalness, studioSurface.metalness)
    assert.equal(surface.name, 'Cheese')
    assert.equal(surface.flatShading, true)
    assert.equal(mesh.geometry, geometry)
    const theme = readPreviewTheme({ getPropertyValue: () => '' })
    const manager = new MaterialManager()
    manager.setTheme(group, theme, '#44aaff')
    assert.equal(surface.color.getHexString(), '44aaff')
    manager.setTheme(group, theme, null)
    assert.equal(surface.color.getHexString(), 'ffd52a')
})

test('conversion preserves shared references, multi-material slots, transparency and texture/vertex color semantics', () => {
    const texture = new Texture()
    const source = new MeshPhongMaterial({ color: '#f9d72c', map: texture, alphaMap: texture, vertexColors: true, transparent: true, opacity: 0.45, alphaTest: 0.2, side: DoubleSide, depthWrite: false, flatShading: true })
    const pbr = new MeshStandardMaterial({ color: '#995533', roughness: 0.17, metalness: 0.8 })
    let disposals = 0, textureDisposals = 0, pbrDisposals = 0
    source.addEventListener('dispose', () => disposals++)
    texture.addEventListener('dispose', () => textureDisposals++)
    pbr.addEventListener('dispose', () => pbrDisposals++)
    const geometry = new BufferGeometry().setAttribute('color', new Float32BufferAttribute([0.2, 0.3, 0.4], 3))
    const first = new Mesh(geometry, [source, pbr, source])
    const second = new Mesh(geometry, source)
    const group = new Group().add(first, second)
    prepareThreeMfAppearance(group)
    const surface = first.material[0]
    assert.ok(surface instanceof MeshStandardMaterial)
    assert.equal(first.material[2], surface)
    assert.equal(second.material, surface)
    assert.equal(first.material[1], pbr)
    assert.equal(pbr.roughness, 0.17)
    assert.equal(pbr.metalness, 0.8)
    assert.equal(surface.color.getHexString(), 'f9d72c')
    assert.equal(surface.map, texture)
    assert.equal(surface.alphaMap, texture)
    assert.equal(surface.vertexColors, true)
    assert.equal(surface.transparent, true)
    assert.equal(surface.opacity, 0.45)
    assert.equal(surface.alphaTest, 0.2)
    assert.equal(surface.side, DoubleSide)
    assert.equal(surface.depthWrite, false)
    assert.equal(surface.userData.previewThemeColor, undefined)
    assert.equal(disposals, 1)
    assert.equal(textureDisposals, 0)
    assert.equal(pbrDisposals, 0)
    prepareThreeMfAppearance(group)
    assert.equal(first.material[0], surface)
    assert.equal(disposals, 1)
})

test('OpenSCAD default additive/subtractive colors still follow the theme', () => {
    const group = new Group().add(new Mesh(new BufferGeometry(), [new MeshPhongMaterial({ color: '#f9d72c' }), new MeshPhongMaterial({ color: '#9dcb51' })]))
    prepareThreeMfAppearance(group)
    const materials = (group.children[0] as Mesh<BufferGeometry, MeshStandardMaterial[]>).material
    const theme = readPreviewTheme({ getPropertyValue: (key) => key === '--vscode-editor-background' ? '#ffffff' : '#222222' })
    assert.equal(materials[0].userData.previewThemeColor, 'additive')
    assert.equal(materials[1].userData.previewThemeColor, 'subtractive')
    new MaterialManager().setTheme(group, theme)
    assert.ok(materials[0].color.equals(theme.additive))
    assert.ok(materials[1].color.equals(theme.subtractive))
})
