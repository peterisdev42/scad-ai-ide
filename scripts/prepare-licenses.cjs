// Stage original license and notice files for source imports bundled into the VSIX.
const { readdirSync, readFileSync, mkdirSync, rmSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { zipSync, strToU8 } = require('fflate')

const root = path.resolve(__dirname, '..')
const submodules = ['vscode-openscad-preview', 'openscad-LSP', 'openscad']
const legalFile = /^(?:licen[cs]e|copying|notice|third[-_]?party(?:[-_]?notices)?)(?:[._-].*)?$/i
const licenseFile = /^(?:licen[cs]e|copying)(?:[._-].*)?$/i

try {
    // Read every source before replacing previously staged files.
    const bundles = submodules.map((name) => {
        const source = path.join(root, 'sources', name)
        let entries
        try {
            entries = readdirSync(source, { withFileTypes: true })
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error(`Missing sources/${name}. Run git submodule update --init --recursive first.`)
            }
            throw error
        }
        const files = entries
            .filter((entry) => entry.isFile() && legalFile.test(entry.name))
            .map((entry) => entry.name)
            .sort()
        if (!files.some((file) => licenseFile.test(file))) {
            throw new Error(`No LICENSE or COPYING file found in sources/${name}. Check the submodule before packaging.`)
        }
        return { name, files: files.map((file) => ({ name: file, contents: readFileSync(path.join(source, file)) })) }
    })
    // Only the scrollbar import graph is bundled; preserve its upstream notices too.
    const monacoSource = path.join(root, 'node_modules', 'monaco-editor')
    bundles.push({
        name: 'monaco-editor',
        files: ['LICENSE', 'ThirdPartyNotices.txt'].map((name) => ({ name, contents: readFileSync(path.join(monacoSource, name)) })),
    })
    for (const name of ['vscode-textmate', 'vscode-oniguruma', 'jsonc-parser', 'manifold-3d', 'three', 'harfbuzzjs', '@zkl2333/freetype-wasm', 'straight-skeleton', 'linkedom', 'dxf-parser', 'pngjs', 'fflate']) {
        const source = path.join(root, 'node_modules', name)
        bundles.push({
            name,
            files: readdirSync(source)
                .filter((file) => legalFile.test(file) || /^notices?(?:\.|$)/i.test(file))
                .map((file) => ({ name: file, contents: readFileSync(path.join(source, file)) })),
        })
    }
    for (const directory of JSON.parse(readFileSync(path.join(root, 'dist/bundled-packages.json'), 'utf8'))) {
        const source = path.join(root, directory),
            metadata = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'))
        let name = metadata.name
        const previous = bundles.find((bundle) => bundle.name === name)
        if (previous) {
            if (!previous.sourceVersion) {
                previous.sourceVersion = metadata.version
                continue
            }
            if (previous.sourceVersion === metadata.version) continue
            name += '@' + metadata.version
            if (bundles.some((bundle) => bundle.name === name)) continue
        }
        const files = readdirSync(source).filter((file) => legalFile.test(file) || /^notices?(?:\.|$)/i.test(file))
        bundles.push({ name, sourceVersion: metadata.version, files: files.map((name) => ({ name, contents: readFileSync(path.join(source, name)) })) })
    }
    const csgSource = path.join(root, 'src/core/csg')
    bundles.push({
        name: 'openscad-csg-source',
        files: [
            ...readdirSync(csgSource)
                .filter((file) => /\.(?:mts|ts)$/.test(file))
                .map((file) => ({ name: file + '.txt', contents: readFileSync(path.join(csgSource, file)) })),
            { name: 'roof.cpp.txt', contents: readFileSync(path.join(csgSource, 'native/roof.cpp')) },
            { name: 'build-csg-kernel.mjs.txt', contents: readFileSync(path.join(root, 'scripts/build-csg-kernel.mjs')) },
            { name: 'PROVENANCE.md', contents: readFileSync(path.join(root, 'resources/csg/PROVENANCE.md')) },
        ],
    })
    // Keep a buildable standalone source tree beside the original ported files.
    const sourceTree = {}
    const collectSource = (directory) => {
        for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
            const name = directory + '/' + entry.name
            if (entry.isDirectory()) collectSource(name)
            else sourceTree[name] = readFileSync(path.join(root, name))
        }
    }
    for (const directory of ['src/core/csg', 'src/core/formats', 'resources/csg', 'resources/fonts']) collectSource(directory)
    for (const file of ['package.json', 'package-lock.json', 'scripts/build-csg-core.mjs', 'scripts/build-csg-kernel.mjs']) sourceTree[file] = readFileSync(path.join(root, file))
    sourceTree['BUILD.txt'] = strToU8('Install the locked npm dependencies with npm ci, then run npm run build:csg. The standalone library is .build/csg/csg.cjs. Rebuild the optional native roof kernel with npm run build:csg-kernel; compiler inputs and pinned upstream sources are documented in resources/csg/PROVENANCE.md.\n')
    bundles.find((bundle) => bundle.name === 'openscad-csg-source').files.push({ name: 'standalone-source.zip', contents: Buffer.from(zipSync(sourceTree)) })
    for (const bundle of bundles) {
        const destination = path.join(root, 'licenses', bundle.name)
        rmSync(destination, { recursive: true, force: true })
        mkdirSync(destination, { recursive: true })
        for (const file of bundle.files) {
            writeFileSync(path.join(destination, file.name), file.contents)
        }
        console.log(`Staged ${bundle.files.length} license/notice file(s) in licenses/${bundle.name}/`)
    }
} catch (error) {
    console.error(error.message)
    process.exitCode = 1
}
