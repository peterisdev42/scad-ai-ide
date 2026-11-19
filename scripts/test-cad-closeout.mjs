import { spawn } from 'node:child_process'
import { mkdir, open, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicJson, fingerprint } from './helpers/cad-evidence.mjs'
const repo = fileURLToPath(new URL('../', import.meta.url))
const evidence = resolve(repo, '.build/cad-closeout')
const runtime = process.env.SCAD_OPENSCAD_EXECUTABLE
const env = { ...process.env, ...(runtime && { SCAD_TEST_OPENSCAD: runtime }) }
const action = process.argv[2]
if (action === 'baseline') {
    if (!runtime) throw new Error('Set SCAD_OPENSCAD_EXECUTABLE to an official OpenSCAD executable.')
    const dir = join(evidence, 'baseline-' + new Date().toISOString().replaceAll(/[:.]/g, '-'))
    await mkdir(dir, { recursive: true })
    const results = []
    const run = async (name, args, extraEnv = {}) => {
        const log = await open(join(dir, name + '.txt'), 'w', 0o600),
            started = Date.now()
        console.log(`Closeout ${name}: ${args.join(' ')}`)
        const child = spawn(args[0], args.slice(1), { cwd: repo, env: { ...env, ...extraEnv }, stdio: ['ignore', log.fd, log.fd] })
        const exitCode = await new Promise((resolve) => {
            child.once('error', () => resolve(127))
            child.once('exit', (code) => resolve(code ?? 1))
        })
        await log.close()
        const row = { name, command: args, exitCode, elapsedMs: Date.now() - started, log: join(dir, name + '.txt') }
        results.push(row)
        await atomicJson(join(dir, 'commands.json'), results)
        console.log(JSON.stringify(row))
        return exitCode
    }
    // Only these determine the deterministic CAD baseline; full desktop/release gates remain separate.
    for (const [name, args] of [
        ['default', ['npm', 'test']],
        ['real-cli', [process.execPath, '--import', 'tsx', '--test', 'src/test/cad/real.acceptance.ts', 'src/test/mesh/real.acceptance.ts', 'src/test/assembly/real.acceptance.ts']],
        ['manifest', ['npm', 'run', 'test:agents:manifest']],
        ['view', ['npm', 'run', 'test:review:view']],
        ['gpu', ['npm', 'run', 'test:review:gpu']],
        ['package', ['npm', 'run', 'package']],
    ]) {
        if (await run(name, args)) {
            const failure = { status: 'FAIL', results }
            await atomicJson(join(dir, 'baseline.json'), failure)
            await atomicJson(join(evidence, 'baseline.json'), failure)
            process.exitCode = 1
            break
        }
    }
    if (!process.exitCode) {
        const before = await fingerprint(repo)
        const host = await run('cad-host', [process.execPath, 'scripts/test-review-host.mjs', 'stable'], { SCAD_HOST_GREP: 'CAD verification Extension Host|Raw mesh verification Extension Host|Static assembly Extension Host|Frozen CAD review Extension Host', SCAD_HOST_TEMP: '1' })
        const candidate = await fingerprint(repo)
        const result = { status: host === 0 && before.id === candidate.id ? 'PASS' : 'FAIL', candidateId: candidate.id, candidate, results, at: new Date().toISOString(), scope: 'Deterministic CAD, real CLI, native CAD tools; not full desktop/real Agent/manual/platform PASS' }
        await atomicJson(join(dir, 'baseline.json'), result)
        await atomicJson(join(evidence, 'baseline.json'), result)
        console.log(`CAD baseline: ${join(evidence, 'baseline.json')}`)
        process.exitCode = result.status === 'PASS' ? 0 : 1
    }
} else {
    console.log('Usage: node scripts/test-cad-closeout.mjs baseline')
    process.exitCode = action ? 1 : 0
}
