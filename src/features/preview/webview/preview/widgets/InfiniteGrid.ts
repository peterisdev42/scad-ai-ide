import { Color, DoubleSide, Mesh, PlaneGeometry } from 'three'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { abs, cameraPosition, clamp, float, floor, fract, fwidth, log, max, min, mix, normalize, positionWorld, pow, smoothstep, uniform, vec4 } from 'three/tsl'
import { AXIS_COLORS } from './AxisColors'
import type { Theme } from '../Theme'

/** Derivative based grid, compiled to both WGSL and GLSL by TSL. */
export class InfiniteGrid {
    public readonly mesh: Mesh
    private readonly fadeFar = uniform(10000)
    private readonly gridColor = uniform(new Color())
    private readonly material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 16 })

    constructor(theme: Theme) {
        this.gridColor.value.copy(theme.grid)
        const h = max(abs(cameraPosition.z), 0.1)
        const level = floor(log(h).div(Math.log(10)).sub(1))
        const line = (scale: Node<'float'>) => {
            const uv = positionWorld.xy.div(scale)
            const g = abs(fract(uv.sub(0.5)).sub(0.5)).div(max(fwidth(uv), 1e-8))
            return float(1)
                .sub(clamp(min(g.x, g.y), 0, 1))
                .mul(float(1).sub(clamp(log(h.div(scale)).div(Math.log(10)).sub(1), 0, 1)))
        }
        const fine = line(pow(10, level))
        const coarse = line(pow(10, level.add(1)))
        const axX = float(1).sub(clamp(abs(positionWorld.y).div(max(fwidth(positionWorld.y).mul(2), 1e-8)), 0, 1))
        const axY = float(1).sub(clamp(abs(positionWorld.x).div(max(fwidth(positionWorld.x).mul(2), 1e-8)), 0, 1))
        const axis = max(axX, axY)
        const rgb = mix(this.gridColor, mix(uniform(new Color(AXIS_COLORS.y)), uniform(new Color(AXIS_COLORS.x)), float(axX.greaterThanEqual(axY))), float(axis.greaterThan(max(fine, coarse))))
        const distance = positionWorld.distance(cameraPosition)
        const fade = smoothstep(0, this.fadeFar.mul(0.02), distance).mul(float(1).sub(smoothstep(this.fadeFar.mul(0.5), this.fadeFar, distance)))
        const alpha = max(max(fine, coarse), axis)
            .mul(fade)
            .mul(smoothstep(0, 0.5, abs(normalize(cameraPosition.sub(positionWorld)).z)))
        this.material.fragmentNode = vec4(rgb, alpha)
        this.mesh = new Mesh(new PlaneGeometry(2, 2), this.material)
        this.mesh.frustumCulled = false
    }
    update(orbitDistance: number) {
        this.fadeFar.value = Math.max(orbitDistance * 5, 100)
        this.mesh.scale.setScalar(this.fadeFar.value * 2)
    }
    setTheme(theme: Theme) {
        this.gridColor.value.copy(theme.grid)
    }
    dispose() {
        this.mesh.geometry.dispose()
        this.material.dispose()
    }
}
