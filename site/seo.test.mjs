import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const site = dirname(fileURLToPath(import.meta.url));
const root = dirname(site);
const BASE = 'https://peterisdev42.github.io/scad-ai-ide/';
const routes = ['', 'for-beginners/', 'for-ai-agents/', 'why-scad-ai-ide/', 'getting-started/'];
const fileFor = route => join(site, route, 'index.html');
const pages = routes.map(route => ({route, url:BASE+route, file:fileFor(route), html:readFileSync(fileFor(route),'utf8')}));
const getTags = (html,re) => [...html.matchAll(re)].map(x=>x[1]);
const one = (xs,message) => {assert.equal(xs.length,1,message);return xs[0];};
const attr = (html,name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match = html.match(new RegExp('<meta\\s+(?:name|property)="'+escaped+'"\\s+content="([^"]*)"'));
  return match?.[1]??null;
};
const canonical = html => one(getTags(html,/<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?\s*>/g),'a unique canonical');

test('All public HTML routes have unique titles, H1, canonical and social metadata', () => {
  for(const page of pages){
    const h=page.html;
    assert.match(h,/<html lang="en">/);
    const title=one(getTags(h,/<title>([\s\S]*?)<\/title>/g),page.route+' unique title');
    assert.ok(title.includes('SCAD AI IDE')&&title.length>35);
    assert.equal((h.match(/<h1(?:\s|>)/g)||[]).length,1,page.route+' one H1');
    assert.equal(canonical(h),page.url,page.route+' canonical');
    assert.equal(attr(h,'og:url'),page.url,page.route+' OG URL');
    assert.ok(attr(h,'description')?.length>90,page.route+' description');
    assert.ok(attr(h,'og:title')?.includes('SCAD AI IDE'));
    assert.ok(attr(h,'og:description')?.length>50);
    assert.equal(attr(h,'og:image'),BASE+'assets/og-card.png');
    assert.equal(attr(h,'twitter:card'),'summary_large_image');
    assert.ok(h.includes('Source-first')||h.includes('source-first'),page.route+' discloses availability');
    assert.ok(!h.includes('cloud.umami.is')&&!h.includes('data-umami-event'),page.route+' is GEO phase, not analytics');
    const blocks=getTags(h,/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
    const schema=JSON.parse(one(blocks,page.route+' JSON-LD'));
    assert.equal(schema['@context'],'https://schema.org');
    assert.ok(!JSON.stringify(schema).includes('aggregateRating'));
    assert.ok(!JSON.stringify(schema).includes('marketplace.visualstudio.com'));
    if(page.route==='') {
      assert.ok(schema['@graph'].some(x=>x['@type']==='SoftwareApplication'&&x.url===BASE));
      assert.ok(schema['@graph'].some(x=>x['@type']==='WebSite'&&x.url===BASE));
    } else {
      assert.equal(schema['@type'],'WebPage');
      assert.equal(schema.url,page.url);
      assert.equal(schema.about['@id'],BASE+'#application');
    }
  }
  assert.equal(new Set(pages.map(p=>p.html.match(/<title>(.*?)<\/title>/)?.[1])).size,pages.length,'unique page titles');
});

test('Sitemap lists only the existing canonical public pages', () => {
  const xml=readFileSync(join(site,'sitemap.xml'),'utf8');
  const listed=getTags(xml,/<loc>([^<]+)<\/loc>/g);
  assert.deepEqual(listed,routes.map(r=>BASE+r));
  assert.equal(new Set(listed).size,listed.length,'no duplicate URL');
  assert.doesNotMatch(xml,/<(?:priority|changefreq)>/);
});

test('Internal HTML links and local downloads resolve under the GitHub Pages project prefix', () => {
  for(const page of pages){
    const hrefs=getTags(page.html,/<a\b[^>]*\bhref="([^"]+)"/g);
    for(const href of hrefs){
      if(/^(mailto:|https?:\/\/|tel:|data:)/i.test(href)&&!href.startsWith(BASE))continue;
      const dest=new URL(href,page.url);
      assert.equal(dest.host,new URL(BASE).host,'same-host link '+href);
      assert.ok(dest.pathname.startsWith('/scad-ai-ide/'),'no invalid root-relative link '+href);
      const relative=decodeURIComponent(dest.pathname.slice('/scad-ai-ide/'.length));
      const disk=join(site,relative.endsWith('/')?relative+'index.html':relative);
      assert.ok(existsSync(disk),page.route+' internal '+href+' resolves to '+disk);
      if(dest.hash&&dest.pathname===new URL(page.url).pathname){
        const id=decodeURIComponent(dest.hash.slice(1));
        assert.ok(page.html.includes('id="'+id+'"'),page.route+' target anchor '+id);
      }
    }
  }
});

test('Source-backed product facts stay aligned with generated native Agent catalog', () => {
  const claims=JSON.parse(readFileSync(join(root,'docs/marketing/product-claims.json'),'utf8'));
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  const catalog=readFileSync(join(root,'docs/agent-capability-catalog.md'),'utf8');
  const readme=readFileSync(join(root,'README.md'),'utf8');
  const n=pkg.contributes.languageModelTools.length;
  assert.equal(n,claims.agentToolCounts.tools);
  assert.equal(n,53,'revisit all marketing copy and ledger when native tool inventory changes');
  assert.equal(pkg.contributes.chatSkills.length,claims.agentToolCounts.skills);
  assert.equal(pkg.contributes.chatInstructions.length,claims.agentToolCounts.instructions);
  const count=catalog.split('\n').filter(x=>/^\| [a-z][^|]* \|/.test(x)).length;
  assert.equal(count,n,'generated catalog describes every registered tool');
  assert.ok(readme.includes(n+' native VS Code Language Model Tools'));
  assert.ok(pages[0].html.includes(n+' native VS Code Language Model Tools'));
  assert.ok(pages[0].html.includes(n+' Tools'));
  assert.doesNotMatch(pages[0].html,/\b(?:51|52) (?:registered|Tools|native)/i,'no stale tool-count claims in the homepage');
  for(const claim of claims.claims){
    assert.ok(claim.id&&claim.claim&&claim.status&&claim.evidence?.length);
    assert.ok(claim.qualifications?.length&&claim.lastReviewed);
    for(const p of claim.evidence)assert.ok(existsSync(join(root,p)),claim.id+' evidence '+p);
  }
});

test('GEO content exposes limitations in plain HTML, without requiring script execution', () => {
  const all=pages.map(p=>p.html).join('\n');
  for(const phrase of ['OpenSCAD','VS Code','source-first','Customizer','Agent','Windows','preview'])assert.ok(all.toLowerCase().includes(phrase.toLowerCase()));
  assert.match(pages[0].html,/<section class="section section-faq"/);
  assert.equal((pages[0].html.match(/<details>/g)||[]).length,8);
  assert.match(pages[0].html,/bundled STL/i);
  assert.match(pages[0].html,/<iframe[^>]+data-vsc-demo[^>]+src="\.\/demo\/index\.html"/);
  assert.match(pages[2].html,/MCP server/);
  assert.match(pages[2].html,/UNRESOLVED/);
  assert.match(pages[3].html,/not exhaustive|not exhaustive|not.*head-to-head/i);
  assert.match(pages[4].html,/npm run compile/);
  assert.match(readFileSync(join(site,'llms.txt'),'utf8'),/not a.*ranking prerequisite/i);
});

test('Open Graph PNG is built at a valid 1200 by 630 without third-party dependencies', () => {
  const png=join(site,'assets/og-card.png');
  assert.ok(existsSync(png),'run node site/build-og.mjs before tests');
  assert.ok(statSync(png).size>3000,'not an empty image');
  const bytes=readFileSync(png);
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16),1200);
  assert.equal(bytes.readUInt32BE(20),630);
});
