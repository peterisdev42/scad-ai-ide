import { Matrix4, Color } from 'three'
import { createHash } from 'node:crypto'
import type { ManifoldToplevel } from 'manifold-3d'
import { evaluateGeometry } from './geometry.mjs'
import { parseCsg, selectCsgRoots, type CsgNode } from './parser.js'
import { prepareAcceleration } from './prepare.mjs'
import type { CsgMesh, CsgOperand, CsgInstruction, CsgPreviewSceneV2, CsgCachedGeometry } from './types.js'
import { polyhedronMesh } from './polyhedron.mjs'

export function serializeCsg(node: CsgNode): string {
    const params = Object.entries(node.params)
        .map(([name, value]) => `${name.startsWith('$') && /^\$\d+$/.test(name) ? '' : name + '='}${JSON.stringify(value)}`)
        .join(',')
    return `${node.modifiers}${node.name}(${params}){${node.children.map(serializeCsg).join('')}}`
}

/** Compile preview data. Ordinary 3D boolean nodes never enter the geometry kernel. */
export function evaluateCsg(source: string, module: ManifoldToplevel, cached: Record<string, CsgCachedGeometry> = {}): CsgPreviewSceneV2 {
    const started = performance.now()
    const meshes: CsgMesh[] = [],
        operands: CsgOperand[] = [],
        program: CsgInstruction[] = []
    const overlays: CsgPreviewSceneV2['overlays'] = []
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
    const combine = (ids: number[], op: 'union' | 'intersection' | 'difference' = 'union') => (ids.length ? ids.slice(1).reduce((left, right) => emit({ op, left, right }), ids[0]) : empty())
    type Paint = { color: [number, number, number, number]; defaultColor: boolean }
    const leaf = (node: CsgNode, matrix: Matrix4, paint: Paint) => {
        const source = serializeCsg(node)
        const key = createHash('sha256').update(source).digest('hex')
        let index = cache.get(key)
        const surface = node.name === 'polyhedron' ? polyhedronMesh(node, module) : undefined
        if (index === undefined) {
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
        operands.push({ mesh: index, matrix: matrix.toArray(), color: paint.color, defaultColor: paint.defaultColor, source: node.name, closed: surface?.closed ?? true, inverse: [], normalMatrix: [], bounds: { min: [], max: [] } })
        return emit({ op: 'leaf', operand: id })
    }
    const visit = (node: CsgNode, matrix: Matrix4, paint: Paint): number => {
        if (node.modifiers.includes('*')) return empty()
        if (/[#%]/.test(node.modifiers)) {
            const root = visit({ ...node, modifiers: node.modifiers.replace(/[#%]/g, '') }, matrix, paint)
            overlays.push({ root, kind: node.modifiers.includes('#') ? 'highlight' : 'background' })
            return node.modifiers.includes('%') ? empty() : root
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
            // Background/disabled objects are excluded before operand ordering.
            const children = node.children.filter((child) => !/[%*]/.test(child.modifiers))
            for (const child of node.children.filter((child) => /%/.test(child.modifiers))) visit(child, matrix, paint)
            return combine(
                children.map((child) => visit(child, matrix, paint)),
                node.name === 'difference' || node.name === 'intersection' ? node.name : 'union',
            )
        }
        return leaf(node, matrix, paint)
    }
    const trees = selectCsgRoots(parseCsg(source))
    const root = combine(trees.map((tree) => visit(tree, new Matrix4(), { color: [1, 1, 1, 1], defaultColor: true })))
    if (!operands.length || (program[root].op === 'empty' && !overlays.length)) throw new Error('CSG model is empty.')
    if (operands.some((o) => !o.closed) && program[root].op !== 'leaf' && program[root].op !== 'empty') throw new Error('A non-closed surface cannot be classified as a CSG boolean solid.')
    const geometryMs = performance.now() - started,
        bvhStarted = performance.now()
    const { cacheHits, ...acceleration } = prepareAcceleration(meshes, operands, geometryKeys, cached)
    return { version: 2, meshes, operands, geometryKeys, diagnostics, program, root, overlays, ...acceleration, dependencies: [], timings: { geometryMs, bvhMs: performance.now() - bvhStarted, bvhCacheHits: cacheHits } }
}
