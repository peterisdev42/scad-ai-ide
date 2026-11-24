import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('.',import.meta.url))
export default defineConfig({
  base:'./',
  build:{target:'esnext',outDir:resolve(root,'../../site/demo/generated/workbench'),emptyOutDir:true,assetsInlineLimit:0},
  worker:{format:'es'},
  resolve:{dedupe:['vscode','monaco-editor','@codingame/monaco-vscode-api']},
  plugins:[{
    name:'load-vscode-css-as-string',enforce:'pre',
    async resolveId(source,importer,options){
      if(!source.endsWith('.css'))return
      const resolved=await this.resolve(source,importer,{...options,skipSelf:true})
      if(resolved && /node_modules\/(@codingame\/monaco-vscode|vscode|monaco-editor).*\.css$/.test(resolved.id))
        return {...resolved,id:resolved.id+'?inline'}
    }
  }]
})
