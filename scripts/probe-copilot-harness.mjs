import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, cp, readFile, writeFile, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
const root = resolve('.'),
    directory = await mkdtemp(join(tmpdir(), 'cad-copilot-probe-')),
    workspace = join(directory, 'workspace'),
    observer = join(directory, 'observer'),
    extension = join(directory, 'scad-ai-ide'),
    provider = join(directory, 'provider')
for (const d of [workspace, observer, extension]) await mkdir(d)
const staged = JSON.parse(await readFile('.build/omlx-dev/host.json', 'utf8'))
for (const name of ['package.json', 'dist', 'resources', 'skills', 'instructions', 'syntaxes', 'snippets', 'media', 'server', 'licenses']) await cp(join(root, name), join(extension, name), { recursive: true })
await cp(staged.omlxExtension, provider, { recursive: true })
await cp('scripts/fixtures/cad-copilot-session.cjs', join(observer, 'session.cjs'))
await mkdir(join(workspace, '.vscode'))
await writeFile(join(workspace, '.vscode/settings.json'), JSON.stringify({ 'chat.defaultToCopilotHarness': true, 'chat.temporaryDefaultToLocalHarness': false, 'files.autoSave': 'off', 'chat.saveBeforeSend': false, 'scad-ai-ide.languageServer.enabled': false }))
await writeFile(join(observer, 'package.json'), JSON.stringify({ publisher: 'local-test', name: 'cad-copilot-probe', version: '0.0.1', engines: { vscode: '^1.140.0' }, main: 'index.cjs', activationEvents: ['onStartupFinished'] }))
await writeFile(join(observer, 'index.cjs'), `exports.activate=async()=>{const v=require('vscode'),fs=require('node:fs/promises');try{await v.extensions.getExtension('techopolis.omlx-copilot-chat').activate();await v.extensions.getExtension('GitHub.copilot-chat')?.activate();const harness=await require('./session.cjs').create(v,${JSON.stringify(directory)});const models=await v.lm.selectChatModels({});await fs.writeFile(${JSON.stringify(join(directory, 'result.json'))},JSON.stringify({harness,vscode:v.version,models:models.map(m=>({id:m.id,vendor:m.vendor,name:m.name}))},null,2))}catch(e){await fs.writeFile(${JSON.stringify(join(directory, 'result.json'))},JSON.stringify({error:String(e),stack:e.stack}))}finally{await v.commands.executeCommand('workbench.action.closeWindow')}}`)
const code = process.env.SCAD_VSCODE_EXECUTABLE ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    app = resolve(dirname(code), '../Resources/app'),
    log = await open(join(directory, 'host.txt'), 'w', 0o600)
spawn(code, [join(app, 'out/cli.js'), workspace, '--extensionDevelopmentPath=' + extension, '--extensionDevelopmentPath=' + provider, '--extensionDevelopmentPath=' + observer, '--disable-extensions', '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', log.fd, log.fd] }).unref()
await log.close()
console.log('Copilot probe: ' + directory)
let result
for (let i = 0; i < 240; i++) {
    try {
        result = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8'))
        break
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
}
console.log(JSON.stringify(result ?? { error: 'HOST_STARTUP_TIMEOUT' }, null, 2))
if (!result || result.error) process.exitCode = 1
