import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CadExecutionService } from '../../platform/openscad/CadExecutionService'

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'scad-cad-中文 ')),
        script = join(root, 'fake.mjs'),
        source = join(root, 'model.scad')
    await writeFile(source, 'cube(1);')
    await writeFile(
        script,
        `import {readFileSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2); if(args.includes('--help')){console.log(' -o output\\n -d deps\\n --export-format format');process.exit(0)}
const get=flag=>args[args.indexOf(flag)+1];let text=args.at(-1)==='-'?readFileSync(0,'utf8'):readFileSync(args.at(-1),'utf8');
if(text==='sleep'){console.error('[started]');await new Promise(r=>setTimeout(r,30000))};
if(text==='zeroerror')console.error('ERROR: Assertion false failed in file -, line 2');
if(text==='flood'){process.stdout.write('x'.repeat(200000));console.error('ERROR: middle failure');process.stderr.write('x'.repeat(200000))}
writeFileSync(get('-o'),'cube(1);'); if(args.includes('-d'))writeFileSync(get('-d'),get('-o')+': '+${JSON.stringify(source)}.replaceAll(' ','\\\\ '));
`,
    )
    const service = new CadExecutionService(1, 1)
    const request = { command: { executable: process.execPath, argsPrefix: [script] }, path: source, source: 'cube(1);', env: process.env, parameters: {}, format: 'csg' as const }
    return {
        root,
        service,
        request,
        cleanup: async () => {
            service.dispose()
            await rm(root, { recursive: true, force: true })
        },
    }
}
test('CLI execution uses frozen stdin, literal argument arrays and Unicode working directories', async () => {
    const f = await fixture()
    try {
        const first = await f.service.execute(f.request)
        assert.equal(first.status, 'SUCCEEDED')
        assert.equal(first.dependenciesComplete, true)
        assert.equal(first.content.toString(), 'cube(1);')
        assert.equal(await readFile(f.request.path, 'utf8'), 'cube(1);')
        await assert.rejects(f.service.execute({ ...f.request, parameters: { 'x; touch injected': 1 } }), /Invalid OpenSCAD parameter/)
        const error = await f.service.execute({ ...f.request, source: 'zeroerror' })
        assert.equal(error.exitCode, 0)
        assert.equal(error.status, 'FAILED')
        assert.equal(error.diagnostics[0].code, 'SCAD_CLI_ASSERT_FAILED')
    } finally {
        await f.cleanup()
    }
})
test('stdout/stderr floods remain bounded and preserve errors', async () => {
    const f = await fixture()
    try {
        const r = await f.service.execute({ ...f.request, source: 'flood' })
        assert.equal(r.status, 'FAILED')
        assert.equal(r.truncated, true)
        assert.ok(r.log.length <= 262144)
        assert.ok(r.diagnostics.some((d) => d.message.includes('middle failure')))
    } finally {
        await f.cleanup()
    }
})
test('timeout, cancellation and full queue release resources and permit recovery', async () => {
    const f = await fixture()
    try {
        await f.service.probe(f.request)
        const timeout = await f.service.execute({ ...f.request, source: 'sleep', timeoutMs: 50 })
        assert.equal(timeout.status, 'TIMED_OUT')
        const abort = new AbortController(),
            queuedAbort = new AbortController()
        let started!: () => void
        const running = new Promise<void>((resolve) => {
            started = resolve
        })
        const active = f.service.execute({
            ...f.request,
            source: 'sleep',
            signal: abort.signal,
            onStderr: (text) => {
                if (text.includes('[started]')) started()
            },
        })
        await running
        const queued = f.service.execute({ ...f.request, signal: queuedAbort.signal })
        await assert.rejects(f.service.execute(f.request), /CAD_QUEUE_FULL/)
        queuedAbort.abort()
        await assert.rejects(queued, /abort|cancel/i)
        abort.abort()
        const cancelled = await active
        assert.equal(cancelled.status, 'CANCELLED')
        assert.equal((await f.service.execute(f.request)).status, 'SUCCEEDED')
    } finally {
        await f.cleanup()
    }
})
