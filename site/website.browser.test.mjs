// Independent marketing UI tests: isolate the expensive iframe; demo/browser.test.mjs
// still exercises the actual compiled Workbench and Preview.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import test from 'node:test';
const root=process.env.PAGES_ROOT?resolve(process.env.PAGES_ROOT):fileURLToPath(new URL('.',import.meta.url));
const prefix='/scad-ai-ide/';
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json','.txt':'text/plain','.xml':'application/xml','.scad':'text/plain'};
test('marketing website: responsive layout, every FAQ, theme, navigation, downloads and redirects', {timeout:120000},async()=>{
  const server=createServer(async(req,res)=>{
    try {
      const path=new URL(req.url,'http://localhost').pathname;
      if(!path.startsWith(prefix)){res.writeHead(404).end();return}
      const rel=decodeURIComponent(path.slice(prefix.length));
      const file=resolve(root,rel.endsWith('/')||!rel?rel+'index.html':rel);
      if(!file.startsWith(resolve(root)+sep)){res.writeHead(403).end();return}
      const bytes=await readFile(file);
      res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'}).end(bytes);
    }catch{if(!res.headersSent)res.writeHead(404);res.end()}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port+prefix;
  let browser;
  try {
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:960},colorScheme:'dark',reducedMotion:'reduce',serviceWorkers:'block'});
    await context.route('**/demo/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Demo isolated for marketing tests</title>'}));
    await context.route('https://cloud.umami.is/script.js',route=>route.fulfill({contentType:'application/javascript',body:'/* Analytics stub for CI */'}));
    const page=await context.newPage();
    const errors=[],failed=[];
    page.on('pageerror',e=>errors.push(String(e)));
    page.on('response',response=>{if(response.url().startsWith(url)&&response.status()>=400)failed.push(response.url()+' '+response.status())});
    await page.goto(url);
    const theme=page.locator('[data-theme-toggle]');
    await theme.waitFor({state:'visible'});
    assert.equal(await page.locator('.main-nav a[href="https://peterisdev42.github.io/scad-registry/"]').count(),1);
    const cta=page.locator('.hero-ctas a[href="#demo"]');
    assert.equal(await cta.textContent(),'Try the 3D Demo');
    assert.equal(await cta.locator('*').count(),0);
    assert.equal(await cta.evaluate(e=>getComputedStyle(e).whiteSpace),'nowrap');
    if(process.env.PAGES_ROOT)assert.equal(await page.locator('head link[rel="stylesheet"]').count(),1);
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    await page.evaluate(async()=>{await document.fonts.load('400 16px Geist');await document.fonts.load('400 13px "Geist Mono"');await document.fonts.ready});
    assert.ok(await page.evaluate(()=>[...document.fonts].some(f=>f.family==='Geist'&&f.status==='loaded')));
    assert.ok(await page.evaluate(()=>[...document.fonts].some(f=>f.family.replaceAll('"','')==='Geist Mono'&&f.status==='loaded')));
    for (const mode of ['light','dark']) {
      if(await page.locator('html').getAttribute('data-theme')!==mode)await theme.click();
      assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),mode==='light'?'rgb(255, 255, 255)':'rgb(0, 0, 0)');
      for (const width of [320,390,680,768,900,1024,1440]) {
        await page.setViewportSize({width,height:960});
        const report=await page.evaluate(()=>{
          const problems=[];
          const root=document.documentElement;
          if(root.scrollWidth>root.clientWidth+1)problems.push('document overflow '+root.scrollWidth+'/'+root.clientWidth);
          const nav=[...document.querySelectorAll('.main-nav a,.nav-actions a,.nav-actions button')].filter(e=>!e.hidden);
          for(const link of nav){const r=link.getBoundingClientRect();if(r.left<-1||r.right>root.clientWidth+1)problems.push('navigation clipped: '+link.textContent.trim())}
          const faqs=[...document.querySelectorAll('.faq-items details')];
          for(const d of faqs){
            const s=d.querySelector('summary'),title=s.querySelector('.geist-collapse-title'),arrow=s.querySelector('.geist-collapse-indicator'),p=d.querySelector('p');
            if(!title||!arrow){problems.push('missing stable summary columns');continue}
            d.open=false;
            const before=title.getBoundingClientRect(),iconBefore=arrow.getBoundingClientRect(),height=s.getBoundingClientRect().height;
            s.click();
            const after=title.getBoundingClientRect(),iconAfter=arrow.getBoundingClientRect();
            if(!d.open||!p.getBoundingClientRect().height)problems.push('answer failed to expand');
            if(Math.abs(before.left-after.left)>.5||Math.abs(before.width-after.width)>.5||Math.abs(before.height-after.height)>.5||Math.abs(height-s.getBoundingClientRect().height)>.5||Math.abs(iconBefore.left-iconAfter.left)>.5)problems.push('FAQ title shifted: '+title.textContent);
            if(!['start','left'].includes(getComputedStyle(title).textAlign))problems.push('FAQ not left aligned');
            if(after.right>iconAfter.left+.5)problems.push('FAQ arrow overlaps title');
            s.click();if(d.open)problems.push('answer failed to collapse');
          }
          return {problems,count:faqs.length};
        });
        assert.equal(report.count,20);
        assert.deepEqual(report.problems,[],mode+' at '+width+'px');
      }
      // Real mouse and keyboard, plus native summary state (no JS-dependent accordion).
      await page.setViewportSize({width:390,height:844});
      const summary=page.locator('#faq summary').first();
      await summary.click();
      assert.equal(await summary.evaluate(e=>e.parentElement.open),true);
      await summary.press('Enter');
      assert.equal(await summary.evaluate(e=>e.parentElement.open),false);
      await summary.press('Space');
      assert.equal(await summary.evaluate(e=>e.parentElement.open),true);
      await page.screenshot({path:'site-demo-faq-'+mode+'-mobile.png'});
      await summary.press('Space');
      await page.setViewportSize({width:1440,height:960});
      await page.locator('.main-nav a[href="#features"]').click();
      assert.equal(new URL(page.url()).hash,'#features');
      for(const width of [390,768,1024,1440]){
        await page.setViewportSize({width,height:960});
        // ResizeObserver publishes the actual sticky header height.
        await page.waitForFunction(()=>Math.abs(parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)-document.querySelector('.site-header').getBoundingClientRect().height)<=1);
        for(const id of ['features','agent-integration','comparison','getting-started','top']){
          const selector=id==='top'?'.site-header .brand':'.main-nav a[href="#'+id+'"]';
          await page.locator(selector).click();
          assert.equal(new URL(page.url()).hash,'#'+id);
          const delta=await page.evaluate(id=>document.getElementById(id).getBoundingClientRect().top-document.querySelector('.site-header').getBoundingClientRect().bottom,id);
          assert.ok(Math.abs(delta)<=1,mode+' '+width+'px #'+id+' differs from header edge by '+delta+'px');
        }
      }
      await page.locator('.main-nav a[href="#features"]').click();
      await page.locator('.overview-grid a[href="#interactive-preview"]').click();
      assert.equal(new URL(page.url()).hash,'#interactive-preview');
      await page.locator('#interactive-preview a[href="#demo"]').click();
      assert.equal(new URL(page.url()).hash,'#demo');
      await page.locator('.hero-copy').scrollIntoViewIfNeeded();
      await page.screenshot({path:'site-demo-marketing-'+mode+'.png'});
    }
    const persisted=await context.newPage();await persisted.goto(url);
    assert.ok(await persisted.evaluate(()=>Math.abs(scrollY)<=1),'unfragmented navigation must start at top');
    await persisted.reload();
    assert.ok(await persisted.evaluate(()=>Math.abs(scrollY)<=1),'unfragmented reload must not scroll');
    await persisted.setViewportSize({width:390,height:844});
    await persisted.goto(url+'#comparison');
    await persisted.waitForFunction(()=>Math.abs(document.getElementById('comparison').getBoundingClientRect().top-document.querySelector('.site-header').getBoundingClientRect().bottom)<=1);
    await persisted.goto(url);
    assert.equal(await persisted.locator('html').getAttribute('data-theme'),'dark');
    await theme.click();
    await persisted.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await persisted.close();
    const download=page.waitForEvent('download');
    await page.locator('a[download="cheese.scad"]').click();
    assert.equal((await download).suggestedFilename(),'cheese.scad');
    for(const [route,id] of [['for-beginners','audiences'],['for-ai-agents','agent-integration'],['why-scad-ai-ide','comparison'],['getting-started','getting-started']]){
      await page.goto(url+route+'/');
      await page.waitForURL(url+'#'+id);
      assert.equal(await page.locator('#'+id).count(),1);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
    const nojs=await browser.newContext({javaScriptEnabled:false});
    await nojs.route('**/demo/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Isolated demo</title>'}));
    const plain=await nojs.newPage();await plain.goto(url);
    assert.equal(await plain.locator('main .capability').count(),8);
    assert.equal(await plain.locator('[data-theme-toggle]').isVisible(),false);
    const first=plain.locator('#faq summary').first();await first.click();
    assert.equal(await plain.locator('#faq details[open]').count(),1);
    await nojs.close();
  }finally{await browser?.close();await new Promise(r=>server.close(r))}
});
