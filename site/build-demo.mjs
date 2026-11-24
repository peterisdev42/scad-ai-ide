import { build } from 'esbuild'
import { mkdir, copyFile, stat, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root=fileURLToPath(new URL('../',import.meta.url))
const out=resolve(root,'site/demo/generated')
await rm(out,{recursive:true,force:true})
await mkdir(resolve(out,'codicons'),{recursive:true})
const shared={absWorkingDir:root,bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'linked',logLevel:'info'}
await build({...shared,entryPoints:['site/demo/preview.ts'],tsconfig:'tsconfig.webview.json',outfile:resolve(out,'preview.js'),loader:{'.stl':'binary','.glsl':'text'}})
await build({...shared,entryPoints:['site/demo/editor.ts'],tsconfig:'tsconfig.webview.json',outfile:resolve(out,'editor.js'),loader:{'.ttf':'file','.woff':'file','.woff2':'file'}})
await build({...shared,entryPoints:['site/demo/editor-worker.ts'],outfile:resolve(out,'editor.worker.js'),loader:{'.wasm':'file','.ttf':'file'}})
for(const name of ['codicon.css','codicon.ttf']) await copyFile(resolve(root,'node_modules/@vscode/codicons/dist',name),resolve(out,'codicons',name))
for(const name of ['preview.js','editor.js','editor.css','editor.worker.js','codicons/codicon.css','codicons/codicon.ttf']) {
    if(!(await stat(resolve(out,name))).size)throw Error('Empty demo asset: '+name)
}
console.log('Built shared Preview WebView, Monaco and Codicons from the locked extension dependencies.')
