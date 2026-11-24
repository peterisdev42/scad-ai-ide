import { Material, Mesh, MeshPhongMaterial, MeshStandardMaterial, Object3D } from 'three'
import { studioSurface } from './StudioAppearance'

/**
 * ThreeMFLoader uses Phong for ordinary base, vertex-color and textured
 * materials. Phong does not receive the studio's PMREM diffuse fill like
 * Standard does. Convert the loader's legacy materials at the preview
 * boundary, not in the renderer or the source document.
 */
export function prepareThreeMfAppearance(group: Object3D): void {
    const converted = new Map<Material, Material>()
    const prepare = (source: Material): Material => {
        const previous = converted.get(source)
        if (previous) return previous

        let result = source
        if (source instanceof MeshPhongMaterial) {
            const surface = new MeshStandardMaterial(studioSurface)
            // Only copy the common Material state (opacity, transparency,
            // depth/stencil, side, vertexColors, name and userData).
            // MeshStandardMaterial.copy expects a Standard source.
            Material.prototype.copy.call(surface, source)
            surface.color.copy(source.color)
            surface.flatShading = source.flatShading
            surface.map = source.map
            surface.alphaMap = source.alphaMap
            surface.emissive.copy(source.emissive)
            surface.emissiveIntensity = source.emissiveIntensity
            surface.emissiveMap = source.emissiveMap
            surface.normalMap = source.normalMap
            surface.normalMapType = source.normalMapType
            surface.normalScale.copy(source.normalScale)
            surface.bumpMap = source.bumpMap
            surface.bumpScale = source.bumpScale
            surface.displacementMap = source.displacementMap
            surface.displacementScale = source.displacementScale
            surface.displacementBias = source.displacementBias
            surface.aoMap = source.aoMap
            surface.aoMapIntensity = source.aoMapIntensity
            surface.lightMap = source.lightMap
            surface.lightMapIntensity = source.lightMapIntensity
            surface.wireframe = source.wireframe
            surface.wireframeLinewidth = source.wireframeLinewidth
            surface.fog = source.fog
            result = surface
        }

        // Preserve the existing OpenSCAD default-color convention for
        // uniform surfaces, without overriding textures, vertex colors,
        // or the authored roughness/metalness of existing PBR materials.
        if (result instanceof MeshStandardMaterial && !result.map && !result.vertexColors) {
            const hex = result.color.getHexString().toLowerCase()
            if (hex === 'f9d72c') result.userData.previewThemeColor = 'additive'
            else if (hex === '9dcb51') result.userData.previewThemeColor = 'subtractive'
        }
        converted.set(source, result)
        return result
    }

    group.traverse((child) => {
        if (!(child instanceof Mesh)) return
        child.material = Array.isArray(child.material) ? child.material.map(prepare) : prepare(child.material)
    })

    // Loader materials can be shared by multiple meshes or array slots.
    // Dispose only replaced materials, once, after all references change.
    // The converted material still owns references to the same textures.
    for (const [source, result] of converted) {
        if (source !== result) source.dispose()
    }
}
