import { spawn } from 'node:child_process'
import { mkdir, open, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicJson, fingerprint, PRIMARY } from './helpers/cad-native-run.mjs'
import assert from 'node:assert/strict'
const repo = fileURLToPath(new URL('../', import.meta.url))
const evidence = resolve(repo, 'docs/cad/evidence/closeout')
const runtime = process.env.SCAD_OPENSCAD_EXECUTABLE ?? '/Users/q/Library/Application Support/Code/User/globalStorage/undefined_publisher.scad-ai-ide/runtimes/darwin-arm64/700816722/bin/openscad'
const code = process.env.SCAD_VSCODE_EXECUTABLE ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code'
const env = { ...process.env, SCAD_OPENSCAD_EXECUTABLE: runtime, SCAD_TEST_OPENSCAD: runtime, SCAD_VSCODE_EXECUTABLE: code }
const action = process.argv[2]
if (action === 'baseline') {
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
        ['harness', [process.execPath, '--test', 'scripts/cad-native-policy.test.mjs']],
        ['default', ['npm', 'test']],
        ['real-cli', [process.execPath, '--import', 'tsx', '--test', 'src/test/cad/real.acceptance.ts', 'src/test/mesh/real.acceptance.ts', 'src/test/assembly/real.acceptance.ts']],
        ['manifest', ['npm', 'run', 'test:agents:manifest']],
        ['view', ['npm', 'run', 'test:review:view']],
        ['gpu', ['npm', 'run', 'test:review:gpu']],
        ['package', ['npm', 'run', 'package']],
    ]) {
        if (await run(name, args)) {
            await atomicJson(join(dir, 'baseline.json'), { status: 'FAIL', results })
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
        console.log(`SCAD_NATIVE_BASELINE=${join(evidence, 'baseline.json')}`)
        process.exitCode = result.status === 'PASS' ? 0 : 1
    }
} else if (action === 'native') {
    const scenario = process.argv[3]
    const scripts = { diagnostics: ['test-cad-native.mjs'], mesh: ['test-mesh-native.mjs'], assembly: ['test-assembly-native.mjs'], comparison: ['test-review-native.mjs', 'comparison'], feedback: ['test-review-native.mjs', 'feedback'] }
    assert.ok(scripts[scenario], 'Scenario must be diagnostics / mesh / assembly / comparison / feedback')
    const child = spawn(
        process.execPath,
        scripts[scenario].map((a, i) => (i ? a : join(repo, 'scripts', a))),
        { cwd: repo, env: { ...env, SCAD_NATIVE_BASELINE: process.env.SCAD_NATIVE_BASELINE ?? join(evidence, 'baseline.json'), SCAD_AGENT_MODEL: process.env.SCAD_AGENT_MODEL ?? PRIMARY, SCAD_AGENT_TIMEOUT_MS: '600000' }, stdio: 'inherit' },
    )
    process.exitCode = await new Promise((resolve) => {
        child.once('error', () => resolve(127))
        child.once('exit', (code) => resolve(code ?? 1))
    })
} else {
    console.log('Usage: node scripts/test-cad-closeout.mjs baseline | native <diagnostics|mesh|assembly|comparison|feedback>')
    console.log('Each frozen candidate/scenario/model reserves one immutable attempt. Backup requires SCAD_NATIVE_BACKUP_OF with supported evidence. Manual work has its own checklist.')
    process.exitCode = action ? 1 : 0
}
