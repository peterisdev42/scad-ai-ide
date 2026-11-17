const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const policy = require('./cad-native-policy.cjs')
exports.attach = async (vscode, context, config, api, directory) => {
    let writes = Promise.resolve()
    const events = []
    let confirmedEdits = 0
    const atomic = async (name, value) => {
        const target = path.join(directory, name),
            temp = target + '.' + randomUUID() + '.tmp'
        await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 })
        await fs.rename(temp, target)
    }
    const state = async (file) => {
        const disk = await fs.readFile(file)
        const canonical = await fs.realpath(file)
        const doc = vscode.workspace.textDocuments.find((d) => !d.isClosed && (d.uri.fsPath === file || d.uri.fsPath === canonical))
        return { path: file, diskHash: policy.sha256(disk), bufferHash: policy.sha256(doc?.getText() ?? disk), dirty: doc?.isDirty ?? false, version: doc?.version ?? null }
    }
    const record = (type, doc, extra = {}) => {
        if (doc && ![config.file, config.manifest, config.profile].includes(doc.uri.fsPath)) return
        // Capture buffer synchronously at event time. Disk read is separately timed, not claimed to be a save caller stack.
        const row = { runId: config.runId, seq: events.length, type, at: new Date().toISOString(), uri: doc?.uri.toString(), dirty: doc?.isDirty, version: doc?.version, bufferHash: doc && policy.sha256(doc.getText()), ...extra }
        events.push(row)
        writes = writes.then(async () => {
            if (doc) {
                row.diskObservedAt = new Date().toISOString()
                row.diskHash = await fs.readFile(doc.uri.fsPath).then(policy.sha256, () => null)
            }
            await atomic('document-events.json', events)
        })
        return writes
    }
    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument((e) => {
            void record('willSave', e.document, { reason: e.reason, reasonName: ['?', 'Manual', 'AfterDelay', 'FocusOut'][e.reason], caller: 'NOT_EXPOSED_BY_VSCODE_API' })
        }),
        vscode.workspace.onDidSaveTextDocument((doc) => {
            void record('didSave', doc)
        }),
        vscode.workspace.onDidChangeTextDocument((e) => {
            void record('didChange', e.document, { reason: e.reason, changes: e.contentChanges.map((c) => ({ rangeOffset: c.rangeOffset, rangeLength: c.rangeLength, insertedTextHash: policy.sha256(c.text) })) })
        }),
    )
    const traces = [],
        invoke = api.capabilities.invoke.bind(api.capabilities)
    api.capabilities.invoke = async (...args) => {
        const start = Date.now()
        const trace = { runId: config.runId, callId: randomUUID(), capability: args[0], input: structuredClone(args[1]), inputStage: 'native dispatcher input before schema validation; canonical URIs appear in returned report', actor: args[2]?.actor, started: new Date().toISOString() }
        traces.push(trace)
        if (args[0].startsWith('cad.')) {
            const source = await state(config.file)
            trace.sourceDiskHash = source.diskHash
            trace.sourceBufferHash = source.bufferHash
            if (config.manifest) {
                const manifest = await state(config.manifest)
                trace.manifestDiskHash = manifest.diskHash
                trace.manifestBufferHash = manifest.bufferHash
            }
            if (config.profile) trace.profileDiskHash = (await state(config.profile)).diskHash
        }
        await atomic('tool-traces.json', traces)
        try {
            trace.output = await invoke(...args)
            return trace.output
        } catch (error) {
            trace.error = String(error)
            throw error
        } finally {
            trace.finished = new Date().toISOString()
            trace.elapsedMs = Date.now() - start
            await atomic('tool-traces.json', traces)
        }
    }
    return {
        record,
        atomic,
        command: async (type, extra = {}) => {
            await record(type, undefined, extra)
            await atomic('command-state.json', { runId: config.runId, state: type, at: new Date().toISOString(), ...extra })
        },
        validate: async (request, doc) => {
            require('node:assert/strict').equal(request.authorization, 'user-approved-closeout-exact-fixture-only')
            require('node:assert/strict').equal(request.expectedBufferSha256, policy.sha256(doc.getText()))
            const checked = policy.validateEdit({ scenario: config.scenario, toolId: request.toolId, file: await fs.realpath(request.file), expectedFile: await fs.realpath(config.file), before: doc.getText(), baseline: config.baselineSource, disk: await fs.readFile(config.file, 'utf8'), args: request, approvals: confirmedEdits, manifestHash: config.manifest && policy.sha256(await fs.readFile(config.manifest)), expectedManifestHash: config.manifestHash })
            confirmedEdits++
            await record('reviewedFixtureEdit', doc, checked)
        },
        flush: () => writes,
    }
}
