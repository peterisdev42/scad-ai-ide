import { build } from 'esbuild'
import { mkdir, copyFile, stat, rm, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const root=fileURLToPath(new URL('../',import.meta.url))
const out=resolve(root,'site/demo/generated')
await rm(out,{recursive:true,force:true})
await mkdir(resolve(out,'codicons'),{recursive:true})
// Only SCAD source is versioned. Compile real geometry on every build.
const source=resolve(root,'site/assets/cheese.scad')
const model=resolve(out,'cheese.3mf')
execFileSync(process.env.OPENSCAD_CLI||'openscad',['-o',model,source],{cwd:root,stdio:'inherit',timeout:240000,env:{...process.env,QT_QPA_PLATFORM:'offscreen'}})
const bytes=await readFile(model)
if(bytes.length<100||bytes.subarray(0,4).toString('hex')!=='504b0304')throw Error('OpenSCAD did not produce a valid 3MF archive')
const sourceBytes=await readFile(source)
const color=sourceBytes.toString('utf8').match(/cheese_color\s*=\s*"(#[0-9a-f]{6})"/i)?.[1]??null
await writeFile(resolve(out,'cheese-preview.json'),JSON.stringify({source:'cheese.scad',sha256:createHash('sha256').update(sourceBytes).digest('hex'),color})+'\n')

await build({absWorkingDir:root,bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'linked',logLevel:'info',entryPoints:['site/demo/preview.ts'],tsconfig:'tsconfig.webview.json',outfile:resolve(out,'preview.js'),loader:{'.stl':'binary','.glsl':'text'}})
for(const name of ['codicon.css','codicon.ttf'])await copyFile(resolve(root,'node_modules/@vscode/codicons/dist',name),resolve(out,'codicons',name))
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['run','build','--prefix','tools/pages-workbench'],{cwd:root,stdio:'inherit',env:{...process.env,NODE_OPTIONS:'--max-old-space-size=6144'}})
for(const name of ['cheese.3mf','cheese-preview.json','preview.js','workbench/index.html','codicons/codicon.css','codicons/codicon.ttf'])if(!(await stat(resolve(out,name))).size)throw Error('Empty demo asset: '+name)
