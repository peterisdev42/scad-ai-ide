import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const groups = JSON.parse(await readFile(path.join(root, 'src/core/capabilities/gui-actions.json'), 'utf8'))
const files = [
    'scripts/agent-manifest.mjs', 'scripts/assert-feature-branch.mjs', 'package.json',
    'src/core/capabilities/catalog.json', 'src/core/capabilities/gui-actions.json', 'src/core/capabilities/resources.json',
    'docs/gui-agent-parity.md', 'docs/agent-capability-catalog.md',
    ...['openscad', 'openscad-customizer'].map(name => `instructions/${name}.instructions.md`),
    ...['openscad-runtime', 'openscad-libraries', 'openscad-customizer', 'openscad-customizer-authoring', 'scad-ai-ide-diagnostics', 'openscad-model-debugging'].map(name => `skills/${name}/SKILL.md`),
    ...['AgentToolAdapter.ts', 'registerAgentTools.ts', 'registerCapabilities.ts'].map(name => `src/features/agents/${name}`),
    ...groups.map(group => group.source),
]
for (const [label, newline] of [['LF', '\n'], ['CRLF', '\r\n']]) {
    test(`Agent assets and generated contract verification tolerate ${label} checkouts and still reject stale content`, async () => {
        // Keep the isolated tree under the repo so Node finds the installed Ajv
        // without symlink privileges (including on Windows runners).
        await mkdir(path.join(root, '.build'), { recursive: true })
        const fixture = await mkdtemp(path.join(root, '.build', 'manifest-newlines-'))
        try {
            for (const name of new Set(files)) {
                const source = (await readFile(path.join(root, name), 'utf8')).replace(/\r\n/g, '\n').replace(/\n/g, newline)
                const target = path.join(fixture, name)
                await mkdir(path.dirname(target), { recursive: true })
                await writeFile(target, source)
            }
            const check = () => spawnSync(process.execPath, [path.join(fixture, 'scripts/agent-manifest.mjs')], { encoding: 'utf8' })
            let result = check()
            assert.equal(result.status, 0, result.stderr)
            assert.match(result.stdout, /Validated 42 tools, 2 instruction and 6 skills/)
            const resource = path.join(fixture, 'src/core/capabilities/resources.json')
            const data = JSON.parse(await readFile(resource, 'utf8'))
            data[0].description += ' stale description'
            await writeFile(resource, (JSON.stringify(data, null, 2) + '\n').replace(/\n/g, newline))
            result = check()
            assert.notEqual(result.status, 0, 'A stale semantic value must still fail with either newline style')
            assert.match(result.stderr, /Stale AI Panel resources/)
        } finally { await rm(fixture, { recursive: true, force: true }) }
    })
}
