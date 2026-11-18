import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
import assert from 'node:assert/strict'

const target = process.argv[2]
assert.ok(target, 'Usage: node scripts/verify-agent-vsix.mjs /absolute/path.vsix')
const files = unzipSync(readFileSync(target))
const manifest = JSON.parse(strFromU8(files['extension/package.json']))
const generated = 'src/ai/generated/'
const catalogFile = generated + 'feature-catalog.generated.json'
const catalog = JSON.parse(readFileSync(new URL('../' + catalogFile, import.meta.url)))
const tools = catalog.features.filter(feature => feature.kind === 'tool')
const resources = catalog.features.flatMap(feature => feature.resource ? [feature.resource.path] : []).sort()
assert.deepEqual(manifest.contributes.languageModelTools.map(tool => tool.name).sort(), tools.map(({ tool }) => tool.name).sort())
assert.deepEqual(Object.entries(manifest.contributes)
    .filter(([key]) => ['chatSkills', 'chatInstructions', 'chatPromptFiles', 'chatAgents'].includes(key))
    .flatMap(([, entries]) => entries.map(entry => entry.path)).sort(), resources)
for (const asset of [...resources, manifest.main, catalogFile, ...['ai-panel-layout.generated.json', 'ai-panel-state.schema.json', 'ai-preferences.schema.json'].map(file => generated + file)]) {
    const name = `extension/${asset.replace(/^\.\//, '')}`
    assert.ok(files[name]?.length > 0, `Missing packaged asset: ${name}`)
    if (asset.startsWith(generated)) assert.deepEqual(JSON.parse(strFromU8(files[name])), JSON.parse(readFileSync(new URL('../' + asset, import.meta.url))))
}
for (const asset of ['licenses/saxes/LICENSE', 'licenses/robust-predicates/LICENSE', 'dist/mesh-verification-worker.mjs', 'dist/assembly-verification-worker.mjs', 'dist/review-geometry-worker.mjs', 'dist/review-view.js', 'resources/schemas/cad-print-profile-v1.schema.json','resources/schemas/cad-comparison-v1.schema.json','resources/schemas/cad-feedback-v1.schema.json','resources/schemas/cad-print-assessment-v1.schema.json','resources/schemas/cad-review-bundle-v1.schema.json', 'resources/schemas/cad-verification-v1.schema.json', 'resources/schemas/cad-report-v3.schema.json', 'resources/schemas/cad-report-v2.schema.json', 'resources/schemas/cad-report-v1.schema.json', 'media/panels/ai.js', 'media/panels/index.html', 'media/panels/main.js', 'media/panels/main.css']) assert.ok(files[`extension/${asset}`]?.length > 0, `Missing AI Panel asset: ${asset}`)
console.log(`VSIX PASS: ${tools.length} tools, ${manifest.contributes.chatInstructions.length} Instructions, ${manifest.contributes.chatSkills.length} Skills and bundled extension entry + AI Panel assets.`)
