import { Box3, DirectionalLight, Vector3 } from 'three'

/** Fit the key light's shadow camera to the model instead of Three.js's 10-unit default. */
export function fitDirectionalShadow(light: DirectionalLight, bounds: Box3): void {
    if (bounds.isEmpty()) return
    light.target.position.copy(bounds.getCenter(new Vector3()))
    light.target.updateMatrixWorld()
    light.updateMatrixWorld()
    light.shadow.updateMatrices(light)
    const projected = bounds.clone().applyMatrix4(light.shadow.camera.matrixWorldInverse)
    const margin = Math.max(bounds.getSize(new Vector3()).length() * 0.1, 0.01)
    Object.assign(light.shadow.camera, {
        left: projected.min.x - margin,
        right: projected.max.x + margin,
        bottom: projected.min.y - margin,
        top: projected.max.y + margin,
        near: Math.max(0.01, -projected.max.z - margin),
        far: Math.max(1, -projected.min.z + margin),
    })
    light.shadow.camera.updateProjectionMatrix()
    light.shadow.mapSize.set(2048, 2048)
    light.shadow.bias = -0.0001
    light.shadow.normalBias = margin * 0.005
}
