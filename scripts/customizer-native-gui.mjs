import { spawn, execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, mkdtemp, stat } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const bundle = path.join(root, '.build/customizer-native-gui/mount/OpenSCAD.app')
const executable = path.join(bundle, 'Contents/MacOS/OpenSCAD')
const helper = path.join(root, '.build/customizer-native-window')
const directory = await mkdtemp('/tmp/cgui-')
const profile = path.join(directory, 'profile')
await mkdir(profile)
const source = '/* [Dimensions] */\n// Width in millimeters\nwidth=120; // [0:5:100]\noffgrid=12; // [0:5:100]\nspin=1.25; // .25\n/* [Appearance] */\nshape="round"; // [round:Round, square:Square]\ntext="abcdef"; // 4\nchecked=true;\nvector=[1,2,3]; // [0:0.5:10]\n/* [Hidden] */\ninternalOffset=0.01;\ncube([width,2,3]);\n'
const file = path.join(directory, 'model.scad')
await writeFile(file, source)
// The environment changes only this child process. Never repurpose HOME.
// Observe existing preferences by hash so isolation is not merely assumed.
const preference = path.join(process.env.HOME, 'Library/Preferences/org.openscad.OpenSCAD.plist')
const fingerprint = async file => { try { return createHash('sha256').update(await readFile(file)).digest('hex') } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
const before = await fingerprint(preference)
if (before) await writeFile(path.join(directory, 'preferences-before.private.plist'), await readFile(preference), { mode: 0o600 })
assert.equal(process.platform, 'darwin', 'This native window observer requires macOS')
const sandbox = path.join(root, 'scripts/fixtures/customizer-native-gui.sb')
const child = spawn('/usr/bin/sandbox-exec', ['-D', `USER_HOME=${process.env.HOME}`, '-f', sandbox, executable, file], { env: { ...process.env, CFFIXED_USER_HOME: profile, XDG_CONFIG_HOME: profile }, stdio: ['ignore', 'pipe', 'pipe'] })
let exited = false, exitCode, log = ''
child.stdout.on('data', data => { log += data.toString() })
child.stderr.on('data', data => { log += data.toString() })
const closed = new Promise(resolve => { child.once('exit', code => { exited = true; exitCode = code; resolve() }); child.once('error', error => { exited = true; log += String(error); resolve() }) })
console.log(`Native GUI fixture: ${directory}; PID=${child.pid}`)
await writeFile(path.join(directory, 'live.json'), JSON.stringify({ pid: child.pid, bundle, file }))
let captured = false, windows
try {
    for (let attempt = 0; attempt < (process.env.SCAD_NATIVE_GUI_HOLD === '1' ? 1 : 12) && !exited; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        const screenshot = path.join(directory, 'window.png')
        try {
            windows = JSON.parse(execFileSync(helper, [String(child.pid), bundle, screenshot], { encoding: 'utf8', timeout: 10000 }).trim())
            captured = await stat(screenshot).then(value => value.size > 0, () => false)
            if (captured) break
        } catch (error) { log += '\nWindow observation: ' + error.message }
    }
    if (!exited && process.env.SCAD_NATIVE_GUI_HOLD === '1') {
        console.log('Native window remains live for scoped control checks; write finish in its fixture directory to stop.')
        const deadline = Date.now() + 600000
        while (!exited && Date.now() < deadline && !(await stat(path.join(directory, 'finish')).then(() => true, () => false))) await new Promise(resolve => setTimeout(resolve, 1000))
    }
} finally {
    if (!exited) child.kill('SIGTERM')
    const limit = setTimeout(() => { if (!exited) child.kill('SIGKILL') }, 5000)
    await closed
    clearTimeout(limit)
    await writeFile(path.join(directory, 'native.log'), log)
    const after = await fingerprint(preference)
    let accessibilityObserved = false
    try {
        const nodes = JSON.parse(await readFile(path.join(directory, 'ax-initial.json'), 'utf8'))
        accessibilityObserved = Array.isArray(nodes) && nodes.some(node => node.AXRole === 'AXWindow' && String(node.AXTitle).includes('model.scad'))
    } catch { /* A failed redirect/empty file is not a native window observation. */ }
    const result = { scope: 'Actual native Qt process; screenshot and AX checks are separate observations, not a blanket PASS', sandbox: 'OS denies all user-preference writes and direct file writes in the real home', executable, source, captured, accessibilityObserved, windows, exitCode, sourceUnchanged: await readFile(file, 'utf8') === source, existingPreferenceShaBefore: before, existingPreferenceShaAfter: after, existingPreferencesUnchanged: before === after, childProfile: profile }
    await writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
    assert.ok(captured || accessibilityObserved, 'No native window image or AX observation was captured')
    assert.equal(before, after, 'Preferences isolation did not hold; inspect evidence before any further GUI test')
}
