import { build } from 'esbuild'
import { mkdir, copyFile, stat, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const root=fileURLToPath(new URL('../',import.meta.url))
const out=resolve(root,'site/demo/generated')
await rm(out,{recursive:true,force:true})
await mkdir(resolve(out,'codicons'),{recursive:true})
await build({absWorkingDir:root,bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'linked',logLevel:'info',entryPoints:['site/demo/preview.ts'],tsconfig:'tsconfig.webview.json',outfile:resolve(out,'preview.js'),loader:{'.stl':'binary','.glsl':'text'}})
for(const name of ['codicon.css','codicon.ttf'])await copyFile(resolve(root,'node_modules/@vscode/codicons/dist',name),resolve(out,'codicons',name))
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['run','build','--prefix','tools/pages-workbench'],{cwd:root,stdio:'inherit',env:{...process.env,NODE_OPTIONS:'--max-old-space-size=6144'}})
for(const name of ['preview.js','workbench/index.html','codicons/codicon.css','codicons/codicon.ttf'])if(!(await stat(resolve(out,name))).size)throw Error('Empty demo asset: '+name)
