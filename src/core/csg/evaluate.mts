import { Matrix4, Color } from 'three'
import { createHash } from 'node:crypto'
import type { ManifoldToplevel } from 'manifold-3d'
import { evaluateGeometry } from './geometry.mjs'
import { parseCsg, selectCsgRoots, type CsgNode } from './parser.js'
import { prepareGeometry } from './prepare.mjs'
import { normalizeCsg } from './normalize.js'
import type { CsgMesh, CsgOperand, CsgInstruction, CsgScene, CsgCachedGeometry } from './types.js'
import { polyhedronMesh } from './polyhedron.mjs'

export function serializeCsg(node: CsgNode): string {
    const params = Object.entries(node.params)
        .map(([name, value]) => `${name.startsWith('$') && /^\$\d+$/.test(name) ? '' : name + '='}${JSON.stringify(value)}`)
        .join(',')
    return `${node.modifiers}${node.name}(${params}){${node.children.map(serializeCsg).join('')}}`
}

/** Compile preview data. Ordinary 3D boolean nodes never enter the geometry kernel. */
export function evaluateCsg(source: string, module: ManifoldToplevel, cached: Record<string, CsgCachedGeometry> = {}): CsgScene {
    const started = performance.now()
    const meshes: CsgMesh[] = [],
        operands: CsgOperand[] = [],
        program: CsgInstruction[] = []
    const overlays: CsgScene['overlays'] = []
    let geometryCacheHits = 0
    const cache = new Map<string, number>()
    const geometryKeys: string[] = []
    const diagnostics: string[] = []
    const emit = (instruction: CsgInstruction) => {
        if (instruction.op !== 'leaf' && instruction.op !== 'empty') {
            const leftEmpty = program[instruction.left].op === 'empty',
                rightEmpty = program[instruction.right].op === 'empty'
            if (instruction.op === 'union' && leftEmpty) return instruction.right
            if (instruction.op === 'union' && rightEmpty) return instruction.left
            if (instruction.op === 'difference' && (leftEmpty || rightEmpty)) return instruction.left
            if (instruction.op === 'intersection' && (leftEmpty || rightEmpty)) return leftEmpty ? instruction.left : instruction.right
        }
        program.push(instruction)
        return program.length - 1
    }
    const empty = () => emit({ op: 'empty' })
    // Match CSGTreeEvaluator's propagation of background/highlight terms. Keep
    // the original solid DAG root for topology: debug Union drawing may remove
    // a highlighted child from the ordinary product without removing its solid.
    const flags = new Map<number, { highlight: boolean; background: boolean }>(),
        semantics = new Map<number, number>(),
        overlayKeys = new Set<string>()
    const getFlags = (id: number) => flags.get(id) ?? { highlight: false, background: false }
    const solidRoot = (id: number) => semantics.get(id) ?? id
    const addOverlay = (root: number, kind: 'highlight' | 'background') => {
        const key = kind + root
        if (!overlayKeys.has(key)) {
            overlayKeys.add(key)
            overlays.push({ root, kind, products: [] })
        }
    }
    const combine = (ids: number[], op: 'union' | 'intersection' | 'difference' = 'union') => {
        if (!ids.length) return empty()
        let left = ids[0]
        for (const right of ids.slice(1)) {
            const a = getFlags(left),
                b = getFlags(right)
            let root: number, solid: number
            if (b.background) {
                addOverlay(right, 'background')
                root = left
                solid = solidRoot(left)
            } else if (a.background) {
                addOverlay(left, 'background')
                root = right
                solid = solidRoot(right)
            } else {
                root = emit({ op, left, right })
                solid = solidRoot(left) === left && solidRoot(right) === right ? root : emit({ op, left: solidRoot(left), right: solidRoot(right) })
            }
            if (op === 'difference') {
                if (root !== left && a.highlight) flags.set(root, { ...getFlags(root), highlight: true })
                else if (root !== right && b.highlight) addOverlay(right, 'highlight')
            } else if (op === 'intersection') {
                if (program[root].op !== 'empty' && root !== left && root !== right && a.highlight && b.highlight) flags.set(root, { ...getFlags(root), highlight: true })
                else {
                    if (root !== left && a.highlight) addOverlay(left, 'highlight')
                    if (root !== right && b.highlight) addOverlay(right, 'highlight')
                }
            } else {
                if (root !== left && root !== right && a.highlight && b.highlight) flags.set(root, { ...getFlags(root), highlight: true })
                else if (root !== left && a.highlight) {
                    addOverlay(left, 'highlight')
                    root = right
                } else if (root !== right && b.highlight) {
                    addOverlay(right, 'highlight')
                    root = left
                }
            }
            if (solid !== root) semantics.set(root, solid)
            left = root
        }
        return left
    }
    type Paint = { color: [number, number, number, number]; defaultColor: boolean }
    const leaf = (node: CsgNode, matrix: Matrix4, paint: Paint) => {
        const source = serializeCsg(node)
        const key = createHash('sha256').update(source).digest('hex')
        let index = cache.get(key)
        const surface = node.name === 'polyhedron' ? polyhedronMesh(node, module) : undefined
        if (index === undefined) {
            if (cached[key]) geometryCacheHits++
            let geometry
            try {
                geometry = surface ? { meshes: [surface.mesh] } : cached[key] ? { meshes: [cached[key].mesh] } : evaluateGeometry(source, module)
            } catch (error) {
                if (error instanceof Error && error.message === 'CSG model is empty.') return empty()
                throw error
            }
            if (geometry.meshes.length !== 1) throw new Error('A geometry barrier produced unexpected overlay geometry.')
            index = meshes.length
            meshes.push(geometry.meshes[0])
            geometryKeys.push(key)
            cache.set(key, index)
        }
        const id = operands.length
        if (surface && !surface.closed) diagnostics.push('A non-closed polyhedron is shown as a surface; it has no solid volume.')
        operands.push({ mesh: index, matrix: matrix.toArray(), color: paint.color, defaultColor: paint.defaultColor, source: node.name, closed: surface?.closed ?? true, convex: ['cube', 'sphere', 'cylinder', 'hull'].includes(node.name), convexity: typeof node.params.convexity === 'number' ? Math.max(1, Math.ceil(node.params.convexity)) : 1, inverse: [], normalMatrix: [], bounds: { min: [], max: [] } })
        return emit({ op: 'leaf', operand: id })
    }
    const visit = (node: CsgNode, matrix: Matrix4, paint: Paint): number => {
        if (node.modifiers.includes('*')) return empty()
        if (/[#%]/.test(node.modifiers)) {
            const root = visit({ ...node, modifiers: node.modifiers.replace(/[#%]/g, '') }, matrix, paint)
            const previous = getFlags(root)
            flags.set(root, { highlight: previous.highlight || node.modifiers.includes('#'), background: previous.background || node.modifiers.includes('%') })
            return root
        }
        if (node.name === 'multmatrix') {
            const rows = node.params.m ?? node.params.$0
            if (!Array.isArray(rows) || rows.length !== 4 || rows.some((r) => !Array.isArray(r) || r.length !== 4 || r.some((v) => typeof v !== 'number' || !Number.isFinite(v)))) throw new Error('Invalid CSG transform.')
            const transform = new Matrix4().fromArray((rows as number[][]).flat()).transpose()
            return combine(node.children.map((child) => visit(child, matrix.clone().multiply(transform), paint)))
        }
        if (node.name === 'color') {
            if (!paint.defaultColor) return combine(node.children.map((child) => visit(child, matrix, paint)))
            const c = node.params.c ?? node.params.$0
            const rgba: [number, number, number, number] = [...paint.color]
            if (typeof c === 'string') {
                const rgb = new Color(c)
                rgba.splice(0, 3, rgb.r, rgb.g, rgb.b)
            } else if (Array.isArray(c)) for (let i = 0; i < Math.min(c.length, 4); i++) if (typeof c[i] === 'number') rgba[i] = c[i] as number
            if (typeof node.params.alpha === 'number') rgba[3] = node.params.alpha
            return combine(node.children.map((child) => visit(child, matrix, { color: rgba, defaultColor: c === null || c === undefined })))
        }
        if (['group', 'union', 'intersection', 'difference'].includes(node.name)) {
            // Background terms keep their flag through transforms/color. They
            // are removed by combine before choosing Difference's first solid.
            const children = node.children.filter((child) => !child.modifiers.includes('*'))
            return combine(
                children.map((child) => visit(child, matrix, paint)),
                node.name === 'difference' || node.name === 'intersection' ? node.name : 'union',
            )
        }
        return leaf(node, matrix, paint)
    }
    const trees = selectCsgRoots(parseCsg(source))
    let root = combine(trees.map((tree) => visit(tree, new Matrix4(), { color: [1, 1, 1, 1], defaultColor: true })))
    let topologyRoot = solidRoot(root)
    if (getFlags(root).highlight) addOverlay(root, 'highlight')
    if (getFlags(root).background) {
        addOverlay(root, 'background')
        root = empty()
        topologyRoot = root
    }
    if (!operands.length || (program[root].op === 'empty' && !overlays.length)) throw new Error('CSG model is empty.')
    for (const expression of [root, ...overlays.map((o) => o.root)])
        if (!['leaf', 'empty'].includes(program[expression].op)) {
            const pending = [expression],
                seen = new Set<number>()
            while (pending.length) {
                const id = pending.pop()!
                if (seen.has(id)) continue
                seen.add(id)
                const instruction = program[id]
                if (instruction.op === 'leaf') {
                    if (!operands[instruction.operand].closed) throw new Error('A non-closed surface cannot be classified as a CSG boolean solid.')
                } else if (instruction.op !== 'empty') pending.push(instruction.left, instruction.right)
            }
        }
    const prepared = prepareGeometry(meshes, operands)
    const geometryMs = performance.now() - started,
        normalizationStarted = performance.now()
    const products = normalizeCsg(program, root)
    for (const overlay of overlays) overlay.products = normalizeCsg(program, overlay.root)
    return { version: 3, meshes, operands, geometryKeys, diagnostics, program, root, topologyRoot, products, overlays, ...prepared, dependencies: [], timings: { geometryMs, normalizationMs: performance.now() - normalizationStarted, geometryCacheHits } }
}
