import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import test from 'node:test'
const read = path => readFileSync(new URL(path, import.meta.url),'utf8')

test('Pages ships the exact self-contained SCAD example without STL',()=>{
    const data=readFileSync(new URL('./assets/cheese.scad',import.meta.url))
    assert.equal(createHash('sha256').update(data).digest('hex'),'3bd359d798ba1ab971af056e53649ba781549ca88e1e84c5976951403ba8a14c')
    assert.match(data.toString(),/module cheese\(/)
    assert.doesNotMatch(data.toString(),/\bimport\s*\(/)
    assert.ok(!existsSync(new URL('./assets/cheese.stl',import.meta.url)))
    if(existsSync(new URL('./demo/generated/cheese-preview.json',import.meta.url))){
        const metadata=JSON.parse(read('./demo/generated/cheese-preview.json'))
        assert.equal(metadata.sha256,createHash('sha256').update(data).digest('hex'))
        assert.equal(metadata.color,'#FFD52A')
        const mesh=readFileSync(new URL('./demo/generated/cheese.3mf',import.meta.url))
        assert.equal(mesh.subarray(0,4).toString('hex'),'504b0304')
    }
})
test('Pages uses the native Workbench and the actual Preview, not a copied shell',()=>{
    const homepage=read('./index.html'), adapter=read('./demo/preview.ts'), host=read('./demo/preview-host.js'), workbench=read('../tools/pages-workbench/main.ts'), build=read('./build-demo.mjs')
    assert.match(homepage,/<iframe[^>]+data-demo-src="\.\/demo\/generated\/workbench\/index\.html"/)
    assert.match(homepage,/Code-OSS Workbench/)
    assert.match(workbench,/getWorkbenchServiceOverride\(\)/)
    assert.match(workbench,/registerEditorPane\(previewId/)
    assert.match(workbench,/RegisteredReadOnlyFile/)
    assert.match(workbench,/reopenActiveEditorWith/)
    assert.match(workbench,/registerFileUrl/)
    assert.match(host,/mountPreview/)
    assert.match(adapter,/src\/features\/preview\/webview\/components\/App/)
    assert.match(adapter,/app.bridge=bridge/)
    assert.match(adapter,/format:ModelFormat.ThreeMF/)
    assert.match(adapter,/case 'frameReady'/)
    assert.match(build,/tsconfig.webview.json/)
    assert.doesNotMatch(homepage,/cdn\.jsdelivr\.net\/npm\/three/)
    assert.match(workbench,/Light Modern/)
    assert.match(workbench,/Dark Modern/)
    assert.match(workbench,/onDidColorThemeChange/)
    assert.match(host,/scad-demo-theme/)
    assert.match(build,/OPENSCAD_CLI/)
    assert.doesNotMatch(workbench,/cheese\.stl/)
})

test('embedded startup guard suppresses passive focus without changing host or standalone behavior',()=>{
    const guard=read('./demo/focus-guard.js')
    assert.match(guard,/hasAttribute\('data-vsc-demo'\)/)
    assert.match(guard,/event\.isTrusted/)
    assert.match(guard,/activated && document\.hasFocus\(\)/)
    assert.match(guard,/preventScroll: true/)
    assert.match(guard,/Element\.prototype\.scrollIntoView/)
})
