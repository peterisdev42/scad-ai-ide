import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const site=dirname(fileURLToPath(import.meta.url)),root=dirname(site),base='https://peterisdev42.github.io/scad-ai-ide/';
const read=p=>readFileSync(join(site,p),'utf8');
const html=read('index.html'),manifest=JSON.parse(read('product.json'));
test('single canonical product page, static semantic modules and metadata',()=>{assert.match(html,/<html lang="en" data-theme="light">/);assert.equal((html.match(/<h1(?:\s|>)/g)||[]).length,1);assert.ok(html.includes('<link rel="canonical" href="'+base+'">'));const schema=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);assert.ok(schema['@graph'].some(x=>x['@type']==='SoftwareApplication'&&x.featureList.length===8));assert.equal(manifest.modules.length,8);for(const m of manifest.modules){assert.ok(html.includes('id="'+m.id+'"'));assert.ok(html.includes(m.name.replaceAll('&','&amp;')));assert.ok(m.capabilities.length&&m.evidence.length&&m.limitations);assert.ok(read('llms.txt').includes(m.url));}assert.deepEqual([...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(x=>x[1]),[base]);});
test('legacy links are redirect-only; all homepage anchors and local links resolve',()=>{for(const [route,id] of Object.entries({"for-beginners":"audiences","for-ai-agents":"agent-integration","why-scad-ai-ide":"comparison","getting-started":"getting-started"})){const h=read(route+'/index.html');assert.ok(h.includes('content="0;url=../#'+id+'"'));assert.ok(h.includes('href="'+base+'"'));assert.ok(!html.includes('href="./'+route+'/'));}for(const [,href] of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)){if(href.startsWith('#'))assert.ok(html.includes('id="'+href.slice(1)+'"'),href);else if(href.startsWith('./'))assert.ok(existsSync(join(site,href)),href);}});
test('agent counts, source evidence and product limitations remain truthful',()=>{const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8')),claims=JSON.parse(readFileSync(join(root,'docs/marketing/product-claims.json'),'utf8')),catalog=readFileSync(join(root,'docs/agent-capability-catalog.md'),'utf8');const actual={tools:pkg.contributes.languageModelTools.length,skills:pkg.contributes.chatSkills.length,instructions:pkg.contributes.chatInstructions.length};assert.deepEqual(manifest.agentToolCounts,actual);assert.deepEqual(claims.agentToolCounts,actual);assert.equal(catalog.split('\n').filter(x=>/^\| [a-z][^|]* \|/.test(x)).length,actual.tools);assert.ok(html.includes(actual.tools+' native VS Code Language Model Tools'));for(const m of manifest.modules)for(const p of m.evidence)assert.ok(existsSync(join(root,p.split('/blob/main/')[1])),p);for(const phrase of ['source-first','MCP server','UNRESOLVED','Windows','NOT_CHECKED','compiled from the actual cheese.scad source','npm run compile'])assert.ok(html.toLowerCase().includes(phrase.toLowerCase()),phrase);assert.ok((html.match(/<details(?:\s|>)/g)||[]).length>=20);assert.doesNotMatch(html,/cloud\.umami\.is|aggregateRating/);assert.match(read('llms.txt'),/not a Google search ranking prerequisite/);});
test('default theme is light, and social card is valid',()=>{assert.doesNotMatch(html,/prefers-color-scheme/);assert.match(html,/<script src="\.\/geist\/theme\.js"><\/script>/);const png=join(site,'assets/og-card.png');assert.ok(statSync(png).size>3000);const bytes=readFileSync(png);assert.equal(bytes.readUInt32BE(16),1200);assert.equal(bytes.readUInt32BE(20),630);});


test('FAQ text and machine-readable product facts match; IDs and ARIA references are unique and valid',()=>{
  const decode=s=>s.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&#39;',"'");
  const actual=[...html.matchAll(/<details class="geist-collapse"><summary><span class="geist-collapse-title">([^<]+)<\/span><span class="geist-collapse-indicator" aria-hidden="true"><\/span><\/summary><p>([^<]+)<\/p><\/details>/g)].map(m=>({question:decode(m[1]),answer:decode(m[2])}));
  assert.deepEqual(actual,manifest.faq);
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(new Set(ids).size,ids.length,'duplicate ID');
  for(const [,refs] of html.matchAll(/aria-labelledby="([^"]+)"/g))for(const id of refs.split(/\s+/))assert.ok(ids.includes(id),'unresolved aria-labelledby '+id);
  const llms=read('llms.txt');
  for(const m of manifest.modules){
    assert.ok(llms.includes(m.summary)&&llms.includes(m.limitations),m.id+' GEO content divergence');
    assert.ok(html.includes(m.summary.replaceAll('&','&amp;'))&&html.includes(m.limitations.replaceAll('&','&amp;')),m.id+' HTML divergence');
  }
  for(const [,href] of html.matchAll(/\bhref="(\.\/[^"#]+)(?:#[^"]*)?"/g))assert.ok(existsSync(join(site,href)),href+' local stylesheet/icon/link');
  for(const [,src] of html.matchAll(/\bsrc="(\.\/[^"]+)"/g))assert.ok(existsSync(join(site,src)),src+' local resource');
});

test('companion Registry links are visible in navigation, library section and footer',()=>{
  const target='https://peterisdev42.github.io/scad-registry/';
  assert.ok(html.match(/<nav class="main-nav"[\s\S]*?<\/nav>/)[0].includes(target));
  assert.ok(html.match(/<section class="capability geist-grid" id="library-management"[\s\S]*?<\/section>/)[0].includes(target));
  assert.ok(html.match(/<footer[\s\S]*?<\/footer>/)[0].includes(target));
  assert.ok(read('llms.txt').includes(target));
});
