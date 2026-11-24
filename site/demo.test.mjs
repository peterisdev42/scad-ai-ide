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
test('One editor group switches between real source and shared preview',()=>{
    const homepage=read('./index.html'), shell=read('./demo/index.html'), js=read('./workbench.js'), adapter=read('./demo/preview.ts'), editor=read('./demo/editor.ts'), build=read('./build-demo.mjs')
    assert.match(homepage,/<iframe[^>]+src="\.\/demo\/index\.html"/)
    assert.match(homepage,/not a full VS Code host/)
    assert.match(homepage,/Bundled STL/i)
    assert.match(shell,/class="editor-group"/)
    assert.equal((shell.match(/class="editor-tab"/g)||[]).length,1)
    assert.match(shell,/data-pane="source"[^>]+hidden/)
    assert.match(shell,/data-reopen/)
    assert.match(js,/previewPane.hidden=mode !== 'preview'/)
    assert.match(js,/sourcePane.hidden=mode !== 'source'/)
    assert.match(adapter,/src\/features\/preview\/webview\/components\/App/)
    assert.match(adapter,/src\/features\/preview\/webview\/services\/Bridge/)
    assert.match(adapter,/new App\(\)/)
    assert.match(adapter,/app.bridge=bridge/)
    assert.match(adapter,/format:ModelFormat.STL/)
    assert.match(adapter,/case 'frameReady'/)
    assert.doesNotMatch(js,/STLLoader|TrackballControls|WebGLRenderer/)
    assert.doesNotMatch(homepage,/cdn\.jsdelivr\.net\/npm\/three/)
    assert.match(editor,/monaco.editor.create\(/)
    assert.match(editor,/readOnly:true/)
    assert.match(build,/tsconfig.webview.json/)
    assert.match(build,/site\/demo\/editor-worker\.ts/)
    assert.match(editor,/monaco-editor\/editor/)
    assert.match(read('./assets/cheese.scad'),/import\("cheese\.stl"\)/)
})
