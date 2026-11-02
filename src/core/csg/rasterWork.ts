import type { CsgProduct, CsgScene } from './types'
import { boundaryCofactors, normalizeCsg } from './normalize'

/** Backend-independent CSG boundary planning and bounded raster workload.
 * A costly F5 stays symbolic; the limit diagnoses work rather than computing
 * a complete Boolean mesh implicitly. */
export interface RasterBoundary {
    operand: number
    inside: CsgProduct[]
    outside: CsgProduct[]
    convex: boolean
}

export const CSG_RASTER_WORK_LIMIT = 50000

export function prepareRasterBoundaries(scene: CsgScene, root: number = scene.root): RasterBoundary[] {
    const products = root === scene.root ? scene.products : (scene.overlays.find((o) => o.root === root)?.products ?? [])
    const ids = new Set(products.flatMap((p) => [...p.intersections, ...p.subtractions]))
    if (ids.size * scene.program.length > 2000000) throw new Error('CSG boundary normalization budget exceeded. Simplify the expression or use Full Render.')
    let literals = 0
    let references = 0
    const interned = new Map<string, CsgProduct>()
    const share = (products: CsgProduct[]) =>
        products.map((product) => {
            if (++references > 131072) throw new Error('CSG boundary reference budget exceeded. Simplify the expression or use Full Render.')
            const key = product.intersections.join(',') + '|' + product.subtractions.join(',')
            const existing = interned.get(key)
            if (existing) return existing
            interned.set(key, product)
            literals += product.intersections.length + product.subtractions.length
            if (interned.size > 16384 || literals > 131072) throw new Error('CSG boundary product budget exceeded. Simplify the expression or use Full Render.')
            return product
        })
    return [...ids]
        .map((id) => {
            const box = scene.operands[id].bounds
            const constants = new Map<number, boolean>()
            for (const other of ids) {
                if (other === id) continue
                const b = scene.operands[other].bounds
                if (box.min.some((x, d) => x > b.max[d]) || box.max.some((x, d) => x < b.min[d])) constants.set(other, false)
            }
            const cofactors = boundaryCofactors(scene.program, root, id, constants)
            const inside = share(cofactors.inside),
                outside = share(cofactors.outside)
            const boundary = { operand: id, inside, outside, convex: scene.operands[id].convex }
            return boundary
        })
        .filter((b) => b.inside.length || b.outside.length)
}

export interface RasterPredicate {
    operand: number
    inside: boolean
}
export interface RasterPredicateGroup {
    predicates: RasterPredicate[]
}
export type RasterProductBatch = { operation: 'any'; group: RasterPredicateGroup } | { operation: 'all'; groups: RasterPredicateGroup[] }

export interface RasterProductPlan {
    factors: RasterPredicateGroup[]
    batches: RasterProductBatch[]
}
const productSchedules = new WeakMap<readonly CsgProduct[], RasterProductPlan[]>()

function groupPredicates(predicates: RasterPredicate[]): RasterPredicateGroup[] {
    const groups: RasterPredicateGroup[] = []
    for (let i = 0; i < predicates.length; i += 8) groups.push({ predicates: predicates.slice(i, i + 8) })
    return groups
}

/** Exact product scheduling. Single literals form an OR; longer products are
 * ANDs of groups. Every operand has an independent parity bit, including convex
 * operands: separate front/back winding pipelines differ at rasterized edges.
 * Immutable cofactors cache the schedule between camera frames. */
function productBatches(products: readonly CsgProduct[]): RasterProductBatch[] {
    const singles = new Map<number, RasterPredicate>()
    const conjunctions: RasterProductBatch[] = []
    let universal = false
    for (const product of products) {
        const predicates = [...product.intersections.map((operand) => ({ operand, inside: true })), ...product.subtractions.map((operand) => ({ operand, inside: false }))]
        if (!predicates.length) {
            universal = true
            break
        }
        if (predicates.length === 1) {
            const predicate = predicates[0],
                key = (predicate.operand + 1) * (predicate.inside ? 1 : -1)
            if (singles.has(-key)) {
                universal = true
                break
            }
            singles.set(key, predicate)
        } else conjunctions.push({ operation: 'all', groups: groupPredicates(predicates) })
    }
    const schedule: RasterProductBatch[] = universal ? [{ operation: 'all', groups: [] }] : [...groupPredicates([...singles.values()]).map((group) => ({ operation: 'any' as const, group })), ...conjunctions]
    return schedule
}

function signedProduct(literals: readonly number[]): CsgProduct {
    return { intersections: literals.filter((id) => id > 0).map((id) => id - 1), subtractions: literals.filter((id) => id < 0).map((id) => -id - 1) }
}

/** Factor common literals in subsets of a DNF, without expanding it. The work
 * bound stops optimization only; remaining terms are evaluated unchanged. */
export function planRasterProducts(products: readonly CsgProduct[]): RasterProductPlan[] {
    const cached = productSchedules.get(products)
    if (cached) return cached
    let pending = products.map((p) => [...p.intersections.map((id) => id + 1), ...p.subtractions.map((id) => -id - 1)])
    const schedule: RasterProductPlan[] = []
    let work = 0
    while (pending.length) {
        if (pending.some((term) => !term.length)) {
            // A universal product absorbs all other terms of this cofactor.
            schedule.length = 0
            schedule.push({ factors: [], batches: [{ operation: 'all', groups: [] }] })
            break
        }
        const counts = new Map<number, number>()
        for (const term of pending) for (const literal of term) counts.set(literal, (counts.get(literal) ?? 0) + 1)
        work += pending.reduce((n, term) => n + term.length, 0)
        let best = 0,
            occurrences = 1
        for (const [literal, count] of counts)
            if (count > occurrences) {
                best = literal
                occurrences = count
            }
        if (!best || work > 100000) {
            schedule.push({ factors: [], batches: productBatches(pending.map(signedProduct)) })
            break
        }
        const selected = pending.filter((term) => term.includes(best))
        pending = pending.filter((term) => !term.includes(best))
        const common = selected[0].filter((literal) => selected.every((term) => term.includes(literal))),
            keys = new Set(common)
        const residuals = selected.map((term) => signedProduct(term.filter((literal) => !keys.has(literal))))
        schedule.push({ factors: groupPredicates(common.map((id) => ({ operand: Math.abs(id) - 1, inside: id > 0 }))), batches: productBatches(residuals) })
    }
    productSchedules.set(products, schedule)
    return schedule
}

export function estimateRasterWork(boundaries: readonly RasterBoundary[], layerBudgets: ReadonlyMap<number, number> = new Map()) {
    let work = 0
    let hasDirect = false
    for (const boundary of boundaries) {
        const direct = boundary.inside.length === 1 && boundary.inside[0].intersections.length === 0 && boundary.inside[0].subtractions.length === 0 && boundary.outside.length === 0
        if (direct) {
            // The viewer draws all direct operands in a single scene pass.
            hasDirect = true
            continue
        }
        const layers = boundary.convex ? 1 : (layerBudgets.get(boundary.operand) ?? 1)
        const sets = [boundary.inside, boundary.outside]
        const perSide = sets.flatMap((products) => planRasterProducts(products)).reduce((count, plan) => count + (plan.factors.length ? 1 + plan.factors.length : 0) + plan.batches.reduce((n, batch) => n + (batch.operation === 'any' ? 2 : 1 + Math.max(1, batch.groups.length)), 0), 0)
        // Candidate clear/draw and final merge/shading each share one pass;
        // each predicate group batches stencil reset, draws and rejection.
        work += layers * 2 * (3 + perSide)
    }
    return work + Number(hasDirect)
}

export function estimateSceneRasterWork(scene: CsgScene) {
    return [scene.root, ...scene.overlays.map((o) => o.root)].reduce((sum, root) => sum + estimateRasterWork(prepareRasterBoundaries(scene, root)), 0)
}

/** Union components may share the depth buffer when the near plane starts
 * outside every component. Keep nested Difference/Intersection intact and
 * reject shared operand DAGs so each candidate keeps a single component role. */
export function prepareExteriorUnion(scene: CsgScene, root = scene.root): RasterBoundary[] | undefined {
    const stack = [root],
        roots: number[] = []
    while (stack.length) {
        const id = stack.pop()!,
            node = scene.program[id]
        if (node.op === 'union') stack.push(node.right, node.left)
        else roots.push(id)
    }
    if (roots.length < 2) return undefined
    const owners = new Set<number>()
    const components = roots.map((component) => ({ root: component, products: normalizeCsg(scene.program, component) }))
    for (const component of components) {
        const operands = new Set(component.products.flatMap((product) => [...product.intersections, ...product.subtractions]))
        for (const id of operands) {
            if (owners.has(id)) return undefined
            owners.add(id)
        }
    }
    return components.flatMap((component) => prepareRasterBoundaries({ ...scene, ...component }))
}
