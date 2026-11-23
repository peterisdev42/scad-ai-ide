import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { strToU8, strFromU8 } from 'fflate'
import { cargoBuildArgs, initializeStage } from '../build/build.mjs'
import { releaseAssets } from '../build/assets.mjs'
import { verifyVsix } from '../build/verify.mjs'
import { attempt, git, GitCommandError, sha256, writeJson } from '../common/io.mjs'
import { digest } from '../common/schema.mjs'
import { hostTarget, lspPath, targetNames, targets } from '../common/target-matrix.mjs'
import { prepublish } from '../prepublish.mjs'
import { binaryFixture, fixturePlan, zipFixture } from './fixtures.mjs'

function temp(t) {
    const root = mkdtempSync(join(tmpdir(), 'scad-release-build-test-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    return root
}

test('each target has a distinct Cargo triple and VSIX layout', async () => {
    const plan = fixturePlan()
    for (const target of targetNames) {
        const args = cargoBuildArgs(target, 'source', 'output')
        assert.equal(args[args.indexOf('--target') + 1], targets[target].triple)
        assert.deepEqual(args.slice(0, args.indexOf('--locked')), hostTarget === target ? ['build'] : targets[target].cross)
        const { bytes } = zipFixture(plan, target)
        assert.equal((await verifyVsix(bytes, plan, target)).sha256, sha256(bytes))
        await assert.rejects(verifyVsix(bytes, plan, targetNames.find(item => item !== target)), /target mismatch/)
    }
})

test('staging verifies the receipt, does not invoke build commands, and preserves the development hook', t => {
    const root = temp(t)
    const plan = fixturePlan()
    const target = 'win32-x64'
    const lsp = binaryFixture(target)
    const stage = (asset, data) => {
        const path = join(root, asset)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, data)
    }
    for (const asset of releaseAssets) stage(asset, 'fixture')
    stage(lspPath(target), lsp)
    stage('package.json', JSON.stringify({ ...plan.extension, version: plan.version }))
    mkdirSync(join(root, '.release-work'))
    const path = join(root, '.release-work', 'staging.json')
    writeJson(path, { root: realpathSync(root), plan, planSha256: digest(plan), target, lspSha256: sha256(lsp) })
    const env = { SCAD_RELEASE_STAGING: '1', SCAD_RELEASE_RECEIPT: path }
    prepublish(root, env, () => assert.fail('staging called a build command'))
    stage('server/linux-x64/openscad-lsp', 'wrong target')
    assert.throws(() => prepublish(root, env, () => assert.fail('staging called a build command')), /one target/)
    const calls = []
    prepublish(root, {}, args => calls.push(args))
    assert.deepEqual(calls, [['run', 'build:lsp'], ['run', 'package']])
})

test('invalid targets are rejected before opening any plan or spawning a tool', async () => {
    for (const target of ['win32-arm64', 'win32-x64; id', '../linux-x64']) {
        const result = await attempt(process.execPath, ['scripts/release/cli.mjs', 'build', '--target', target, '--json'])
        assert.equal(result.pass, false)
        assert.equal(JSON.parse(result.stdout).code, 2)
        assert.match(JSON.parse(result.stdout).error, /target/)
    }
})

test('VSIX integrity rejects unsafe paths, symlinks, excess sizes and corrupted metadata', async () => {
    const plan = fixturePlan({ version: '0.4.0' })
    const target = 'linux-x64'
    assert.equal((await verifyVsix(zipFixture(plan, target).bytes, plan, target)).verified, true)
    const failures = [
        [files => { files['../escape'] = strToU8('x') }, /ZIP/],
        [files => { files['extension/.env'] = strToU8('x') }, /sensitive/],
        [files => { files['extension/docs/cad/evidence/file'] = strToU8('x') }, /sensitive/],
        [files => { files['extension/site/index.html'] = strToU8('x') }, /sensitive/],
        [files => { files['extension/src/private.ts'] = strToU8('x') }, /sensitive/],
        [files => { files['extension/target/cache'] = strToU8('x') }, /sensitive/],
        [files => { files['extension/escape'] = [strToU8('/outside'), { attrs: (0o120777 << 16) >>> 0, os: 3 }] }, /file type/],
        [files => { files['extension/LICENSE'] = strToU8('a'); files['extension/license'] = strToU8('b') }, /Duplicate/],
        [files => { files['extension/dist/onig.wasm'] = new Uint8Array(64 * 1024 * 1024 + 1) }, /size/],
        [files => { delete files['extension/dist/onig.wasm'] }, /onig.wasm/],
        [files => { delete files['extension/dist/mesh-verification-worker.mjs'] }, /mesh-verification/],
        [files => { delete files['extension/licenses/saxes/LICENSE'] }, /saxes/],
        [files => { delete files[Object.keys(files).find(file => file.startsWith('extension/skills/openscad-'))] }, /packaged asset/],
        [files => { files['extension/' + lspPath(target)] = [binaryFixture(target), { attrs: (0o100644 << 16) >>> 0, os: 3 }] }, /execute/],
        [files => { files['extension/' + lspPath(target)] = binaryFixture('darwin-arm64') }, /header/],
        [files => { files['extension/' + lspPath('darwin-arm64')] = binaryFixture('darwin-arm64') }, /exactly one/],
        [files => { files['extension.vsixmanifest'] = strToU8(strFromU8(files['extension.vsixmanifest'])
            .replace('</Properties>', '<Property Id="Microsoft.VisualStudio.Code.PreRelease" Value="true" /></Properties>')) }, /pre-release/],
        [files => { files['extension/package.json'] = strToU8(strFromU8(files['extension/package.json'])
            .replace('"version":"0.4.0"', '"version":"0.4.1"')) }, /manifest mismatch/],
    ]
    for (const [alter, message] of failures) {
        await assert.rejects(verifyVsix(zipFixture(plan, target, alter).bytes, plan, target), message)
    }
})

function stagingFixture(t) {
    const root = temp(t)
    function createRepo(name) {
        const dir = join(root, name)
        git(root, ['init', '--quiet', name])
        git(dir, ['config', 'user.name', 'Release Test'])
        git(dir, ['config', 'user.email', 'test@example.invalid'])
        return dir
    }
    const snapshot = createRepo('worktree with spaces')
    const dependencies = createRepo('dependency')
    const marker = 'marker.txt'
    for (const repo of [snapshot, dependencies]) {
        writeFileSync(join(repo, marker), 'original')
        git(repo, ['add', marker])
        git(repo, ['commit', '--quiet', '-m', 'initial'])
    }
    const relative = ['openscad', 'openscad-LSP', 'vscode-openscad-preview'].map(name => 'sources/' + name)
    const dependencyUrl = git(dependencies, ['rev-parse', '--show-toplevel'])
    for (const path of relative) {
        git(snapshot, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', '--', dependencyUrl, path])
    }
    return { root, snapshot, relative, marker }
}

test('detached staging uses initialized local submodules and freezes the recorded gitlinks', t => {
    const { root, snapshot, relative, marker } = stagingFixture(t)
    const untracked = 'untracked.txt'
    for (const path of relative) {
        // Prove staging uses the local override, even if the configured origin is unavailable.
        git(snapshot, ['config', '-f', '.gitmodules', `submodule.${path}.url`, '../unavailable'])
    }
    git(snapshot, ['add', '.gitmodules'])
    git(snapshot, ['commit', '--quiet', '-m', 'freeze submodules'])
    const frozen = git(snapshot, ['rev-parse', 'HEAD'])
    const submodule = git(join(snapshot, relative[0]), ['rev-parse', 'HEAD'])
    for (const path of relative) {
        const checkout = join(snapshot, path)
        writeFileSync(join(checkout, marker), 'newer dependency')
        git(checkout, ['-c', 'user.name=Release Test', '-c', 'user.email=test@example.invalid',
            'commit', '--quiet', '-am', 'advance dependency'])
        writeFileSync(join(checkout, marker), 'uncommitted dependency')
        writeFileSync(join(checkout, untracked), 'untracked dependency file')
    }
    writeFileSync(join(snapshot, marker), 'newer')
    git(snapshot, ['commit', '--quiet', '-am', 'advance'])
    writeFileSync(join(snapshot, marker), 'unsaved workspace changes')
    writeFileSync(join(snapshot, untracked), 'untracked workspace file')
    const stage = join(root, 'stage')
    mkdirSync(stage)
    assert.deepEqual(initializeStage(snapshot, stage, fixturePlan({ sourceCommit: frozen })),
        Object.fromEntries(relative.map(path => [path, submodule])))
    assert.equal(readFileSync(join(stage, marker), 'utf8'), 'original')
    assert.equal(existsSync(join(stage, untracked)), false)
    assert.equal(readFileSync(join(snapshot, marker), 'utf8'), 'unsaved workspace changes')
    assert.notEqual(git(snapshot, ['rev-parse', 'HEAD']), frozen)
    for (const path of relative) {
        const source = join(snapshot, path)
        const destination = join(stage, path)
        assert.equal(git(stage, ['config', '--local', `submodule.${path}.url`]), git(source, ['rev-parse', '--show-toplevel']))
        assert.equal(git(destination, ['rev-parse', 'HEAD']), submodule)
        assert.equal(readFileSync(join(destination, marker), 'utf8'), 'original')
        assert.equal(existsSync(join(destination, untracked)), false)
        assert.equal(readFileSync(join(source, marker), 'utf8'), 'uncommitted dependency')
    }
})

test('staging uses frozen .gitmodules for an uninitialized source and fails closed when it cannot fetch', t => {
    const { root, snapshot, relative } = stagingFixture(t)
    const [missing] = relative
    git(snapshot, ['commit', '--quiet', '-m', 'freeze submodules'])
    const plan = fixturePlan({ sourceCommit: git(snapshot, ['rev-parse', 'HEAD']) })
    const submodule = git(join(snapshot, relative[0]), ['rev-parse', 'HEAD'])
    git(snapshot, ['submodule', 'deinit', '--all'])
    assert.equal(git(join(snapshot, missing), ['rev-parse', '--show-prefix']), `${missing}/`)
    // Advance the workspace to an invalid origin. Staging the earlier plan must still
    // fetch from the working origin recorded in that plan's .gitmodules.
    git(snapshot, ['config', '-f', '.gitmodules', `submodule.${missing}.url`, '../unavailable'])
    git(snapshot, ['commit', '--quiet', '-am', 'unavailable submodule origin'])
    const stage = join(root, 'stage')
    mkdirSync(stage)
    const allowProtocol = process.env.GIT_ALLOW_PROTOCOL
    try {
        // Only this fixture permits file transport for .gitmodules URLs.
        process.env.GIT_ALLOW_PROTOCOL = 'file'
        assert.deepEqual(initializeStage(snapshot, stage, plan), Object.fromEntries(relative.map(path => [path, submodule])))

        const badStage = join(root, 'bad-stage')
        mkdirSync(badStage)
        assert.throws(() => initializeStage(snapshot, badStage, fixturePlan({ sourceCommit: git(snapshot, ['rev-parse', 'HEAD']) })),
            error => {
                assert.ok(error instanceof GitCommandError)
                assert.equal(error.code, 5)
                assert.match(error.message, /^Cannot initialize frozen submodule sources\/openscad:/)
                assert.ok(error.git.exitCode > 0)
                assert.match(error.git.stderr, /repository|submodule path/)
                assert.doesNotMatch(error.git.stderr, /unavailable|scad-release-build-test-/)
                return true
            })
    } finally {
        if (allowProtocol === undefined) delete process.env.GIT_ALLOW_PROTOCOL
        else process.env.GIT_ALLOW_PROTOCOL = allowProtocol
    }
})

test('Git failure details keep actionable stderr without emitting credentials or remote text', () => {
    const url = 'https://fixture-user:fixture-token@fixture.invalid/private?key=fixture-key'
    const error = new GitCommandError(5, { status: 128, signal: null, stderr: [
        `fatal: Authentication failed for '${url}'`,
        `remote: fixture-token ${url}`,
        "fatal: transport 'file' not allowed",
        "fatal: clone of 'D:/private project' into submodule path 'D:/private staging' failed",
    ].join('\r\n') })
    assert.deepEqual(error.git, { exitCode: 128, signal: null, spawnError: null, stderr: [
        'fatal: authentication failed', '<redacted Git stderr>', "fatal: transport 'file' not allowed",
        'fatal: clone into submodule path failed',
    ].join('\n') })
    assert.doesNotMatch(`${error.message}\n${JSON.stringify(error.git)}`, /fixture-|private project|private staging/)
})
