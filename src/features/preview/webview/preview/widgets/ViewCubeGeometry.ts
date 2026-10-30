import { BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three'

export interface CubeRegion {
    direction: Vector3
    label: string
    kind: 'face' | 'edge' | 'corner'
    vertices: Vector3[]
}

const labels = [
    ['Left', 'Right'],
    ['Front', 'Back'],
    ['Bottom', 'Top'],
]
// Inset from the cube boundary: 0.18, half the original 0.36 bevel.
const bevel = 0.82

/** A chamfered cube with 6 square faces, 12 bevelled edges and 8 corners. */
export function createCubeRegions(): CubeRegion[] {
    const regions: CubeRegion[] = []
    for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
            for (let z = -1; z <= 1; z++) {
                const signs = [x, y, z]
                const axes = signs.flatMap((value, axis) => (value ? [axis] : []))
                if (!axes.length) continue
                const label = axes.map((axis) => labels[axis][signs[axis] > 0 ? 1 : 0]).join(' · ')
                const direction = new Vector3(x, y, z).normalize()
                let vertices: Vector3[]
                if (axes.length === 1) {
                    const axis = axes[0]
                    const other = [0, 1, 2].filter((value) => value !== axis)
                    vertices = [
                        [-1, -1],
                        [1, -1],
                        [1, 1],
                        [-1, 1],
                    ].map(([a, b]) => {
                        const point = new Vector3().setComponent(axis, signs[axis])
                        return point.setComponent(other[0], a * bevel).setComponent(other[1], b * bevel)
                    })
                } else if (axes.length === 2) {
                    const [a, b] = axes
                    const along = [0, 1, 2].find((axis) => !signs[axis])!
                    vertices = [
                        [1, bevel, -bevel],
                        [bevel, 1, -bevel],
                        [bevel, 1, bevel],
                        [1, bevel, bevel],
                    ].map(([u, v, w]) =>
                        new Vector3()
                            .setComponent(a, u * signs[a])
                            .setComponent(b, v * signs[b])
                            .setComponent(along, w),
                    )
                } else {
                    vertices = axes.map((axis) => new Vector3(x * (axis === 0 ? 1 : bevel), y * (axis === 1 ? 1 : bevel), z * (axis === 2 ? 1 : bevel)))
                }
                // Consistent outward winding is also useful for labels and raycasting.
                const normal = vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0]))
                if (normal.dot(direction) < 0) vertices.reverse()
                regions.push({
                    direction,
                    label,
                    kind: axes.length === 1 ? 'face' : axes.length === 2 ? 'edge' : 'corner',
                    vertices,
                })
            }
        }
    }
    return regions
}

export function cubeRegionGeometry(region: CubeRegion): BufferGeometry {
    const points: number[] = []
    for (let i = 1; i < region.vertices.length - 1; i++) {
        for (const point of [region.vertices[0], region.vertices[i], region.vertices[i + 1]]) points.push(...point.toArray())
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(points, 3))
    geometry.computeVertexNormals()
    return geometry
}

/** Free-orbit navigation supports exact pole views without a singular up vector. */
export function cubeViewDirection(direction: Vector3): Vector3 {
    return direction.clone().normalize()
}

/** Standard Z-up views, with the nearest local quarter-turn at the two poles. */
export function cubeViewUp(direction: Vector3, preferredUp?: Vector3): Vector3 {
    const normal = direction.clone().normalize()
    const pole = Math.abs(normal.z) > 1 - 1e-10
    const baseUp = pole ? new Vector3(0, normal.z > 0 ? 1 : -1, 0) : new Vector3(0, 0, 1).addScaledVector(normal, -normal.z).normalize()
    if (!pole || !preferredUp) return baseUp
    const right = baseUp.clone().cross(normal).normalize()
    const candidates = [baseUp, right, baseUp.clone().negate(), right.clone().negate()]
    return candidates.reduce((best, up) => (up.dot(preferredUp) > best.dot(preferredUp) + 1e-10 ? up : best))
}

/** Fixed texture tops: four sides → Top; Top → Back; Bottom → Front. */
export function cubeLabelQuaternion(normal: Vector3): Quaternion {
    const up = Math.abs(normal.z) > 0.5 ? new Vector3(0, normal.z, 0) : new Vector3(0, 0, 1)
    const right = up.clone().cross(normal).normalize()
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, normal))
}
