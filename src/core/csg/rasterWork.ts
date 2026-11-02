import type { CsgProduct, CsgScene } from './types'
import { boundaryCofactors } from './normalize'

/** Pure CSG raster workload planning shared by the VS Code host and viewer.
 * In particular, Markdown's built-in preview must make the same fallback
 * decision as Stage, without importing Three.js into the extension process. */
export interface RasterBoundary {
    operand: number
    inside: CsgProduct[]
    outside: CsgProduct[]
    convex: boolean
}

/** Guardrail for an interactive raster frame, not a correctness tolerance. */
export const CSG_INTERACTIVE_WORK_LIMIT = 400
export const CSG_RASTER_WORK_LIMIT = 50000

export function prepareRasterBoundaries(scene: CsgScene, root: number = scene.root): RasterBoundary[] {
    const products = root === scene.root ? scene.products : scene.overlays.find((o) => o.root === root)?.products ?? []
    const ids = new Set(products.flatMap((p) => [...p.intersections, ...p.subtractions]))
    if (ids.size * scene.program.length > 2000000) throw new Error('CSG boundary normalization budget exceeded. Simplify the expression or use Full Render.')
    let literals = 0
    let terms = 0
    return [...ids]
        .map((id) => {
            const box = scene.operands[id].bounds
            const constants = new Map<number, boolean>()
            for (const other of ids) {
                if (other === id) continue
                const b = scene.operands[other].bounds
                if (box.min.some((x, d) => x > b.max[d]) || box.max.some((x, d) => x < b.min[d])) constants.set(other, false)
            }
            const boundary = { operand: id, ...boundaryCofactors(scene.program, root, id, constants), convex: scene.operands[id].convex }
            for (const term of [...boundary.inside, ...boundary.outside]) {
                terms++
                literals += term.intersections.length + term.subtractions.length
            }
            if (terms > 16384 || literals > 131072) throw new Error('CSG boundary product budget exceeded. Simplify the expression or use Full Render.')
            return boundary
        })
        .filter((b) => b.inside.length || b.outside.length)
}

export function estimateRasterWork(boundaries: readonly RasterBoundary[], layerBudgets: ReadonlyMap<number, number> = new Map()) {
    let work = 0
    let hasDirect = false
    for (const boundary of boundaries) {
        const direct = boundary.inside.length === 1 &&
            boundary.inside[0].intersections.length === 0 &&
            boundary.inside[0].subtractions.length === 0 &&
            boundary.outside.length === 0
        if (direct) {
            // The viewer draws all direct operands in a single scene pass.
            hasDirect = true
            continue
        }
        const layers = boundary.convex ? 1 : layerBudgets.get(boundary.operand) ?? 1
        const perSide = [...boundary.inside, ...boundary.outside].reduce((count, product) =>
            count + 3 + (product.intersections.length + product.subtractions.length) * 2, 0)
        work += layers * 2 * (1 + perSide)
    }
    return work + Number(hasDirect)
}

export function estimateSceneRasterWork(scene: CsgScene) {
    return [scene.root, ...scene.overlays.map((o) => o.root)]
        .reduce((sum, root) => sum + estimateRasterWork(prepareRasterBoundaries(scene, root)), 0)
}
