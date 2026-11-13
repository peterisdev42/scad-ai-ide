import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile, open, cp, readdir, rm, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

// This is the existing F5 development profile: credentials remain in the provider's SecretStorage.
// No token extraction, account migration, model response fabrication, or protected SourceApply approval.
const repo = fileURLToPath(new URL('../', import.meta.url))
const executable = process.env.SCAD_VSCODE_EXECUTABLE ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code'
const staged = JSON.parse(await readFile(join(repo, '.build/omlx-dev/host.json'), 'utf8'))
const directory = await mkdtemp(join(tmpdir(), 'assembly-native-f5-'))
const workspace = join(directory, 'workspace'),
    observer = join(directory, 'observer'),
    file = join(workspace, 'model.scad'), manifest=join(workspace,'.scad/verification.json')
await mkdir(join(workspace, '.vscode'), { recursive: true })
await mkdir(observer)
await mkdir(join(workspace,'.scad'),{recursive:true})
const source = 'part="body";\ngap=0.18;\nif(part=="body") difference(){cube([20,20,10]);translate([1,1,1])cube([18,18,10]);}\nelse if(part=="lid") translate([0,0,10+gap])cube([20,20,1]);\n'
const baseline={schemaVersion:1,units:'mm',entry:'./model.scad',parts:['body','lid'].map(id=>({id,selector:{type:'define',name:'part',value:id},transform:{translate:[0,0,0],rotate:[0,0,0]}})),checks:[{id:'gap',type:'clearance',parts:['body','lid'],min:.25,max:.35},...['body','lid'].flatMap(id=>[{id:id+'-volume',type:'volume',part:id,min:id==='body'?1083.99:399.99,max:id==='body'?1084.01:400.01},{id:id+'-bounds',type:'bounds',part:id,minDimensions:[19.99999,19.99999,id==='body'?9.99999:.99999],maxDimensions:[20.00001,20.00001,id==='body'?10.00001:1.00001]}])]}
const manifestText=JSON.stringify(baseline,null,2),manifestHash=createHash('sha256').update(manifestText).digest('hex')
await writeFile(manifest,manifestText)
await writeFile(file, source)
const ideExtension = join(directory, 'scad-ai-ide'),
    providerExtension = join(directory, 'omlx-provider')
await mkdir(ideExtension)
for (const name of ['package.json', 'dist', 'resources', 'skills', 'instructions', 'syntaxes', 'snippets', 'media', 'server', 'licenses']) {
    await cp(join(repo, name), join(ideExtension, name), { recursive: true })
}
await cp(staged.omlxExtension, providerExtension, { recursive: true })

const exposure = []
const networkAbort = new AbortController()
const relay = createServer(async (request, response) => {
    if (!['/v1/models', '/v1/chat/completions'].includes(request.url)) {
        response.writeHead(404).end()
        return
    }
    try {
        const chunks = []
        let size = 0
        for await (const chunk of request) {
            size += chunk.length
            assert.ok(size < 8 * 1048576)
            chunks.push(chunk)
        }
        const bytes = Buffer.concat(chunks),
            body = bytes.length ? JSON.parse(bytes) : undefined
        const record = { at: new Date().toISOString(), path: request.url, model: body?.model, tools: body?.tools?.map((t) => ({ name: t.function.name, schemaSha256: createHash('sha256').update(JSON.stringify(t.function.parameters)).digest('hex') })) }
        exposure.push(record)
        await writeFile(join(directory, 'tool-exposure.json'), JSON.stringify({ scope: 'Transparent loopback forwarding; no credentials, prompts or payload changes recorded', requests: exposure }, null, 2))
        const incoming = await fetch(`http://127.0.0.1:8000${request.url}`, { method: request.method, headers: { 'content-type': 'application/json', ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) }, ...(bytes.length ? { body: bytes } : {}), signal: AbortSignal.any([networkAbort.signal, AbortSignal.timeout(240000)]) })
        record.status = incoming.status
        response.writeHead(incoming.status, { 'content-type': incoming.headers.get('content-type') ?? 'application/json' })
        if (incoming.body) for await (const chunk of incoming.body) response.write(Buffer.from(chunk))
        response.end()
        await writeFile(join(directory, 'tool-exposure.json'), JSON.stringify({ scope: 'Transparent loopback forwarding; no credentials or payload changes recorded', requests: exposure }, null, 2))
    } catch {
        if (!response.headersSent) response.writeHead(502)
        response.end()
    }
})
await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve))
await writeFile(join(workspace, '.vscode/settings.json'), JSON.stringify({ 'chat.saveBeforeSend': false, 'files.autoSave': 'off', 'scad-ai-ide.languageServer.enabled': false, 'scad-ai-ide.openscadPath': process.env.SCAD_OPENSCAD_EXECUTABLE??'/Users/q/Library/Application Support/Code/User/globalStorage/undefined_publisher.scad-ai-ide/runtimes/darwin-arm64/700816722/bin/openscad', 'omlx.baseUrl': `http://127.0.0.1:${relay.address().port}/v1`, 'omlx.requestTimeoutMs': Number(process.env.SCAD_AGENT_TIMEOUT_MS ?? 240000) }))
await cp(join(repo, 'scripts/fixtures/assembly-native-agent.cjs'), join(observer, 'observer.cjs'))
await writeFile(join(directory, 'native-config.json'), JSON.stringify({ file, ideExtension, manifest,manifestHash,dirtySetup: false, skill: 'skills/openscad-modeling-lifecycle/SKILL.md' }))
await writeFile(join(observer, 'package.json'), JSON.stringify({ publisher: 'local-test', name: 'cad-native-observer', version: '0.0.1', engines: { vscode: '^1.140.0' }, main: './index.cjs', activationEvents: ['onStartupFinished'] }))
await writeFile(join(observer, 'index.cjs'), `exports.activate=context=>{require('./observer.cjs').run(context).catch(e=>require('node:fs').writeFileSync(${JSON.stringify(join(directory, 'observer-error.json'))},JSON.stringify({error:String(e),stack:e.stack})));return {}}`)
const query = `使用 openscad-modeling-lifecycle Skill，检查临时工程 ${pathToFileURL(manifest).href}。1 用scad_ai_ide_model_listParts读取parts和checks并记录manifestDigest；2 用scad_ai_ide_model_checkAssembly(uri,expectedManifestDigest)检查，读取失败issue证据；3 只准用原生replace_string_in_file修改 ${file} 中gap=0.18;为gap=0.30;，允许保存这一个临时SCAD源文件，其他源码保持逐字相同；4 用完全相同的expectedManifestDigest复验全部声明约束，得到新snapshot的PASS；5 对新reportId调用model_measure和model_renderViews(cameras=["iso"],delivery="metadata")。Manifest内容、约束数值、ID、变换和黄金预期绝对不可修改。禁止终端、管理工具和网格修复。最多三轮，两轮无进展即停。最后不超过120字报告结果与reportId/snapshotId和未检查项，然后结束。`

const deadline = Date.now() + 240000
await writeFile(join(directory, 'request-input.json'), JSON.stringify({ query, file, sourceSha256: createHash('sha256').update(source).digest('hex'), scope: 'One real Native Agent attempt; 240 seconds total; only gap geometry edit/save allowed', manifestHash, saveBeforeSend: false, autoSave: 'off' }, null, 2))
console.log(`Phase 3 Native evidence: ${directory}`)
const appRoot = process.platform === 'darwin' ? resolve(dirname(executable), '../Resources/app') : resolve(dirname(executable), 'resources/app')
const nativeLog = await open(join(directory, 'host.log'), 'w', 0o600)
const child = spawn(executable, [join(appRoot, 'out/cli.js'), workspace, `--extensionDevelopmentPath=${ideExtension}`, `--extensionDevelopmentPath=${providerExtension}`, `--extensionDevelopmentPath=${observer}`, '--disable-extensions', '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', nativeLog.fd, nativeLog.fd] })
await nativeLog.close()
child.once('error', (error) => {
    void writeFile(join(directory, 'startup-error.json'), JSON.stringify({ error: String(error) }))
})
child.once('exit', (code, signal) => {
    void writeFile(join(directory, 'startup-exit.json'), JSON.stringify({ code, signal }))
})
const read = async (name) => {
    try {
        return await readFile(join(directory, name), 'utf8')
    } catch {
        return undefined
    }
}
const nativeMessages=async()=>{
 const storage=JSON.parse(await read('observer-storage.json')??'{}').storageUri;if(!storage)return []
 const base=join(dirname(storage),'GitHub.copilot-chat/transcripts'),files=await readdir(base,{recursive:true}).catch(()=>[]),candidates=[]
 for(const name of files.filter(f=>f.endsWith('.jsonl'))){const events=(await readFile(join(base,name),'utf8')).split('\n').flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}}),messages=events.filter(e=>e.type==='assistant.message');if(messages.some(m=>m.data?.toolRequests?.some(t=>t.name==='scad_ai_ide_model_checkAssembly')))candidates.push(messages)}return candidates.at(-1)??[]
}
const approvals=[]
let result
try {
    let ready
    while (Date.now() < deadline) {
        const error = await read('observer-error.json')
        if (error) throw new Error(error)
        const value = await read('ready.json')
        if (value) {
            ready = JSON.parse(value)
            break
        }
        await new Promise((r) => setTimeout(r, 250))
    }
    assert.ok(ready?.models?.length, 'ENV_UNAVAILABLE: F5 oMLX exposed no models')
    const model = ready.models.find((m) => m.id === 'Qwen3.6-35B-A3B-OptiQ-4bit')?.id ?? ready.models[0].id
    const names = ['scad_ai_ide_model_listParts', 'scad_ai_ide_model_checkAssembly', 'scad_ai_ide_model_measure', 'scad_ai_ide_model_getIssue', 'scad_ai_ide_model_renderViews']
    await writeFile(join(directory, 'request.json'), JSON.stringify({ file, query, model, toolsInclude: [...names,'copilot_readFile','copilot_replaceString','copilot_editFiles'] }))
    let response,finalText
    while(Date.now()<deadline){
        const value=await read('response.json')
        if(value){const observed=JSON.parse(value)
          if(observed.result?.type==='confirmation'){
            await writeFile(join(directory,'pending-confirmation.json'),JSON.stringify(observed,null,2))
            const tool=(await nativeMessages()).flatMap(m=>m.data?.toolRequests??[]).findLast(t=>t.name==='replace_string_in_file'),args=tool?(typeof tool.arguments==='string'?JSON.parse(tool.arguments):tool.arguments):undefined
            assert.equal(observed.result.toolId,'copilot_replaceString','EDIT_SCOPE_UNVERIFIED')
            assert.ok(args&&await realpath(args.filePath)===await realpath(file)&&typeof args.oldString==='string'&&typeof args.newString==='string'&&observed.buffer.split(args.oldString).length===2&&observed.buffer.replace(args.oldString,args.newString)===source.replace('gap=0.18;','gap=0.30;'),'EDIT_SCOPE_UNVERIFIED')
            assert.equal(createHash('sha256').update(await readFile(manifest)).digest('hex'),manifestHash)
            assert.equal(approvals.length,0,'Only one exact temporary geometry edit is authorized.')
            const approval={reviewedApproval:true,file,toolId:observed.result.toolId,oldString:args.oldString,newString:args.newString,expectedBufferSha256:createHash('sha256').update(observed.buffer).digest('hex'),authorization:'user-approved-phase3-plan-temp-gap-only'};approvals.push(approval)
            await writeFile(join(directory,'approvals.json'),JSON.stringify(approvals,null,2));await rm(join(directory,'response.json'));await writeFile(join(directory,'request.json'),JSON.stringify(approval))
          }else{response=observed;break}
        }
        const calls=JSON.parse(await read('tool-traces.json')??'[]'),last=calls.filter(t=>t.capability==='cad.checkAssembly'&&t.output?.ok).at(-1)?.output.data
        if(last?.overallStatus==='PASS'){
          const message=(await nativeMessages()).at(-1);if(message?.data?.content&&!message.data.toolRequests?.length){finalText=message.data.content;await writeFile(join(directory,'model-final.txt'),typeof finalText==='string'?finalText:JSON.stringify(finalText));await writeFile(join(directory,'request.json'),JSON.stringify({snapshot:true,file}));for(let i=0;i<30&&!await read('response.json');i++)await new Promise(r=>setTimeout(r,100))}
        }
        await new Promise(r=>setTimeout(r,500))
    }
    const traces = JSON.parse((await read('tool-traces.json')) ?? '[]'),
        find = (id) => traces.find((t) => t.capability === id && t.output?.ok)?.output.data
    const analyses=traces.filter(t=>t.capability==='cad.checkAssembly'&&t.output?.ok).map(t=>({input:t.input,data:t.output.data})),first=analyses[0]?.data,last=analyses.at(-1)?.data,issue=find('cad.issueDetails'),measure=find('cad.modelMeasure'),views=find('cad.modelRenderViews')
    result={scope:'One real Native Agent session, F5 oMLX development bundle; temporary gap edit/save only',ready,model,response,finalText,approvals,analyses,issue,measure,views,manifestHash,pass:false}
    assert.ok(response&&!response.error&&!response.result?.errorDetails,'AGENT_UNCLOSED: no successful completion within 240s')
    assert.notEqual(response.result?.type,'confirmation','AGENT_UNCLOSED: unverified native edit confirmation')
    assert.equal(first?.overallStatus,'FAIL');assert.equal(last?.overallStatus,'PASS');assert.equal(last?.current,true);assert.notEqual(last.snapshotId,first.snapshotId)
    assert.ok(traces.filter(t=>t.capability.startsWith('cad.')).every(t=>t.manifestDiskHash===manifestHash&&t.manifestBufferHash===manifestHash),'Manifest must remain byte-identical for every CAD call')
    assert.ok(analyses.every(a=>a.input.expectedManifestDigest===first.manifestDigest),'Every check must lock the same baseline')
    assert.equal(last.manifestDigest,first.manifestDigest);assert.equal(createHash('sha256').update(await readFile(manifest)).digest('hex'),manifestHash)
    assert.equal(response.manifestDiskHash,manifestHash);assert.equal(response.manifestBufferHash,manifestHash)
    assert.equal(response.buffer,source.replace('gap=0.18;','gap=0.30;'));assert.equal(response.disk,response.buffer);assert.equal(response.dirty,false)
    assert.equal(issue?.reportId,first.reportId);assert.equal(measure?.reportId,last.reportId);assert.equal(views?.reportId,last.reportId);assert.equal(views?.renderStatus,'AVAILABLE');assert.equal(views.frames.length,1)
    assert.ok(names.every(name=>exposure.some(r=>r.tools?.some(t=>t.name===name))),'Provider must receive every actual CAD tool schema')
    result.pass = true
} catch (error) {
    result = { ...result, pass: false, error: String(error), stack: error.stack }
    process.exitCode = 1
} finally {
    await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2))
    await writeFile(join(directory, 'finish'), 'done')
    networkAbort.abort()
    relay.closeAllConnections()
    await new Promise((resolve) => relay.close(resolve))
    console.log(JSON.stringify({ pass: result?.pass, error: result?.error, evidence: directory, attempts: 1 }))
}
