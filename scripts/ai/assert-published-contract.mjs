import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const baseline = JSON.parse(readFileSync(new URL('./published-contract.json', import.meta.url)))
const hash = text => createHash('sha256').update(text).digest('hex')

export function assertPublishedContract(features, contributes, readResource) {
    const tools = features.filter(feature => feature.kind === 'tool')
    const actualTools = Object.fromEntries(tools.map(({ tool, display }) => {
        const contribution = contributes.languageModelTools.find(entry => entry.name === tool.name)
        assert.ok(contribution, 'Missing packaged Agent tool')
        assert.equal(contribution.displayName, display.label)
        assert.equal(contribution.canBeReferencedInPrompt, true)
        const contract = {
            id: tool.capabilityId, risk: tool.risk, requiresInteraction: tool.requiresInteraction ?? false,
            name: contribution.name, displayName: contribution.displayName, referenceName: contribution.toolReferenceName,
            modelDescription: contribution.modelDescription, inputSchema: contribution.inputSchema,
        }
        return [tool.capabilityId, hash(JSON.stringify(contract, null, 4))]
    }))
    assert.deepEqual(actualTools, baseline.tools)
    const resources = [...contributes.chatSkills, ...contributes.chatInstructions]
    const actualResources = Object.fromEntries(resources.map(({ path }) =>
        [path, hash(readResource(path).toString('utf8').replace(/\r\n/g, '\n'))]))
    assert.deepEqual(actualResources, baseline.resources)
    assert.equal(contributes.chatSkills.length, 12)
    assert.equal(contributes.chatInstructions.length, 2)
    const configuration = Object.assign({}, ...contributes.configuration.map(section => section.properties))
    for (const [key, definition] of Object.entries(baseline.settings)) assert.deepEqual(configuration[key], definition, key)
}
