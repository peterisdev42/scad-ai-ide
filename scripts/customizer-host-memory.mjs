import { runTests } from '@vscode/test-electron'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const executable = process.env.SCAD_VSCODE_EXECUTABLE
assert.ok(executable, 'Supply the cached VS Code executable')
// macOS Unix-domain IPC paths have a 103-byte limit; the default tmpdir plus
// a descriptive fixture name can exceed it before VS Code reaches the tests.
const directory = await mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'cmem-'))
await mkdir(path.join(directory, 'workspace'))
await mkdir(path.join(directory, 'profile/User'), { recursive: true })
await writeFile(path.join(directory, 'profile/User/settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'scad-ai-ide.languageServer.enabled': false }))
console.log(`Isolated Host memory evidence: ${directory}`)
await runTests({
    vscodeExecutablePath: executable, extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'scripts/fixtures/customizer-host-memory.cjs'),
    extensionTestsEnv: { SCAD_HOST_MEMORY_DIRECTORY: directory },
    launchArgs: [path.join(directory, 'workspace'), '--user-data-dir', path.join(directory, 'profile'), '--shared-data-dir', path.join(directory, 'shared'), '--extensions-dir', path.join(directory, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--disable-updates', '--skip-welcome', '--skip-release-notes'],
})
const result = JSON.parse(await readFile(path.join(directory, 'host-result.json'), 'utf8'))
const counts = async snapshot => {
    const raw = await readFile(snapshot.file)
    const data = JSON.parse(raw.toString())
    const fields = data.snapshot.meta.node_fields
    const types = data.snapshot.meta.node_types[fields.indexOf('type')]
    const typeIndex = fields.indexOf('type'), nameIndex = fields.indexOf('name')
    const names = new Set(['CustomizerSourceDomainService', 'CustomizerEditorActions'])
    const instances = Object.fromEntries([...names].map(name => [name, 0]))
    for (let offset = 0; offset < data.nodes.length; offset += fields.length) {
        const name = data.strings[data.nodes[offset + nameIndex]]
        if (types[data.nodes[offset + typeIndex]] === 'object' && names.has(name)) instances[name]++
    }
    return { bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex'), instances }
}
const baseline = await counts(result.snapshots.baseline)
const occupied = await counts(result.snapshots.occupied)
const final = await counts(result.snapshots.final)
for (const name of Object.keys(baseline.instances)) {
    assert.equal(occupied.instances[name], baseline.instances[name] + 1, `${name} measurement did not observe the live benchmark instance`)
    assert.equal(final.instances[name], baseline.instances[name], `${name} instances remain above baseline after six disposals`)
}
const measured = result.samples.map(sample => sample.afterDispose.usedSize)
const evidence = { ...result, snapshots: { baseline: { ...result.snapshots.baseline, ...baseline }, occupied: { ...result.snapshots.occupied, ...occupied }, final: { ...result.snapshots.final, ...final } }, postDisposeHeapRangeBytes: Math.max(...measured) - Math.min(...measured), retainedInstanceDelta: Object.fromEntries(Object.keys(baseline.instances).map(name => [name, final.instances[name] - baseline.instances[name]])), verdict: 'PASS only for tested source/editor lifecycle; no global leak-free claim' }
const output = process.env.SCAD_HOST_MEMORY_OUTPUT ?? path.join(directory, 'summary.json')
await writeFile(output, JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify(evidence, null, 2))
