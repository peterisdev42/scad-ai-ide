import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('./index.html');
const css = read('./geist/index.css');
const modules = ['fonts','colors','spacing','typography','materials','motion','grid','base','components'];
test('design-system layers are imported before page styles and all variables resolve', () => {
  for (const name of modules) assert.ok(css.includes('@import "./'+name+'.css"'));
  assert.ok(html.indexOf('./geist/index.css') < html.indexOf('./styles.css'));
  const all = modules.map(n=>read('./geist/'+n+'.css')).join('\n') + '\n' + read('./styles.css') + '\n' + read('./components/diagrams.css');
  const defs = new Set([...all.matchAll(/(--[\w-]+)\s*:/g)].map(x=>x[1]));
  for (const [,name] of all.matchAll(/var\((--[\w-]+)/g)) assert.ok(defs.has(name) || name==='--progress-value', 'undefined '+name);
  for (const p of ['./styles.css','./components/diagrams.css']) {
    assert.doesNotMatch(read(p), /#[\da-f]{3,8}\b|\b(?:rgb|hsl|oklch)a?\(/i, p+' bypasses palette');
    assert.doesNotMatch(read(p), /\b(?:font-size|border-radius|box-shadow)\s*:/, p+' bypasses typography/materials');
  }
  assert.doesNotMatch(html,/class="(?:button|tag|meter)(?: |")/);
  assert.doesNotMatch(html,/style="(?!\-\-progress-value:)/);
  for (const id of ['sun','moon','github']) assert.ok(read('./geist/icons.svg').includes('id="'+id+'"'));
});
test('all local color families have ten steps in both themes', () => {
  const colors = read('./geist/colors.css');
  for (const family of ['gray','gray-alpha','blue','red','amber','green','teal','purple','pink']) for(let step=100;step<=1000;step+=100) {
    assert.equal((colors.match(new RegExp('--ds-'+family+'-'+step+':','g'))||[]).length,2);
  }
  assert.match(colors,/--ds-background-100: #ffffff/);
  assert.match(colors,/--ds-background-100: #000000/);
});
function themeHarness(saved, blocked=false) {
  let value=saved, click, ready, storage; const root={dataset:{theme:'light'}};
  const meta={content:''}, toggle={title:'',setAttribute(k,v){this[k]=v},addEventListener(k,f){click=f}};
  const ctx={document:{documentElement:root,querySelector(s){return s.includes('meta')?meta:toggle},addEventListener(k,f){ready=f}},window:{addEventListener(k,f){storage=f}},localStorage:{getItem(){if(blocked)throw Error('blocked');return value},setItem(k,v){if(blocked)throw Error('blocked');value=v}}};
  runInNewContext(read('./geist/theme.js'),ctx);ready();
  return {root,meta,toggle,click:()=>click(),storage:event=>storage(event),saved:()=>value};
}
test('first visit, persistence, invalid storage, blocked storage and cross-tab sync',()=>{
  const h=themeHarness(null);assert.equal(h.root.dataset.theme,'light');assert.equal(h.meta.content,'#ffffff');
  h.click();assert.equal(h.root.dataset.theme,'dark');assert.equal(h.saved(),'dark');assert.equal(h.toggle['aria-label'],'Switch to light theme');
  assert.equal(themeHarness(h.saved()).root.dataset.theme,'dark');
  h.storage({key:'scad-theme',newValue:'light'});assert.equal(h.root.dataset.theme,'light');
  assert.equal(themeHarness('invalid').root.dataset.theme,'light');
  const b=themeHarness(null,true);b.click();assert.equal(b.root.dataset.theme,'dark');
});
test('build stages official WOFF2 fonts and their license',()=>{
  const fontCss=read('./geist/fonts.css');
  for(const name of ['Geist-Variable.woff2','GeistMono-Variable.woff2']) {
    assert.ok(fontCss.includes('../assets/fonts/'+name));
    const path=new URL('./assets/fonts/'+name,import.meta.url);
    if(process.env.CI || existsSync(path)) assert.equal(readFileSync(path).subarray(0,4).toString(),'wOF2');
  }
  if(process.env.CI) assert.ok(existsSync(new URL('./assets/fonts/LICENSE.txt',import.meta.url)));
});

test('FAQ uses explicit stable title and indicator, no native duplicate marker',()=>{
  const component=read('./geist/components.css');
  assert.match(component,/grid-template-columns: minmax\(0, 1fr\) var\(--space-16\)/);
  assert.match(component,/\.geist-collapse-title[^}]+text-align: start/);
  assert.match(component,/summary::-webkit-details-marker/);
  assert.equal((html.match(/class="geist-collapse-title"/g)||[]).length,20);
});

test('sticky header is the sole anchor offset; boot frame does not receive focus',()=>{
  const css=read('./geist/base.css');
  assert.match(css,/scroll-padding-top: var\(--header-height\)/);
  assert.doesNotMatch(css,/scroll-padding-top: calc\(/);
  assert.match(html,/<iframe[^>]+data-vsc-demo inert/);
  const workbench=read('../tools/pages-workbench/main.ts');
  assert.match(workbench,/preserveFocus:true/);
  assert.doesNotMatch(workbench,/executeCommand\('workbench\.view\.explorer'\)/);
  assert.match(workbench,/unlockHostFrame\(\)/);
  assert.match(workbench,/^import '\.\.\/\.\.\/site\/demo\/focus-guard\.js'/);
  assert.match(read('../tools/pages-workbench/index.html'),/<div id="workbench" inert>/);
  assert.match(read('./demo/preview-host.js'),/^import '\.\/focus-guard\.js'/);
});
