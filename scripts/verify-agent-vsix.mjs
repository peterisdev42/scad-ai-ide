import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
import assert from 'node:assert/strict'

const target = process.argv[2]
assert.ok(target, 'Usage: node scripts/verify-agent-vsix.mjs /absolute/path.vsix')
const files = unzipSync(readFileSync(target))
const manifest = JSON.parse(strFromU8(files['extension/package.json']))
const catalog = JSON.parse(readFileSync(new URL('../src/core/capabilities/catalog.json', import.meta.url)))
assert.deepEqual(manifest.contributes.languageModelTools.map((tool) => tool.name).sort(), catalog.map((d) => d.toolName).sort())
for (const resource of [...manifest.contributes.chatInstructions, ...manifest.contributes.chatSkills, { path: manifest.main }]) {
    const name = `extension/${resource.path.replace(/^\.\//, '')}`
    assert.ok(files[name]?.length > 0, `Missing packaged asset: ${name}`)
}
for (const asset of ['media/panels/ai.js', 'media/panels/index.html', 'media/panels/main.js', 'media/panels/main.css']) assert.ok(files[`extension/${asset}`]?.length > 0, `Missing AI Panel asset: ${asset}`)
console.log(`VSIX PASS: ${catalog.length} tools, 1 Instruction, 4 Skills and bundled extension entry + AI Panel assets.`)
