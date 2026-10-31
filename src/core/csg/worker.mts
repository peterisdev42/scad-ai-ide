import { withFontDirectories } from './fontResolver.mjs'
import { parentPort } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import Module, { type Vec2 } from 'manifold-3d'
import { evaluateCsg, serializeCsg } from './evaluate.mjs'
import { materializeTopology } from './topology.mjs'
import type { CsgScene, CsgCachedGeometry, CsgClipPlane } from './types.js'
import { prepareCsgResources, nodeResourceResolver, meshResource } from './resources.mjs'
import { initializeGeometry } from './geometry.mjs'

const manifold = await Module({ locateFile: () => fileURLToPath(new URL('./manifold.wasm', import.meta.url)) })
manifold.setup()
parentPort!.on('message', async (request: string | { source: string; cwd?: string; fontDirectories?: string[]; dependencies?: { path: string; stamp: string }[]; cached?: Record<string, CsgCachedGeometry> } | { topology: CsgScene; planes?: CsgClipPlane[] } | { meshTopology: { content: string; format: 'stl' | '3mf' }; planes?: CsgClipPlane[] }) => {
    try {
        if (typeof request !== 'string' && 'topology' in request) {
            parentPort!.postMessage({ scene: materializeTopology(request.topology, manifold, request.planes) })
            return
        }
        if (typeof request !== 'string' && 'meshTopology' in request) {
            if (!['stl', '3mf'].includes(request.meshTopology.format) || request.meshTopology.content.length > 256 * 1048576) throw new Error('Invalid or oversized standard mesh topology request.')
            const scene = evaluateCsg(serializeCsg(meshResource(Buffer.from(request.meshTopology.content, 'base64'), request.meshTopology.format)), manifold)
            parentPort!.postMessage({ scene: request.planes?.length ? materializeTopology(scene, manifold, request.planes) : { version: 1, meshes: scene.meshes } })
            return
        }
        const resourceStarted = performance.now()
        const source = typeof request === 'string' ? request : request.source
        const prepared = /\b(?:text|import|surface)\s*\(/.test(source) ? await prepareCsgResources(source, typeof request === 'string' ? process.cwd() : (request.cwd ?? process.cwd()), withFontDirectories({ ...nodeResourceResolver, triangulate: (contours) => manifold.triangulate(contours as Vec2[][]) }, typeof request === 'string' ? [] : (request.fontDirectories ?? []), typeof request === 'string' ? process.cwd() : (request.cwd ?? process.cwd()))) : { source, dependencies: [] }
        await initializeGeometry(prepared.source)
        const resourcesMs = performance.now() - resourceStarted
        const scene = evaluateCsg(prepared.source, manifold, typeof request === 'string' ? undefined : request.cached)
        const dependencies = typeof request === 'string' ? prepared.dependencies : [...(request.dependencies ?? []), ...prepared.dependencies]
        scene.timings.resourcesMs = resourcesMs
        for (const dependency of dependencies) if ((await nodeResourceResolver.stamp(dependency.path)) !== dependency.stamp) throw new Error(`CSG resource changed during compilation: ${dependency.path}`)
        scene.dependencies = [...new Map(dependencies.map((dependency) => [dependency.path, dependency])).values()]
        parentPort!.postMessage({ scene })
    } catch (error) {
        parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) })
    }
})
