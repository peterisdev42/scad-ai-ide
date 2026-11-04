import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { writeFile, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { fixture } from './helpers'
test('Independent Node extension hosts serialize changes to the same Store', async () => {
    const f = await fixture()
    try {
        const worker = path.join(f.root, 'worker.cjs')
        const counter = path.join(f.root, 'counter.json')
        await writeFile(counter, '0')
        await writeFile(worker, `const {withLock}=require(${JSON.stringify(path.resolve('src/platform/libraries/files.ts'))}); const fs=require('node:fs/promises'); withLock(process.argv[2],async()=>{const n=JSON.parse(await fs.readFile(process.argv[3],'utf8'));await new Promise(r=>setTimeout(r,30));await fs.writeFile(process.argv[3],JSON.stringify(n+1))}).catch(e=>{console.error(e);process.exitCode=1});`)
        const run = () =>
            new Promise<void>((resolve, reject) => {
                const child = spawn(process.execPath, ['--import', 'tsx', worker, path.join(f.store.root, '.mutation-lock'), counter], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
                let error = ''
                child.stderr.on('data', (chunk) => {
                    error += chunk.toString()
                })
                child.on('error', reject)
                child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(error))))
            })
        await Promise.all([run(), run(), run(), run()])
        assert.equal(JSON.parse(await readFile(counter, 'utf8')), 4)
    } finally {
        await f.cleanup()
    }
})

test('Abandoned heartbeat leases can be recovered before replaying a project transaction', async () => {
    const f = await fixture()
    try {
        const { mkdir, utimes } = await import('node:fs/promises')
        const lock = path.join(f.store.root, '.mutation-lock')
        await mkdir(lock, { recursive: true })
        const stale = new Date(Date.now() - 60000)
        await utimes(lock, stale, stale)
        let acquired = false
        await f.store.exclusive(async () => {
            acquired = true
        })
        assert.equal(acquired, true)
    } finally {
        await f.cleanup()
    }
})
