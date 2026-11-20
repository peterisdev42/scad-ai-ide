import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { releaseAssets } from '../build/assets.mjs'
import { artifactFilename, digest } from '../common/schema.mjs'
import { lspPath, markets, targetNames, targets } from '../common/target-matrix.mjs'
import { sha256 } from '../common/io.mjs'

const source = file => readFileSync(new URL('../../../' + file, import.meta.url))
const rootManifest = JSON.parse(source('package.json'))
const extraAssets = [
    'resources/schemas/cad-print-profile-v1.schema.json', 'resources/schemas/cad-comparison-v1.schema.json',
    'resources/schemas/cad-feedback-v1.schema.json', 'resources/schemas/cad-print-assessment-v1.schema.json',
    'resources/schemas/cad-review-bundle-v1.schema.json', 'resources/schemas/cad-verification-v1.schema.json',
    'resources/schemas/cad-report-v3.schema.json', 'resources/schemas/cad-report-v2.schema.json',
    'resources/schemas/cad-report-v1.schema.json', 'media/panels/ai.js', 'media/panels/index.html',
    'media/panels/main.js', 'media/panels/main.css',
]
const generated = ['feature-catalog.generated.json', 'ai-panel-layout.generated.json', 'ai-panel-state.schema.json',
    'ai-preferences.schema.json'].map(name => 'src/ai/generated/' + name)

export function fixturePlan({ version = '0.3.8', target = targetNames, ...overrides } = {}) {
    const preRelease = Number(version.split('.')[1]) % 2 === 1
    return { schemaVersion: 1, releaseId: 'scad-ai-ide-v' + version, repository: 'peterisdev42/scad-ai-ide',
        extension: { name: 'scad-ai-ide', publisher: 'EXAMPLE-PUBLISHER' }, version, channel: preRelease ? 'preview' : 'stable',
        preRelease, sourceCommit: 'a'.repeat(40), tag: 'v' + version, targets: target,
        changeAnalysis: { changeLevel: 'fix', summary: 'Fixture', evidence: [], confidence: 1, needsReview: false },
        ...overrides }
}

export function binaryFixture(target) {
    const bytes = Buffer.alloc(128)
    if (target.startsWith('darwin')) {
        bytes.writeUInt32LE(0xfeedfacf, 0)
        bytes.writeUInt32LE(target === 'darwin-arm64' ? 0x0100000c : 0x01000007, 4)
        bytes.writeUInt32LE(2, 12)
    } else if (target === 'linux-x64') {
        bytes.writeUInt32BE(0x7f454c46, 0)
        bytes[4] = 2
        bytes[5] = 1
        bytes.writeUInt16LE(3, 16)
        bytes.writeUInt16LE(62, 18)
    } else {
        bytes.write('MZ', 0)
        bytes.writeUInt32LE(64, 60)
        bytes.writeUInt32LE(0x4550, 64)
        bytes.writeUInt16LE(0x8664, 68)
        bytes.writeUInt16LE(0x22, 86)
        bytes.writeUInt16LE(0x20b, 88)
    }
    return bytes
}

export function zipFixture(plan, target, edit = () => {}) {
    const { main, contributes, extensionKind, engines } = rootManifest
    const manifest = { ...plan.extension, version: plan.version, main, contributes, extensionKind, engines }
    const marker = plan.preRelease ? '<Property Id="Microsoft.VisualStudio.Code.PreRelease" Value="true" />' : ''
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata><Identity Id="${plan.extension.name}" Version="${plan.version}" Publisher="${plan.extension.publisher}" TargetPlatform="${target}"/>
  <Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${engines.vscode}" />${marker}</Properties></Metadata>
</PackageManifest>`
    const files = {
        '[Content_Types].xml': strToU8('<Types/>'),
        'extension.vsixmanifest': strToU8(xml),
        'extension/package.json': strToU8(JSON.stringify(manifest)),
    }
    for (const file of [...releaseAssets, ...extraAssets]) files['extension/' + (file === 'LICENSE' ? 'LICENSE.txt' : file)] = strToU8('Fixture')
    const resources = Object.entries(contributes).filter(([key]) =>
        ['chatSkills', 'chatInstructions', 'chatPromptFiles', 'chatAgents'].includes(key))
        .flatMap(([, entries]) => entries.map(entry => entry.path.replace(/^\.\//, '')))
    for (const file of [...generated, ...resources]) files['extension/' + file] = source(file)
    const lsp = binaryFixture(target)
    files['extension/' + lspPath(target)] = [lsp, { attrs: (0o100755 << 16) >>> 0, os: 3 }]
    edit(files)
    return { bytes: Buffer.from(zipSync(files)), lsp }
}

export function artifactSet(directory, plan) {
    const artifacts = plan.targets.map(target => {
        const { bytes, lsp } = zipFixture(plan, target)
        const file = artifactFilename(plan, target)
        writeFileSync(join(directory, file), bytes)
        return { target, file, sha256: sha256(bytes), sizeBytes: bytes.length, lspTriple: targets[target].triple,
            lspSha256: sha256(lsp), verified: true, validation: {
                compile: 'pass', 'binary-header': 'pass', 'cli-smoke': 'pass', 'lsp-stdio': 'pass',
                'vsix-install': 'pass', machine: 'mock', reason: '',
            } }
    })
    const path = join(directory, 'release-artifacts.json')
    const manifest = { schemaVersion: 1, releaseId: plan.releaseId, planSha256: digest(plan), version: plan.version,
        channel: plan.channel, sourceCommit: plan.sourceCommit, artifacts }
    writeFileSync(path, JSON.stringify(manifest))
    return { path, manifest }
}

export function histories(versions, target = targetNames) {
    return markets.map(provider => ({ complete: true, provider, versions: versions.flatMap(version =>
        target.map(target => ({ version, target, preRelease: Number(version.split('.')[1]) % 2 === 1 }))) }))
}
