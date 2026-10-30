import { Color, Group, Mesh } from 'three'
import { RenderMode, ViewOptionsContext } from '../../contexts/ViewOptionsContext'

import type { Theme } from '../Theme'

export class MaterialManager {
    /** Use theme defaults or a user override; reset restores source material and vertex colors. */
    public setTheme(group: Group, theme: Theme, override: string | null = null) {
        group.traverse((child) => {
            if (!(child instanceof Mesh)) return
            const flags = child.geometry.getAttribute('scadDefaultColor')
            const colors = child.geometry.getAttribute('color')
            if (flags && colors) {
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
                const color = override ? new Color(override) : role === 'additive' || role === 'subtractive' ? theme[role] : material.userData.previewSourceColor
                material.color.copy(color)
                if (material.userData.originalColor instanceof Color) material.userData.originalColor.copy(color)
                const vertexColors = override ? false : material.userData.previewSourceVertexColors
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
            if (child instanceof Mesh) {
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
