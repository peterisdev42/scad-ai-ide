// Runs against the built static artifact, under the real GitHub Pages project prefix.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, extname, sep } from 'node:path'
import { chromium } from 'playwright'
import test from 'node:test'
const site=fileURLToPath(new URL('../',import.meta.url))
const prefix='/scad-ai-ide/'
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.3mf':'application/vnd.ms-package.3dmanufacturing-3dmodel+xml','.scad':'text/plain','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff':'font/woff','.woff2':'font/woff2','.json':'application/json','.wasm':'application/wasm','.mjs':'text/javascript','.map':'application/json','.webmanifest':'application/manifest+json'}
test('native Workbench draws the actual Preview and reopens the same source file', {timeout:180000}, async ()=>{
    const server=createServer(async(req,res)=>{
        try{
            const pathname=new URL(req.url,'http://localhost').pathname
            if(!pathname.startsWith(prefix)){res.writeHead(404).end();return}
            const local=decodeURIComponent(pathname.slice(prefix.length))
            const file=resolve(site,local.endsWith('/')||!local?local+'index.html':local)
            if(!file.startsWith(resolve(site)+sep)){res.writeHead(403).end();return}
            res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'}).end(await readFile(file))
        }catch{if(!res.headersSent)res.writeHead(404);res.end()}
    })
    await new Promise(r=>server.listen(0,'127.0.0.1',r))
    let browser
    try{
        browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
        const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark'})
        const page=await context.newPage()
        const errors=[]
        page.on('pageerror',e=>errors.push(String(e)))
        await page.goto('http://127.0.0.1:'+server.address().port+prefix)
        assert.equal(await page.locator('html').getAttribute('data-theme'),'light','first visit is light even with dark OS')
        await page.evaluate(async()=>{await document.fonts.ready; await document.fonts.load('400 16px Geist')})
        assert.equal(await page.evaluate(()=>document.fonts.check('16px Geist')),true)
        assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(255, 255, 255)')
        await page.locator('iframe[data-vsc-demo]').scrollIntoViewIfNeeded()
        const frame=page.frameLocator('iframe[data-vsc-demo]')
        await frame.locator('#workbench[data-workbench-ready="true"]').waitFor({timeout:90000})
        assert.ok(await frame.locator('.monaco-workbench').count(),'real Workbench exists')
        await frame.getByText('cheese.scad',{exact:true}).first().waitFor({timeout:20000})
        assert.equal(await frame.getByText('cheese.stl',{exact:true}).count(),0)
        const preview=frame.frameLocator('iframe[title="SCAD AI IDE Preview"]')
        await preview.locator('#preview-root[data-preview-state="ready"]').waitFor({timeout:70000})
        assert.ok(await preview.locator('scad-app scad-preview canvas').count(),'actual Stage canvas exists')
        // Inert must block real pointer/focus interaction, not remove the
        // native rail or disable the neighboring Explorer and editor.
        const activityBar=frame.locator('.part.activitybar')
        await activityBar.waitFor({state:'visible'})
        assert.equal(await activityBar.evaluate(node=>node.inert),true)
        const sidebar=frame.locator('.part.sidebar')
        await sidebar.waitFor({state:'visible'})
        const sidebarTitle=await sidebar.locator('.title').first().innerText()
        const items=activityBar.locator('.action-item').filter({visible:true})
        assert.ok(await items.count()>0,'native activity icons remain visible')
        for(const item of await items.all()){
            const bounds=await item.boundingBox()
            if(!bounds||bounds.width===0||bounds.height===0)continue
            await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2)
        }
        assert.ok(await sidebar.isVisible(),'activity clicks cannot hide Explorer')
        assert.equal(await sidebar.locator('.title').first().innerText(),sidebarTitle)
        assert.equal(await activityBar.evaluate(node=>{
            const target=node.querySelector('[tabindex],button,a')
            target?.focus()
            return node.contains(document.activeElement)
        }),false,'activity controls cannot receive focus')
        await preview.locator('#preview-root[data-preview-state="ready"]').waitFor()

        // Verify the actual model, not just the existence of a canvas.
        const materials=await preview.locator('scad-app scad-preview').evaluate(element=>{
            const result=[]
            element.stage.modelGroup.traverse(object=>{
                if(!object.isMesh)return
                for(const material of Array.isArray(object.material)?object.material:[object.material])
                    result.push({pbr:material.isMeshStandardMaterial===true,color:material.color?.getHexString()})
            })
            return result
        })
        assert.ok(materials.length>0,'rendered 3MF contains meshes')
        assert.ok(materials.every(material=>material.pbr),'3MF participates in the same studio lighting as STL')
        assert.ok(materials.every(material=>material.color==='ffd52a'),'keep the original cheese color')
        await frame.locator('#workbench[data-demo-theme="light"]').waitFor()
        await preview.locator('body.vscode-light').waitFor()
        await page.locator('iframe[data-vsc-demo]').screenshot({path:'site-demo-light.png'})
        await page.screenshot({path:'site-demo-website-light.png',fullPage:false})
        await page.locator('[data-theme-toggle]').click()
        await frame.locator('#workbench[data-demo-theme="dark"]').waitFor({timeout:20000})
        await preview.locator('body.vscode-dark').waitFor({timeout:20000})
        await page.locator('iframe[data-vsc-demo]').screenshot({path:'site-demo-dark.png'})
        await page.screenshot({path:'site-demo-website-dark.png',fullPage:false})
        assert.equal(await page.evaluate(()=>localStorage.getItem('scad-theme')),'dark')
        assert.equal(await page.locator('html').getAttribute('data-theme'),'dark')
        assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(0, 0, 0)')
        const restored=await context.newPage()
        await restored.route('**/demo/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Isolated website test</title>'}))
        await restored.goto('http://127.0.0.1:'+server.address().port+prefix)
        assert.equal(await restored.locator('html').getAttribute('data-theme'),'dark','explicit selection persists in new page')
        await restored.close()
        await page.locator('[data-theme-toggle]').click()
        await frame.locator('#workbench[data-demo-theme="light"]').waitFor({timeout:20000})
        await preview.locator('body.vscode-light').waitFor({timeout:20000})

        const action=label=>frame.locator('[aria-label="'+label+'"],[title="'+label+'"]').filter({visible:true}).first()
        await action('Reopen as source file').click()
        await frame.locator('.monaco-editor .view-lines').first().waitFor({timeout:20000})
        assert.match(await frame.locator('.monaco-editor .view-lines').first().innerText(),/length\s*=\s*90/)
        await page.locator('iframe[data-vsc-demo]').screenshot({path:'site-demo-source.png'})
        await action('Open as Preview').click()
        await preview.locator('#preview-root[data-preview-state="ready"]').waitFor({timeout:70000})
        assert.ok(await preview.locator('scad-app scad-preview canvas').count())
        await page.setViewportSize({width:390,height:844})
        await page.locator('iframe[data-vsc-demo]').scrollIntoViewIfNeeded()
        await page.locator('iframe[data-vsc-demo]').screenshot({path:'site-demo-mobile.png'})
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile page does not overflow')
        assert.deepEqual(errors,[])
    }finally{
        await browser?.close()
        await new Promise(r=>server.close(r))
    }
})
