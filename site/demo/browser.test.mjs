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
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.stl':'application/octet-stream','.scad':'text/plain','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff':'font/woff','.woff2':'font/woff2','.json':'application/json'}
test('actual Preview draws a frame and reopens the same file as Monaco source', {timeout:120000}, async ()=>{
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
        const page=await browser.newPage({viewport:{width:1440,height:1000}})
        const errors=[]
        page.on('pageerror',e=>errors.push(String(e)))
        await page.goto('http://127.0.0.1:'+server.address().port+prefix)
        await page.locator('iframe[data-vsc-demo]').scrollIntoViewIfNeeded()
        const frame=page.frameLocator('iframe[data-vsc-demo]')
        await frame.locator('#preview-root[data-preview-state="ready"]').waitFor({timeout:70000})
        assert.ok(await frame.locator('scad-app scad-preview canvas').count(),'actual Stage canvas exists')
        const host=frame.locator('scad-app')
        await host.evaluate(el=>el.dataset.retained='yes')
        await frame.getByRole('button',{name:'Reopen as source file',exact:true}).click()
        await frame.locator('#text-editor .monaco-editor').waitFor({timeout:20000})
        assert.ok(await frame.locator('[data-pane="source"]').isVisible())
        assert.ok(!await frame.locator('[data-pane="preview"]').isVisible())
        assert.match(await frame.locator('#text-editor .view-lines').innerText(),/import\("cheese\.stl"\)/)
        await frame.getByRole('button',{name:'Open as Preview',exact:true}).click()
        assert.ok(await frame.locator('[data-pane="preview"]').isVisible())
        assert.ok(!await frame.locator('[data-pane="source"]').isVisible())
        assert.equal(await host.getAttribute('data-retained'),'yes','same preview instance is retained')
        assert.deepEqual(errors,[])
        await page.locator('iframe[data-vsc-demo]').screenshot({path:'site-demo-desktop.png'})
        await page.setViewportSize({width:390,height:844})
        await page.locator('iframe[data-vsc-demo]').scrollIntoViewIfNeeded()
        assert.ok(await frame.locator('[data-pane="preview"]').isVisible())
        await page.locator('iframe[data-vsc-demo]').screenshot({path:'site-demo-mobile.png'})
    }finally{
        await browser?.close()
        await new Promise(r=>server.close(r))
    }
})
