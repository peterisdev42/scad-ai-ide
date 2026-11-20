import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { crc32 } from 'node:zlib'
import { isDeepStrictEqual } from 'node:util'
import { SaxesParser } from 'saxes'
import yauzl from 'yauzl'
import { verifyAgentVsix } from '../../verify-agent-vsix.mjs'
import { ReleaseError, requireRelease, sha256 } from '../common/io.mjs'
import { validateArtifacts, validatePlan } from '../common/schema.mjs'
import { lspPath } from '../common/target-matrix.mjs'
import { releaseAssets } from './assets.mjs'
import { verifyBinary } from './binary.mjs'

const maxVsix = 128 * 1024 * 1024
const maxEntry = 64 * 1024 * 1024
const maxTotal = 256 * 1024 * 1024
const metadataXml = 'extension.vsixmanifest'
const preReleaseProperty = 'Microsoft.VisualStudio.Code.PreRelease'
const generatedJson = /^extension\/src\/ai\/generated\/[\w.-]+\.json$/
const forbiddenRoot = /^(?:site|sources|target|node_modules|scripts|releases|\.release-work|\.build|\.agents|\.github|docs\/cad\/evidence|docs\/specs)(?:\/|$)/i
const secretText = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bgithub_pat_[A-Za-z0-9_]{60,}\b|\bgh[pousr]_[A-Za-z0-9]{36,}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/
const forbiddenSegment = /(?:^|\/)(?:\.git|\.npmrc|\.env(?:\.[^/]*)?|\.ssh|\.aws|\.netrc|\.pypirc|(?:id_rsa|id_ed25519)(?:\.[^/]*)?|[^/]+\.(?:pem|pfx|p12|key))(?:\/|$)/i

export function readVsix(path) {
    requireRelease(lstatSync(path).isFile(), 'VSIX must be a regular file', 5)
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    try {
        const stat = fstatSync(fd)
        requireRelease(stat.isFile() && stat.size > 0 && stat.size <= maxVsix, 'Invalid VSIX file size/type', 5)
        const data = Buffer.alloc(stat.size)
        // Read at most the checked size, even if the file changes concurrently.
        let offset = 0
        while (offset < data.length) {
            const count = readSync(fd, data, offset, data.length - offset, offset)
            requireRelease(count > 0, 'VSIX changed during read', 5)
            offset += count
        }
        requireRelease(fstatSync(fd).size === data.length, 'VSIX changed during read', 5)
        return data
    } finally {
        closeSync(fd)
    }
}

function verifyArchivePath(name, seen) {
    const normalized = name.replace(/\/$/, '')
    const key = normalized.normalize('NFC').toLowerCase()
    requireRelease(!/[\\:\x00-\x1f\x7f]/.test(name) && normalized.split('/').every(segment =>
        segment && !/[. ]$/.test(segment) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(segment)),
    'Unsafe ZIP entry path', 5)
    requireRelease(!seen.has(key), 'Duplicate ZIP entry', 5)
    seen.set(key, name.endsWith('/'))
    if (['[Content_Types].xml', metadataXml, 'extension'].includes(normalized)) return
    const relative = normalized.slice('extension/'.length)
    requireRelease(normalized.startsWith('extension/') && !forbiddenRoot.test(relative) &&
        !forbiddenSegment.test(relative) && (!/^src(?:\/|$)/i.test(relative) || generatedJson.test(normalized) ||
            ['src/', 'src/ai/', 'src/ai/generated/'].includes(relative + '/')) &&
        !/(^|\/)target(?:\/|$)/i.test(relative), 'Unexpected or sensitive VSIX entry', 5)
}

async function loadArchive(bytes) {
    const zip = await yauzl.fromBufferPromise(bytes, { lazyEntries: true, strictFileNames: true })
    const files = Object.create(null)
    const modes = new Map()
    const seen = new Map()
    let total = 0
    try {
        requireRelease(zip.entryCount <= 5000, 'Too many VSIX entries', 5)
        for await (const entry of zip.eachEntry()) {
            const name = entry.fileName
            verifyArchivePath(name, seen)
            total += entry.uncompressedSize
            const directory = name.endsWith('/')
            const mode = entry.externalFileAttributes >>> 16
            const kind = mode & 0o170000
            requireRelease(entry.uncompressedSize <= maxEntry && total <= maxTotal &&
                (kind === 0 || kind === (directory ? 0o040000 : 0o100000)) &&
                !(entry.generalPurposeBitFlag & 1), 'Unsafe ZIP entry size or file type', 5)
            const stream = await zip.openReadStreamPromise(entry)
            const chunks = []
            let crc = 0, actualSize = 0
            for await (const chunk of stream) {
                actualSize += chunk.length
                requireRelease(actualSize <= entry.uncompressedSize, 'ZIP entry expands beyond declared size', 5)
                crc = crc32(chunk, crc)
                chunks.push(chunk)
            }
            requireRelease(crc === entry.crc32 && actualSize === entry.uncompressedSize &&
                (!directory || actualSize === 0), 'VSIX ZIP integrity failure', 5)
            if (!directory) {
                const contents = Buffer.concat(chunks)
                if (!/\.(?:wasm|woff2?|ttf|png|jpe?g|webp|gif|exe)$/i.test(name) &&
                    !/^extension\/server\/[^/]+\//.test(name)) {
                    requireRelease(!secretText.test(contents.toString('utf8')), 'Possible credential in VSIX entry', 5)
                }
                files[name] = contents
                modes.set(name, mode)
            }
        }
        for (const key of seen.keys()) {
            const components = key.split('/')
            for (let index = 1; index < components.length; index++) {
                requireRelease(seen.get(components.slice(0, index).join('/')) !== false, 'ZIP file shadows a directory', 5)
            }
        }
        return { files, modes }
    } finally {
        zip.close()
    }
}

function readVsixManifest(raw, plan, target, engine) {
    const identities = []
    const properties = new Map()
    const elements = []
    const parser = new SaxesParser({ xmlns: true })
    parser.on('doctype', () => { throw new ReleaseError(5, 'VSIX XML DTD is forbidden') })
    parser.on('opentag', tag => {
        elements.push(tag.local)
        const value = name => tag.attributes[name]?.value
        const path = elements.join('/')
        requireRelease(tag.uri === 'http://schemas.microsoft.com/developer/vsx-schema/2011', 'Unexpected VSIX XML namespace', 5)
        if (path === 'PackageManifest/Metadata/Identity') {
            identities.push({ id: value('Id'), version: value('Version'), publisher: value('Publisher'), target: value('TargetPlatform') })
        }
        if (path === 'PackageManifest/Metadata/Properties/Property') {
            requireRelease(value('Id') && !properties.has(value('Id')), 'Duplicate VSIX metadata property', 5)
            properties.set(value('Id'), value('Value'))
        }
    })
    parser.on('closetag', () => elements.pop())
    parser.write(raw).close()
    requireRelease(isDeepStrictEqual(identities, [{ id: plan.extension.name, version: plan.version,
        publisher: plan.extension.publisher, target }]), 'VSIX XML identity or target mismatch', 5)
    requireRelease(properties.get('Microsoft.VisualStudio.Code.Engine') === engine,
        'VSIX XML engine mismatch', 5)
    requireRelease(plan.preRelease ? properties.get(preReleaseProperty) === 'true' : !properties.has(preReleaseProperty),
        'VSIX pre-release marker mismatch', 5)
}

export async function verifyVsix(bytes, plan, target, { sourceAsset, engine } = {}) {
    validatePlan(plan)
    requireRelease(plan.targets.includes(target), 'Target not in Plan')
    requireRelease(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maxVsix, 'Invalid VSIX size', 5)
    try {
        const { files, modes } = await loadArchive(bytes)
        for (const asset of [metadataXml, '[Content_Types].xml', 'extension/package.json',
            ...releaseAssets.map(file => 'extension/' + (file === 'LICENSE' ? 'LICENSE.txt' : file))]) {
            requireRelease(files[asset]?.length, `Missing packaged asset: ${asset}`, 5)
        }
        const manifest = JSON.parse(files['extension/package.json'])
        requireRelease(manifest.publisher === plan.extension.publisher && manifest.name === plan.extension.name &&
            manifest.version === plan.version && manifest.main === './dist/extension.js' &&
            isDeepStrictEqual(manifest.extensionKind, ['workspace']) && typeof manifest.engines?.vscode === 'string' &&
            (!engine || engine === manifest.engines.vscode), 'VSIX extension manifest mismatch', 5)
        readVsixManifest(files[metadataXml].toString('utf8'), plan, target, manifest.engines.vscode)
        const server = 'extension/' + lspPath(target)
        const serverFiles = Object.keys(files).filter(file => file.startsWith('extension/server/')).sort()
        requireRelease(serverFiles.join() === [server, 'extension/server/LICENSE-APACHE'].sort().join(),
            'VSIX must contain exactly one target LSP and its license', 5)
        verifyBinary(files[server], target)
        requireRelease(target === 'win32-x64' || (modes.get(server) & 0o111) !== 0, 'Packaged LSP lacks execute permission', 5)
        verifyAgentVsix(files, sourceAsset, { frozen: true })
        return { sha256: sha256(bytes), sizeBytes: bytes.length, lspSha256: sha256(files[server]), verified: true }
    } catch (error) {
        if (error instanceof ReleaseError) throw error
        if (error.code === 'ERR_ASSERTION' && error.message.startsWith('Missing ')) throw new ReleaseError(5, error.message)
        throw new ReleaseError(5, 'Invalid VSIX ZIP, XML or bundled Agent contract')
    }
}

export async function verifyArtifactSet(plan, manifest, manifestPath) {
    validateArtifacts(manifest, plan)
    const root = dirname(resolve(manifestPath))
    for (const artifact of manifest.artifacts) {
        const path = join(root, artifact.file)
        const bytes = readVsix(path)
        requireRelease(bytes.length === artifact.sizeBytes && sha256(bytes) === artifact.sha256, 'VSIX hash or size mismatch', 4)
        const checked = await verifyVsix(bytes, plan, artifact.target)
        requireRelease(checked.lspSha256 === artifact.lspSha256, 'Bundled LSP hash mismatch', 4)
    }
}

export async function unpackLsp(bytes, target) {
    return (await loadArchive(bytes)).files['extension/' + lspPath(target)]
}
