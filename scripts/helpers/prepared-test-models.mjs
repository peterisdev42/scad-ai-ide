import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
export async function preparedTestModels() {
    const directory = await mkdtemp(join(tmpdir(), 'prepared-test-models-'))
    try {
        await build({ entryPoints: ['src/core/preview/read.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: join(directory, 'reader.cjs'), logLevel: 'silent' })
        const { readPreviewScene } = createRequire(import.meta.url)(join(directory, 'reader.cjs'))
        const fixture = resolve('src/test/preview/fixtures/prepared'),
            encoded = async (name) => Buffer.from(JSON.stringify(readPreviewScene(await readFile(join(fixture, name + '.csgp'))))).toString('base64')
        const topology = async (name) => JSON.parse(await readFile(join(fixture, name + '.topology.json'), 'utf8'))
        return { csg: await encoded('cube'), denserCsg: await encoded('sphere'), complexCsg: await encoded('complex'), difference: await encoded('difference'), topology: await topology('cube'), differenceTopology: await topology('difference') }
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}
