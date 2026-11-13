import {spawn} from 'node:child_process'
import {mkdir,readFile,writeFile,mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
const label=process.argv[2]??'stable',base=process.env.SCAD_HOST_TEMP==='1'?await mkdtemp(join(tmpdir(),'p3-host-'+label+'-')):resolve('.build','p3-host-'+label+'-'+Date.now()),workspace=join(base,'workspace'),profile=join(base,'profile'),runtime=process.env.SCAD_OPENSCAD_EXECUTABLE??'/Users/q/Library/Application Support/Code/User/globalStorage/undefined_publisher.scad-ai-ide/runtimes/darwin-arm64/700816722/bin/openscad',code=process.env.SCAD_VSCODE_EXECUTABLE??(label==='minimum'?resolve('.vscode-test/vscode-darwin-arm64-1.140.0/Visual Studio Code.app/Contents/MacOS/Code'):'/Applications/Visual Studio Code.app/Contents/MacOS/Code')
await mkdir(join(workspace,'.vscode'),{recursive:true});await mkdir(join(profile,'User'),{recursive:true})
await writeFile(join(profile,'User/settings.json'),JSON.stringify({'files.autoSave':'off','chat.saveBeforeSend':false,'scad-ai-ide.openscadPath':runtime}))
const env={...process.env,SCAD_TEST_TRUSTED_FIXTURE:'1',SCAD_TEST_WORKSPACE:workspace,SCAD_TEST_USER_DATA:profile,SCAD_MESH_EVIDENCE:join(base,'evidence'),SCAD_OPENSCAD_EXECUTABLE:runtime,SCAD_TEST_OPENSCAD:runtime,SCAD_VSCODE_EXECUTABLE:code,SCAD_TEST_FOCUS_HELPER:resolve('.build/customizer-focus'),SCAD_TEST_FOCUS_APP:resolve(code,'../../..'),SCAD_PREVIEW_EXPORTER:process.env.SCAD_PREVIEW_EXPORTER??'/Users/q/Library/Application Support/Code/User/globalStorage/undefined_publisher.scad-ai-ide/preview-exporter/openscad-2026.11-RC0/bin/openscad-preview-exporter'}
const bundleBefore=createHash('sha256').update(await readFile('dist/extension.js')).digest('hex'),workerBefore=createHash('sha256').update(await readFile('dist/assembly-verification-worker.mjs')).digest('hex')
const args=['node_modules/@vscode/test-cli/out/bin.mjs',...(process.env.SCAD_HOST_GREP?['--grep',process.env.SCAD_HOST_GREP]:[])],started=Date.now(),child=spawn(process.execPath,args,{env,stdio:'inherit'})
console.log('P3 Host evidence: '+base)
const exitCode=await new Promise((r,j)=>{child.once('error',j);child.once('exit',r)})
await writeFile(join(base,'run.json'),JSON.stringify({label,command:[process.execPath,...args],exitCode,elapsedMs:Date.now()-started,bundleSha256:bundleBefore,workerSha256:workerBefore,bundleUnchanged:bundleBefore===createHash('sha256').update(await readFile('dist/extension.js')).digest('hex'),workerUnchanged:workerBefore===createHash('sha256').update(await readFile('dist/assembly-verification-worker.mjs')).digest('hex'),environment:Object.fromEntries(Object.entries(env).filter(([k])=>/^SCAD_/.test(k)))},null,2));process.exitCode=exitCode??1
