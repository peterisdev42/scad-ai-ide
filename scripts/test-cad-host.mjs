import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'

assert.ok(process.env.SCAD_OPENSCAD_EXECUTABLE, 'ENV_UNAVAILABLE: set SCAD_OPENSCAD_EXECUTABLE')
const directory = resolve('.build/cad-host', `${Date.now()}`)
const workspace = join(directory, 'workspace'),
    profile = join(directory, 'profile')
await mkdir(join(workspace, '.vscode'), { recursive: true })
await mkdir(join(profile, 'User'), { recursive: true })
await writeFile(join(profile, 'User', 'settings.json'), JSON.stringify({ 'scad-ai-ide.openscadPath': process.env.SCAD_OPENSCAD_EXECUTABLE, 'chat.saveBeforeSend': false, 'files.autoSave': 'off' }))
const child = spawn(process.execPath, ['node_modules/@vscode/test-cli/out/bin.mjs', '--grep', 'CAD verification'], { stdio: 'inherit', env: { ...process.env, SCAD_TEST_WORKSPACE: workspace, SCAD_TEST_USER_DATA: profile } })
child.on('error', (error) => {
    console.error(error)
    process.exitCode = 1
})
child.on('exit', (code) => {
    process.exitCode = code ?? 1
    console.log(`CAD Host evidence profile: ${directory}; exit=${code}`)
})
