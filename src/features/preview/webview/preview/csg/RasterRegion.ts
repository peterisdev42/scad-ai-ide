import { Camera, Matrix4, Mesh, Vector3, Vector4 } from 'three'

/** Conservative screen rectangle in Three.js render-target coordinates (top-left origin).
 * Near-plane intersections use the whole viewport: projecting clipped corners
 * cannot conservatively bound an eye-inside or near-clipped operand. */
export function rasterRegion(mesh: Mesh, camera: Camera, width: number, height: number): Vector4 | undefined {
    const box = mesh.geometry.boundingBox
    if (!box) return new Vector4(0, 0, width, height)
    const view = new Matrix4().multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld)
    const point = new Vector3(),
        near = (camera as Camera & { near?: number }).near ?? 0
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity
    for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z]) {
                point.set(x, y, z).applyMatrix4(view)
                if (point.z >= -near) return new Vector4(0, 0, width, height)
                point.applyMatrix4(camera.projectionMatrix)
                const px = ((point.x + 1) * width) / 2,
                    py = ((point.y + 1) * height) / 2
                minX = Math.min(minX, px)
                minY = Math.min(minY, py)
                maxX = Math.max(maxX, px)
                maxY = Math.max(maxY, py)
            }
    const x = Math.max(0, Math.floor(minX) - 2),
        y = Math.max(0, Math.floor(minY) - 2)
    const w = Math.min(width, Math.ceil(maxX) + 2) - x,
        h = Math.min(height, Math.ceil(maxY) + 2) - y
    if (w <= 0 || h <= 0) return undefined
    return new Vector4(x, height - y - h, w, h)
}

/** Exact bounding-box proof that every viewing ray starts before this operand.
 * This does not query geometry or infer inside/outside from a bounding box. */
export function entirelyPastNear(mesh: Mesh, camera: Camera): boolean {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox
    if (!box) return false
    const view = new Matrix4().multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld).elements
    const center = box.getCenter(new Vector3()),
        size = box.getSize(new Vector3()).multiplyScalar(0.5)
    const maximumZ = view[2] * center.x + view[6] * center.y + view[10] * center.z + view[14] + Math.abs(view[2]) * size.x + Math.abs(view[6]) * size.y + Math.abs(view[10]) * size.z
    return maximumZ < -((camera as Camera & { near?: number }).near ?? 0)
}
