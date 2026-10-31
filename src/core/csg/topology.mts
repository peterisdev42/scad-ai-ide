import type { Manifold, ManifoldToplevel, Mat4, Vec3 } from 'manifold-3d'
import type { CsgClipPlane, CsgGeometry, CsgPreviewSceneV2 } from './types.js'

/** Only explicit geometry barriers and topology tools materialize a boolean result. */
export function materializeTopology(scene: CsgPreviewSceneV2, module: ManifoldToplevel, planes: CsgClipPlane[] = []): CsgGeometry {
    const owned = new Set<Manifold>()
    const own = (solid: Manifold) => {
        owned.add(solid)
        return solid
    }
    try {
        const leaves = scene.operands.map((operand) => {
            const mesh = scene.meshes[operand.mesh]
            const p = Buffer.from(mesh.properties, 'base64'),
                i = Buffer.from(mesh.indices, 'base64')
            const input = new module.Mesh({ numProp: mesh.stride, vertProperties: new Float32Array(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength)), triVerts: new Uint32Array(i.buffer.slice(i.byteOffset, i.byteOffset + i.byteLength)) })
            input.merge()
            const original = own(new module.Manifold(input))
            const colored = own(
                original.setProperties(5, (props, _position, old) => {
                    const source = operand.defaultColor && old.length >= 5 && old[4] < 0.5
                    for (let d = 0; d < 4; d++) props[d] = source ? old[d] : operand.color[d]
                    props[4] = operand.defaultColor && !source ? 1 : 0
                }),
            )
            const matrix = [...operand.matrix]
            for (let d = 0; d < 3; d++) matrix[12 + d] -= scene.origin[d]
            return own(colored.transform(matrix as Mat4))
        })
        const values: Manifold[] = []
        for (const instruction of scene.program) {
            values.push(instruction.op === 'empty' ? own(new module.Manifold(new module.Mesh({ numProp: 3, vertProperties: new Float32Array(), triVerts: new Uint32Array() }))) : instruction.op === 'leaf' ? leaves[instruction.operand] : own(module.Manifold[instruction.op]([values[instruction.left], values[instruction.right]])))
        }
        if (planes.length > 8) throw new Error('Topology clipping plane budget exceeded.')
        let result = values[scene.root]
        for (const plane of planes) {
            if (plane.normal.length !== 3 || ![...plane.normal, plane.constant].every(Number.isFinite) || Math.hypot(...plane.normal) < 1e-12) throw new Error('Invalid topology clipping plane.')
            result = own(result.trimByPlane(plane.normal as Vec3, -plane.constant - plane.normal.reduce((sum, n, d) => sum + n * scene.origin[d], 0)))
        }
        if (planes.length)
            result = own(
                result.setProperties(5, (props, _position, old) => {
                    const cap = old.every((v) => v === 0),
                        operand = scene.operands[0]
                    for (let d = 0; d < 4; d++) props[d] = cap ? operand.color[d] : old[d]
                    props[4] = cap ? (operand.defaultColor ? 1 : 0) : old[4]
                }),
            )
        const mesh = result.getMesh()
        return { version: 1, origin: scene.origin, meshes: mesh.triVerts.length ? [{ stride: mesh.numProp, properties: Buffer.from(mesh.vertProperties.buffer, mesh.vertProperties.byteOffset, mesh.vertProperties.byteLength).toString('base64'), indices: Buffer.from(mesh.triVerts.buffer, mesh.triVerts.byteOffset, mesh.triVerts.byteLength).toString('base64') }] : [] }
    } finally {
        for (const object of owned) object.delete()
    }
}
