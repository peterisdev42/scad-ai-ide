import type { CsgPartHint } from '../../../../../core/preview/csgParts'
import { csgVertexColors } from './CsgPartColors'
import { BufferGeometry, Color, Float32BufferAttribute, Group, Material, Mesh, type BufferAttribute, type InterleavedBufferAttribute } from 'three'
import { geometryParts, partColor } from './PartColors'
import { RenderMode, ViewOptionsContext } from '../../contexts/ViewOptionsContext'

import type { Theme } from '../Theme'

export class MaterialManager {
    private readonly parts = new WeakMap<BufferGeometry, { ids: Uint32Array; count: number; source?: BufferAttribute | InterleavedBufferAttribute; colors?: Float32BufferAttribute; offset?: number; hints?: readonly CsgPartHint[]; assisted?: Float32BufferAttribute }>()

    private preparePartColors(group: Group, enabled: boolean, hints?: readonly CsgPartHint[]) {
        const geometries = new Set<BufferGeometry>(),
            materials = new Set<Material>()
        if (enabled)
            group.traverse((child) => {
                if (!(child instanceof Mesh) || child.userData.previewOverlay || child.userData.csg) return
                if (geometries.has(child.geometry)) child.geometry = child.geometry.clone()
                geometries.add(child.geometry)
                const unique = (source: Material) => {
                    let material = source
                    if (materials.has(source)) {
                        material = source.clone()
                        for (const key of ['previewSourceColor', 'originalColor']) if (source.userData[key] instanceof Color) material.userData[key] = source.userData[key].clone()
                    }
                    materials.add(material)
                    return material
                }
                child.material = Array.isArray(child.material) ? child.material.map(unique) : unique(child.material)
            })
        const deadline = performance.now() + 80
        let offset = 0
        group.traverse((child) => {
            if (!(child instanceof Mesh) || child.userData.previewOverlay || child.userData.csg) return
            const geometry = child.geometry
            let parts = this.parts.get(geometry)
            if (enabled && !parts) {
                parts = { ...geometryParts(geometry), source: geometry.getAttribute('color') }
                this.parts.set(geometry, parts)
            }
            if (!parts) return
            if (enabled) {
                if (!parts.colors || parts.offset !== offset) {
                    const colors = new Float32Array(parts.ids.length * 3)
                    const palette = Array.from({ length: parts.count }, (_, i) => partColor(offset + i))
                    parts.ids.forEach((id, i) => palette[id].toArray(colors, i * 3))
                    parts.colors = new Float32BufferAttribute(colors, 3)
                    parts.offset = offset
                    parts.hints = undefined
                    parts.assisted = undefined
                }
                if (parts.hints !== hints) {
                    parts.hints = hints
                    parts.assisted = hints ? csgVertexColors(child, hints, parts.colors, deadline) : undefined
                }
                geometry.setAttribute('color', parts.assisted ?? parts.colors)
                offset += parts.count
            } else if (parts.source) geometry.setAttribute('color', parts.source)
            else geometry.deleteAttribute('color')
        })
    }

    /** Use theme defaults or a user override; reset restores source material and vertex colors. */
    public setTheme(group: Group, theme: Theme, override: string | null = null, partColors = false, hints?: readonly CsgPartHint[]) {
        this.preparePartColors(group, partColors, hints)
        group.traverse((child) => {
            if (!(child instanceof Mesh) || child.userData.previewOverlay || child.userData.csg) return
            const flags = child.geometry.getAttribute('scadDefaultColor')
            const colors = child.geometry.getAttribute('color')
            if (flags && colors && !partColors) {
                for (let i = 0; i < flags.count; i++) if (flags.getX(i) > 0.5) colors.setXYZ(i, theme.additive.r, theme.additive.g, theme.additive.b)
                colors.needsUpdate = true
            }
            const materials = Array.isArray(child.material) ? child.material : [child.material]
            for (const material of materials) {
                if (!('color' in material) || !(material.color instanceof Color)) continue
                if (!material.userData.previewSourceColor) {
                    material.userData.previewSourceColor = material.color.clone()
                    material.userData.previewSourceVertexColors = material.vertexColors
                }
                const role: unknown = material.userData.previewThemeColor
                const color = partColors ? new Color(0xffffff) : override ? new Color(override) : role === 'additive' || role === 'subtractive' ? theme[role] : material.userData.previewSourceColor
                material.color.copy(color)
                if (material.userData.originalColor instanceof Color) material.userData.originalColor.copy(color)
                const vertexColors = partColors ? true : override ? false : material.userData.previewSourceVertexColors
                if (material.vertexColors !== vertexColors) {
                    material.vertexColors = vertexColors
                    material.needsUpdate = true
                }
                if (material.userData.originalVertexColors !== undefined) material.userData.originalVertexColors = vertexColors
            }
        })
    }

    public applyToGroup(group: Group, settings: ViewOptionsContext) {
        group.traverse((child) => {
            if (child instanceof Mesh && !(child.userData.previewOverlay || child.userData.csg)) {
                child.castShadow = settings.get('shadows')
                child.receiveShadow = settings.get('shadows')
                this.applyToMesh(child, settings)
            }
        })
    }

    private applyToMesh(mesh: Mesh, viewSettings: ViewOptionsContext) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

        materials.forEach((mat) => {
            if (mat && 'wireframe' in mat) {
                ;(mat as any).wireframe = viewSettings.is('renderMode', RenderMode.Wireframe)

                if ('flatShading' in mat) {
                    if (mat.userData.originalFlatShading === undefined) {
                        mat.userData.originalFlatShading = (mat as any).flatShading
                    }
                    ;(mat as any).flatShading = viewSettings.is('renderMode', RenderMode.Wireframe) ? false : mat.userData.originalFlatShading
                }

                if (mat.userData.originalColor !== undefined) {
                    if ((mat as any).color) {
                        ;(mat as any).color.copy(mat.userData.originalColor)
                    }
                    if ('vertexColors' in mat) {
                        ;(mat as any).vertexColors = mat.userData.originalVertexColors
                    }
                }

                ;(mat as any).needsUpdate = true
            }
        })
    }
}
