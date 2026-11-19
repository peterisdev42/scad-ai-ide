import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { sha256, atomicJson, fingerprint } from './helpers/cad-evidence.mjs'
const repo = resolve('.'),
    base = resolve('.build/cad-manual'),
    id = new Date().toISOString().replaceAll(/[:.]/g, '-')
const directory = join(base, id),
    a = join(directory, 'project-a'),
    b = join(directory, 'project-b')
await mkdir(join(a, '.scad'), { recursive: true })
await mkdir(join(a, 'assembly', '.scad'), { recursive: true })
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
const gapManifest = {
    ...manifest,
    parts: ['body', 'lid'].map((id) => ({ id, selector: { type: 'define', name: 'part', value: id }, transform: { translate: [0, 0, 0], rotate: [0, 0, 0] } })),
    checks: [
        { id: 'gap', type: 'clearance', parts: ['body', 'lid'], min: 0.25, max: 0.35 },
        { id: 'body-volume', type: 'volume', part: 'body', min: 1083.99, max: 1084.01 },
        { id: 'lid-volume', type: 'volume', part: 'lid', min: 399.99, max: 400.01 },
        { id: 'body-bounds', type: 'bounds', part: 'body', minDimensions: [19.99999, 19.99999, 9.99999], maxDimensions: [20.00001, 20.00001, 10.00001] },
        { id: 'lid-bounds', type: 'bounds', part: 'lid', minDimensions: [19.99999, 19.99999, 0.99999], maxDimensions: [20.00001, 20.00001, 1.00001] },
    ],
}
const files = {
    'project-a/model.scad': source,
    'project-a/syntax.scad': 'module example() {\n    cube(1);\n}\n',
    'project-a/dirty.scad': 'width=0;\nassert(width>0,"width must be positive");\ncube(width);\n',
    'project-a/customizer.scad': 'width=40;\nshape="round";\ninternalOffset=0.01;\nmodule model() { cube([width,2,3]); }\nmodel();\n',
    'project-a/inward.stl': await readFile('src/test/mesh/golden/inward-ascii.stl'),
    'project-a/.scad/verification.json': JSON.stringify(manifest, null, 2),
    'project-a/.scad/print-profile.json': JSON.stringify(profile, null, 2),
    'project-a/assembly/model.scad': 'part="body";\ngap=0.18;\nif(part=="body") difference(){cube([20,20,10]);translate([1,1,1])cube([18,18,10]);}\nelse if(part=="lid") translate([0,0,10+gap])cube([20,20,1]);\n',
    'project-a/assembly/.scad/verification.json': JSON.stringify(gapManifest, null, 2),
    'project-b/isolated.stl': await readFile('src/test/mesh/golden/box-ascii.stl'),
}
for (const [name, content] of Object.entries(files)) await writeFile(join(directory, name), content, { flag: 'wx' })
const candidate = await fingerprint(repo)
await atomicJson(join(directory, 'fixture.json'), { id, created: new Date().toISOString(), candidateId: candidate.id, projectA: a, projectB: b, hashes: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, sha256(value)])), scope: 'Temporary manual fixtures only; no automatic acceptance, confirmation, save or surface submission' })
const workspace = join(directory, 'manual.code-workspace')
const workspaceSettings = { folders: [{ path: a }], settings: { 'chat.saveBeforeSend': false, 'files.autoSave': 'off', 'scad-ai-ide.languageServer.enabled': false } }
await atomicJson(workspace, workspaceSettings)
await atomicJson(join(base, 'current/manual.code-workspace'), workspaceSettings)
console.log(JSON.stringify({ directory, workspace, checklist: resolve('docs/cad/manual-acceptance.md'), launchArgs: ['--new-window', `--extensionDevelopmentPath=${repo}`, workspace] }, null, 2))
