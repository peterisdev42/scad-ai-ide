// Assemble the publishable site without modifying source HTML or CSS.
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve, relative, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { transform } from 'esbuild'

const root=fileURLToPath(new URL('../',import.meta.url))
const site=resolve(root,'site'), out=resolve(root,'.build/pages')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const read=path=>readFile(resolve(site,path),'utf8')
const write=async(path,content)=>{const dest=resolve(out,path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,content)}
const copy=async(from,to=from)=>{const dest=resolve(out,to);await mkdir(dirname(dest),{recursive:true});await cp(resolve(site,from),dest,{recursive:true})}
async function walk(dir){
  const result=[]
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name)
    if(entry.isDirectory())result.push(...await walk(path))
    else if(entry.isFile())result.push(path)
  }
  return result.sort()
}
await rm(out,{recursive:true,force:true})
await mkdir(out,{recursive:true})
for(const path of ['assets','favicon.svg','product.json','llms.txt','sitemap.xml','geist/icons.svg'])await copy(path)

const imports=[...(await read('geist/index.css')).matchAll(/@import "\.\/([^"]+)";/g)].map(m=>'geist/'+m[1])
if(imports.length!==9)throw Error('Unexpected Geist module graph')
const cssSource=(await Promise.all([...imports,'components/diagrams.css','styles.css'].map(read))).join('\n').replaceAll('../assets/fonts/','./fonts/')
const css=(await transform(cssSource,{loader:'css',minify:true,target:'es2022',legalComments:'none'})).code
const cssPath='assets/site.'+hash(css).slice(0,16)+'.css'
await write(cssPath,css)
const main=(await transform(await read('main.js'),{loader:'js',minify:true,target:'es2022'})).code
const mainPath='assets/site.'+hash(main).slice(0,16)+'.js'
await write(mainPath,main)
const theme=(await transform(await read('geist/theme.js'),{loader:'js',minify:true,target:'es2022'})).code
if(/<\/script/i.test(theme))throw Error('Unsafe inline theme script')
const runtime=['demo/generated','demo/preview.html','demo/preview-host.js','demo/theme.css','demo/focus-guard.js','assets/cheese.scad']
const digest=createHash('sha256')
const runtimeFiles=[...await walk(resolve(site,'demo/generated')),...runtime.slice(1).map(p=>resolve(site,p))].sort()
let runtimeBytes=0
for(const path of runtimeFiles){
  const bytes=await readFile(path)
  runtimeBytes+=bytes.length
  digest.update(JSON.stringify([relative(site,path).split('\\').join('/'),hash(bytes)]))
}
const release=digest.digest('hex').slice(0,24)
const releasePath='demo/releases/'+release
for(const path of runtime)await copy(path,releasePath+'/'+path)
const demoPath='./'+releasePath+'/demo/generated/workbench/index.html'
let html=await read('index.html')
const originalStyles=['geist/index.css','components/diagrams.css','styles.css'].map(path=>'<link rel="stylesheet" href="./'+path+'">')
for(const tag of originalStyles)if(!html.includes(tag))throw Error('Missing stylesheet '+tag)
html=html.replace(originalStyles[0],'<link rel="stylesheet" href="./'+cssPath+'">')
for(const tag of originalStyles.slice(1))html=html.replace(tag,'')
html=html.replace('<script src="./geist/theme.js"></script>','<script>'+theme+'</script>')
html=html.replace('<script src="./main.js" defer></script>','<script src="./'+mainPath+'" defer></script>')
html=html.replace('data-demo-src="./demo/generated/workbench/index.html"','data-demo-cache data-demo-src="'+demoPath+'"')
if(!html.includes('data-demo-cache')||html.includes('./geist/index.css'))throw Error('HTML assembly failed')
await write('index.html',html)
function redirect(target){
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><title>SCAD AI IDE Demo</title><p><a href="'+target+'">Open the interactive demo</a></p><script>const url=new URL('+JSON.stringify(target)+',location.href);url.search=location.search;location.replace(url)</script></html>'
}
await write('demo/index.html',redirect('./releases/'+release+'/demo/generated/workbench/index.html'))
await write('demo/preview.html',redirect('./releases/'+release+'/demo/preview.html'))
const worker=(await read('sw.template.js')).replace('__DEMO_RELEASE__',release)
await write('sw.js',worker)
const report={release,css:{requests:1,bytes:Buffer.byteLength(css),gzipBytes:gzipSync(css).length},marketingJS:{bytes:Buffer.byteLength(main)+Buffer.byteLength(theme),gzipBytes:gzipSync(main).length+gzipSync(theme).length},demo:{files:runtimeFiles.length,bytes:runtimeBytes},demoPath}
if(report.marketingJS.gzipBytes>10*1024)throw Error('Marketing JS exceeds 10 KiB gzip budget')
await write('build-metrics.json',JSON.stringify(report,null,2)+'\n')
console.log('Pages build metrics:',JSON.stringify(report))
