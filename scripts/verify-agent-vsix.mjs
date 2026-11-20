import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
import assert from 'node:assert/strict'
import { assertPublishedContract } from './ai/assert-published-contract.mjs'

const sourceAsset = asset => readFileSync(new URL('../' + asset, import.meta.url))

export function verifyAgentVsix(files, readSourceAsset, { frozen = false } = {}) {
    const manifest = JSON.parse(strFromU8(files['extension/package.json']))
    const generated = 'src/ai/generated/'
    const catalogFile = generated + 'feature-catalog.generated.json'
    const catalog = JSON.parse(strFromU8(files['extension/' + catalogFile]))
    const tools = catalog.features.filter(feature => feature.kind === 'tool')
    const resources = catalog.features.flatMap(feature => feature.resource ? [feature.resource.path] : []).sort()
    assert.deepEqual(manifest.contributes.languageModelTools.map(tool => tool.name).sort(), tools.map(({ tool }) => tool.name).sort())
    assert.deepEqual(Object.entries(manifest.contributes)
        .filter(([key]) => ['chatSkills', 'chatInstructions', 'chatPromptFiles', 'chatAgents'].includes(key))
        .flatMap(([, entries]) => entries.map(entry => entry.path)).sort(), resources)
    for (const asset of [...resources, manifest.main, catalogFile, ...['ai-panel-layout.generated.json', 'ai-panel-state.schema.json', 'ai-preferences.schema.json'].map(file => generated + file)]) {
        const name = `extension/${asset.replace(/^\.\//, '')}`
        assert.ok(files[name]?.length > 0, `Missing packaged asset: ${name}`)
        if (asset.startsWith(generated)) {
            const packaged = JSON.parse(strFromU8(files[name]))
            if (readSourceAsset) assert.deepEqual(packaged, JSON.parse(readSourceAsset(asset)))
        }
    }
    for (const asset of ['licenses/saxes/LICENSE', 'licenses/robust-predicates/LICENSE', 'dist/mesh-verification-worker.mjs', 'dist/assembly-verification-worker.mjs', 'dist/review-geometry-worker.mjs', 'dist/review-view.js', 'resources/schemas/cad-print-profile-v1.schema.json','resources/schemas/cad-comparison-v1.schema.json','resources/schemas/cad-feedback-v1.schema.json','resources/schemas/cad-print-assessment-v1.schema.json','resources/schemas/cad-review-bundle-v1.schema.json', 'resources/schemas/cad-verification-v1.schema.json', 'resources/schemas/cad-report-v3.schema.json', 'resources/schemas/cad-report-v2.schema.json', 'resources/schemas/cad-report-v1.schema.json', 'media/panels/ai.js', 'media/panels/index.html', 'media/panels/main.js', 'media/panels/main.css']) assert.ok(files[`extension/${asset}`]?.length > 0, `Missing AI Panel asset: ${asset}`)
    if (frozen) assertPublishedContract(catalog.features, manifest.contributes,
        asset => files[`extension/${asset.replace(/^\.\//, '')}`])
    return { tools: tools.length, instructions: manifest.contributes.chatInstructions.length, skills: manifest.contributes.chatSkills.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const target = process.argv[2]
    assert.ok(target, 'Usage: node scripts/verify-agent-vsix.mjs /absolute/path.vsix')
    const { tools, instructions, skills } = verifyAgentVsix(unzipSync(readFileSync(target)), sourceAsset)
    console.log(`VSIX PASS: ${tools} tools, ${instructions} Instructions, ${skills} Skills and bundled extension entry + AI Panel assets.`)
}
