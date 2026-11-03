import { parentPort } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import Module, { type Mat4, type Vec3 } from 'manifold-3d'
import { BufferGeometry, Color, Mesh, MeshBasicMaterial } from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { DOMParser } from 'linkedom'
import { threeMfMillimeterScale } from './threeMf.js'
import type { ClipPlane, GeometryData } from '../preview/types.js'
// XML parsing is isolated to this disposable worker, never the extension host.
Object.assign(globalThis, { DOMParser })
const module = await Module({ locateFile: () => fileURLToPath(new URL('./manifold.wasm', import.meta.url)) })
module.setup()
parentPort!.once('message', (request: { content: string; format: 'stl' | '3mf'; planes: ClipPlane[] }) => {
    try {
        const bytes = Buffer.from(request.content, 'base64'),
            buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            meshes: Mesh<BufferGeometry>[] = []
        if (request.format === 'stl') meshes.push(new Mesh(new STLLoader().parse(buffer), new MeshBasicMaterial()))
        else {
            const group = new ThreeMFLoader().parse(buffer)
            group.scale.multiplyScalar(threeMfMillimeterScale(bytes))
            group.updateMatrixWorld(true)
            group.traverse((o) => {
                if (o instanceof Mesh) meshes.push(o)
            })
        }
        const result: GeometryData = { version: 1, meshes: [] }
        for (const mesh of meshes) {
            const geometry = mesh.geometry,
                position = geometry.getAttribute('position'),
                index = geometry.getIndex(),
                values = new Float32Array(position.count * 8),
                indices = new Uint32Array(index ? index.array : Array.from({ length: position.count }, (_, i) => i))
            const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
            const base = 'color' in material && material.color instanceof Color ? material.color : new Color(1, 1, 1)
            const colors = geometry.getAttribute('color'),
                defaultColor = request.format === 'stl' || ['f9d72c', '9dcb51'].includes(base.getHexString())
            for (let v = 0; v < position.count; v++) {
                values.set([position.getX(v), position.getY(v), position.getZ(v), colors ? colors.getX(v) : base.r, colors ? colors.getY(v) : base.g, colors ? colors.getZ(v) : base.b, material.opacity, defaultColor && !colors ? 1 : 0], v * 8)
            }
            const input = new module.Mesh({ numProp: 8, vertProperties: values, triVerts: indices })
            input.merge()
            const owned = new Set<InstanceType<typeof module.Manifold>>()
            try {
                let solid = new module.Manifold(input)
                owned.add(solid)
                solid = solid.transform(mesh.matrixWorld.toArray() as Mat4)
                owned.add(solid)
                for (const plane of request.planes) {
                    solid = solid.trimByPlane(plane.normal as Vec3, -plane.constant)
                    owned.add(solid)
                }
                solid = solid.setProperties(5, (properties, _point, old) => {
                    const cap = old.every((x) => x === 0)
                    for (let k = 0; k < 4; k++) properties[k] = cap ? [base.r, base.g, base.b, material.opacity][k] : old[k]
                    properties[4] = cap ? Number(defaultColor) : old[4]
                })
                owned.add(solid)
                const data = solid.getMesh()
                if (data.triVerts.length) result.meshes.push({ stride: data.numProp, properties: Buffer.from(data.vertProperties.buffer, data.vertProperties.byteOffset, data.vertProperties.byteLength).toString('base64'), indices: Buffer.from(data.triVerts.buffer, data.triVerts.byteOffset, data.triVerts.byteLength).toString('base64') })
            } finally {
                for (const solid of owned) solid.delete()
                geometry.dispose()
            }
        }
        parentPort!.postMessage({ geometry: result })
    } catch (e) {
        parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) })
    }
})
