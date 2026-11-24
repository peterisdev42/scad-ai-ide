import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import test from 'node:test'
const read = path => readFileSync(new URL(path, import.meta.url),'utf8')

test('Pages cheese STL is the supplied complete binary triangle mesh',()=>{
    const data=readFileSync(new URL('./assets/cheese.stl',import.meta.url))
    assert.equal(data.readUInt32LE(80),14988)
    assert.equal(data.length,84+14988*50)
    assert.equal(createHash('sha256').update(data).digest('hex'),'304270810217609cbdb3cca048dcc8fba44f0c6f1c63cb4184476ad62fbfb955')
    for(let offset=84;offset<data.length;offset+=50)for(let i=0;i<12;i++)assert.ok(Number.isFinite(data.readFloatLE(offset+4*i)))
})
test('Pages uses the native Workbench and the actual Preview, not a copied shell',()=>{
    const homepage=read('./index.html'), adapter=read('./demo/preview.ts'), host=read('./demo/preview-host.js'), workbench=read('../tools/pages-workbench/main.ts'), build=read('./build-demo.mjs')
    assert.match(homepage,/<iframe[^>]+src="\.\/demo\/index\.html"/)
    assert.match(homepage,/Code-OSS Workbench/)
    assert.match(workbench,/getWorkbenchServiceOverride\(\)/)
    assert.match(workbench,/registerEditorPane\(previewId/)
    assert.match(workbench,/RegisteredReadOnlyFile/)
    assert.match(workbench,/reopenActiveEditorWith/)
    assert.match(workbench,/registerFileUrl/)
    assert.match(host,/mountPreview/)
    assert.match(adapter,/src\/features\/preview\/webview\/components\/App/)
    assert.match(adapter,/app.bridge=bridge/)
    assert.match(adapter,/format:ModelFormat.STL/)
    assert.match(adapter,/case 'frameReady'/)
    assert.match(build,/tsconfig.webview.json/)
    assert.doesNotMatch(homepage,/cdn\.jsdelivr\.net\/npm\/three/)
    assert.match(read('./assets/cheese.scad'),/import\("cheese\.stl"\)/)
})
