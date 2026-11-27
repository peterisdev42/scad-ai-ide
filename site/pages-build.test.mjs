import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
const out=fileURLToPath(new URL('../.build/pages/',import.meta.url))
const read=p=>readFileSync(resolve(out,p),'utf8')
test('publish only optimized, content-versioned runtime and SEO files',()=>{
  const html=read('index.html'),m=JSON.parse(read('build-metrics.json'))
  assert.equal(html.split('<script defer src="https://cloud.umami.is/script.js" data-website-id="8b733577-948c-4d00-a61f-d59984ad88f3"></script>').length,2)
  assert.equal((html.match(/cloud\.umami\.is/g)||[]).length,1)
  for(const path of ['for-beginners/index.html','for-ai-agents/index.html','why-scad-ai-ide/index.html','getting-started/index.html','demo/index.html','demo/preview.html'])assert.doesNotMatch(read(path),/cloud\.umami\.is/)
  assert.match(m.release,/^[a-f0-9]{24}$/)
  assert.equal((html.match(/<link rel="stylesheet"/g)||[]).length,1)
  const css=html.match(/href="\.\/(assets\/site\.[a-f0-9]{16}\.css)"/)[1]
  assert.doesNotMatch(read(css),/@import/)
  assert.match(read(css),/\.\/fonts\/Geist-Variable\.woff2/)
  assert.ok(m.marketingJS.gzipBytes<=10240)
  assert.ok(html.includes('data-demo-cache data-demo-src="'+m.demoPath+'"'))
  assert.ok(existsSync(resolve(out,m.demoPath)))
  assert.ok(existsSync(resolve(out,'demo/releases/'+m.release+'/demo/generated/cheese.3mf')))
  assert.ok(existsSync(resolve(out,'demo/releases/'+m.release+'/assets/cheese.scad')))
  assert.ok(read('sw.js').includes(m.release))
  assert.ok(!existsSync(resolve(out,'build-demo.mjs')))
  assert.ok(!existsSync(resolve(out,'geist.test.mjs')))
  assert.equal(readdirSync(resolve(out,'demo/releases')).length,1)
  for(const path of ['llms.txt','product.json','sitemap.xml','assets/og-card.png','assets/fonts/LICENSE.txt','demo/index.html','demo/preview.html'])assert.ok(existsSync(resolve(out,path)),path)
  assert.equal((html.match(/<details class="geist-collapse">/g)||[]).length,20)
  assert.equal((html.match(/class="capability geist-grid"/g)||[]).length,8)
})
