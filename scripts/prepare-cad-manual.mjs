import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { sha256, atomicJson, fingerprint } from './helpers/cad-native-run.mjs'
const repo = resolve('.'),
    base = resolve('.build/cad-manual'),
    id = new Date().toISOString().replaceAll(/[:.]/g, '-')
const directory = join(base, id),
    a = join(directory, 'project-a'),
    b = join(directory, 'project-b')
await mkdir(join(a, '.scad'), { recursive: true })
await mkdir(b, { recursive: true })
await mkdir(join(base, 'current'), { recursive: true })
const source = 'part="body";\nhole=2;\nif(part=="body") difference(){cube([20,20,5]);translate([10,10,-1])cylinder(h=7,r=hole,$fn=32);}\nelse if(part=="shell")translate([30,0,0])cube([10,10,5]);\n'
const manifest = {
    schemaVersion: 1,
    units: 'mm',
    entry: './model.scad',
    parts: ['body', 'shell'].map((id) => ({ id, selector: { type: 'define', name: 'part', value: id } })),
    checks: [
        { id: 'body-bounds', type: 'bounds', part: 'body', minDimensions: [19.9999, 19.9999, 4.9999], maxDimensions: [20.0001, 20.0001, 5.0001] },
        { id: 'body-volume', type: 'volume', part: 'body', min: 1800, max: 2000 },
        { id: 'shell-volume', type: 'volume', part: 'shell', min: 499.99, max: 500.01 },
    ],
}
const profile = { schemaVersion: 1, units: 'mm', process: 'fdm', buildVolumeMm: [200, 200, 200], buildPose: { rotate: [0, 0, 0], translate: [0, 0, 0] }, maxOverhangFromVerticalDeg: 45 }
const files = { 'project-a/model.scad': source, 'project-a/syntax.scad': 'module example() {\n    cube(1);\n}\n', 'project-a/dirty.scad': 'width=0;\nassert(width>0,"width must be positive");\ncube(width);\n', 'project-a/.scad/verification.json': JSON.stringify(manifest, null, 2), 'project-a/.scad/print-profile.json': JSON.stringify(profile, null, 2), 'project-b/isolated.stl': await readFile('src/test/mesh/golden/box-ascii.stl', 'utf8') }
for (const [name, content] of Object.entries(files)) await writeFile(join(directory, name), content, { flag: 'wx' })
const candidate = await fingerprint(repo)
await atomicJson(join(directory, 'fixture.json'), { id, created: new Date().toISOString(), candidateId: candidate.id, projectA: a, projectB: b, hashes: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, sha256(value)])), scope: 'Temporary manual fixtures only; no automatic acceptance, confirmation, save or surface submission' })
const workspace = join(base, 'current/manual.code-workspace')
await atomicJson(workspace, { folders: [{ path: a }], settings: { 'chat.saveBeforeSend': false, 'files.autoSave': 'off', 'scad-ai-ide.languageServer.enabled': false } })
console.log(JSON.stringify({ directory, workspace, checklist: resolve('docs/cad/manual-acceptance.md'), launch: 'CAD Manual Acceptance + oMLX' }, null, 2))
