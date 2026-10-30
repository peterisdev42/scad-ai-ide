import assert from 'node:assert/strict'
import test from 'node:test'
import { BufferGeometry, Color, GridHelper, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as vm from 'node:vm'
import { contrastRatio, readPreviewTheme } from '../../features/preview/webview/preview/Theme'
import { buildPlatePalette } from '../../features/preview/webview/preview/managers/BuildPlatePalette'
import { MaterialManager } from '../../features/preview/webview/preview/managers/MaterialManager'
import { BuildPlateOrigin, Environment } from '../../features/preview/webview/contexts/ViewOptionsContext'
import type { EnvironmentManager } from '../../features/preview/webview/preview/managers/EnvironmentManager'

function colorDistance(a: Color, b: Color) {
    return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
}

function theme(background: string, foreground: string, accent: string, sidebar = background) {
    const values: Record<string, string> = { 'editor-background': background, 'editor-foreground': foreground, 'charts-blue': accent, 'sideBar-background': sidebar }
    return readPreviewTheme({ getPropertyValue: (name: string) => values[name.replace('--vscode-', '')] ?? '' })
}

const dark = theme('#1e1e1e', '#cccccc', '#3794ff', '#252526')
const light = theme('#ffffff', '#333333', '#006ab1', '#f3f3f3')

test('theme-derived model, build plate and grids remain distinct in light, dark and low-contrast custom themes', () => {
    for (const palette of [dark, light, theme('#101010', '#ffffff', '#151515'), theme('#ffffff', '#000000', '#eeeeee')]) {
        assert.ok(palette.additive.r >= 0.5 && palette.additive.r <= 0.85, 'Studio material stays light in every theme')
        assert.ok(contrastRatio(palette.additive, palette.background) >= 1.3)
        assert.ok(contrastRatio(palette.additive, palette.plate) >= 1.3)
        assert.ok(colorDistance(palette.grid, palette.background) > 0.02)
        assert.ok(colorDistance(palette.plateGrid, palette.plate) > 0.02)
        assert.ok(colorDistance(palette.plate, palette.additive) > 0.1)
    }
    for (const plate of [dark.plate, light.plate]) {
        assert.ok(Math.min(plate.r, plate.g, plate.b) > 0.035, 'Keep the plate above near-black')
        assert.ok(Math.max(plate.r, plate.g, plate.b) < 0.16, 'Keep a dark surface in either theme')
    }
})

test('theme refresh updates existing default materials and preserves explicit 3MF colors', () => {
    const group = new Group()
    const defaultMaterial = new MeshStandardMaterial()
    defaultMaterial.userData.previewThemeColor = 'additive'
    defaultMaterial.userData.originalColor = new Color()
    const explicitMaterial = new MeshStandardMaterial({ color: '#ef33a3', vertexColors: true })
    const original = explicitMaterial.color.clone()
    const subtractiveMaterial = new MeshStandardMaterial()
    subtractiveMaterial.userData.previewThemeColor = 'subtractive'
    group.add(new Mesh(new BufferGeometry(), [defaultMaterial, explicitMaterial, subtractiveMaterial]))
    const manager = new MaterialManager()
    for (const palette of [dark, light, dark]) {
        manager.setTheme(group, palette)
        assert.ok(defaultMaterial.color.equals(palette.additive))
        assert.ok(defaultMaterial.userData.originalColor.equals(palette.additive))
        assert.ok(subtractiveMaterial.color.equals(palette.subtractive))
        assert.ok(explicitMaterial.color.equals(original))
        assert.equal(explicitMaterial.vertexColors, true)
    }
})

test('existing build plate and grid buffers follow theme changes without replacing geometry or origin', () => {
    // Bundle the same binary STL and shader loaders as the production webview build.
    const code = buildSync({
        entryPoints: [fileURLToPath(new URL('../../features/preview/webview/preview/managers/EnvironmentManager.ts', import.meta.url))],
        bundle: true,
        write: false,
        format: 'cjs',
        platform: 'node',
        target: 'es2022',
        external: ['three', 'three/*'],
        loader: { '.stl': 'binary', '.glsl': 'text' },
    }).outputFiles[0].text
    const module = { exports: {} as { EnvironmentManager: typeof EnvironmentManager } }
    vm.runInNewContext(code, { module, require: createRequire(import.meta.url), Buffer, Uint8Array })
    const environment = new module.exports.EnvironmentManager(Environment.BuildPlate, dark)
    environment.setEnvironment(Environment.BuildPlate, BuildPlateOrigin.LowerLeft)
    const [plate, grid] = environment.group.children as [Mesh<BufferGeometry, MeshBasicMaterial>, GridHelper]
    const geometry = plate.geometry
    const gridGeometry = grid.geometry
    const position = plate.position.clone()
    for (const palette of [light, dark, light]) {
        environment.setTheme(palette)
        assert.equal(environment.group.children[0], plate)
        assert.equal(plate.geometry, geometry)
        assert.equal(grid.geometry, gridGeometry)
        assert.ok(plate.position.equals(position))
        assert.ok(grid.position.equals(position))
        assert.ok(plate.material.color.equals(palette.plate))
        const colors = grid.geometry.getAttribute('color')
        for (let i = 0; i < colors.count; i++) {
            assert.ok(colorDistance(new Color().setRGB(colors.getX(i), colors.getY(i), colors.getZ(i)), palette.plateGrid) < 1e-6)
        }
        assert.equal(plate.material.depthWrite, false)
        assert.equal(grid.material.depthWrite, false)
    }
    environment.setEnvironment(Environment.None)
})

test('Default model is neutral and user color survives theme switches until reset', () => {
    const group = new Group()
    const material = new MeshStandardMaterial({ color: '#fa25aa', vertexColors: true })
    const sourceColor = material.color.clone()
    const themedMaterial = new MeshStandardMaterial()
    themedMaterial.userData.previewThemeColor = 'additive'
    group.add(new Mesh(new BufferGeometry(), [material, themedMaterial]))
    const manager = new MaterialManager()
    for (const palette of [light, dark]) {
        assert.ok(Math.abs(palette.additive.r - palette.additive.g) < 1e-9)
        assert.ok(Math.abs(palette.additive.g - palette.additive.b) < 1e-9)
        manager.setTheme(group, palette, '#44aaff')
        assert.equal(material.color.getHexString(), '44aaff')
        assert.equal(themedMaterial.color.getHexString(), '44aaff')
        assert.equal(material.vertexColors, false)
    }
    manager.setTheme(group, dark, null)
    assert.ok(material.color.equals(sourceColor), 'Restore explicit source colors')
    assert.ok(themedMaterial.color.equals(dark.additive), 'Restore theme-aware gray')
    assert.equal(material.vertexColors, true, 'Restore source vertex colors')
})

test('Plate palette stays charcoal across bright, dark and strongly tinted custom themes', () => {
    for (const background of ['#ffffff', '#f3f3f3', '#909090', '#202020', '#000000', '#fff0dc', '#081b35']) {
        for (const source of ['#ffffff', '#eeeeee', '#444444', '#000000', '#ff0000', '#00ff00', '#0000ff']) {
            const input = new Color(source)
            const before = input.clone()
            const { plate, plateGrid } = buildPlatePalette(input, new Color(background))
            for (const value of [plate.r, plate.g, plate.b, plateGrid.r, plateGrid.g, plateGrid.b]) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1)
            assert.ok(Math.min(plate.r, plate.g, plate.b) > 0.035, 'Even a white theme must not produce a black plate')
            assert.ok(Math.max(plate.r, plate.g, plate.b) < 0.16, 'A saturated theme must still produce a subdued dark plate')
            assert.ok(contrastRatio(plate, plateGrid) >= 1.5, 'Grid stays visible')
            assert.ok(contrastRatio(plate, plateGrid) < 2.5, 'Grid remains quieter than the model')
            assert.ok(input.equals(before), 'Do not change theme input colors')
        }
    }
    assert.ok(light.background.r > 0.9, 'Only the plate uses the dark palette')
})
