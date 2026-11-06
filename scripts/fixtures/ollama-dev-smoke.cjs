const vscode = require('vscode')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

exports.run = async () => {
    const ollama = vscode.extensions.getExtension('Ollama.ollama')
    assert.ok(ollama, 'Ollama must be visible in the development host')
    await ollama.activate()
    const own = vscode.extensions.all.find((extension) => extension.packageJSON.name === 'scad-ai-ide')
    assert.ok(own)
    await own.activate()
    const staged = vscode.extensions.all.filter((extension) => extension.extensionPath.startsWith(process.env.SCAD_OLLAMA_EXTENSIONS_DIR))
    assert.deepEqual(staged.map((extension) => extension.id.toLowerCase()), ['ollama.ollama'])
    const builtinRoot = path.join(vscode.env.appRoot, 'extensions') + path.sep
    const external = vscode.extensions.all.filter((extension) => !extension.extensionPath.startsWith(builtinRoot))
    assert.deepEqual(external.map((extension) => extension.id.toLowerCase()).sort(), [ollama.id.toLowerCase(), own.id.toLowerCase()].sort(), 'Unexpected non-builtin extension is enabled')
    const models = await vscode.lm.selectChatModels({ vendor: 'ollama-models' })
    assert.ok(models.length, 'No Ollama models discovered. Start Ollama and make at least one model available.')
    const result = {
        vscode: vscode.version,
        ollama: { id: ollama.id, version: ollama.packageJSON.version, active: ollama.isActive },
        enabledNonBuiltinExtensions: external.map((extension) => extension.id),
        stagedExtensions: staged.map((extension) => extension.id),
        models: models.map((model) => ({ id: model.id, name: model.name, vendor: model.vendor, toolCalling: model.capabilities?.toolCalling })),
    }
    await fs.writeFile(process.env.SCAD_OLLAMA_SMOKE_RESULT, JSON.stringify(result, null, 2) + '\n')
}
