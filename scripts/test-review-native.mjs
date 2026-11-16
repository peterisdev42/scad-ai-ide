import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile as rawWriteFile, rename, open, cp, readdir, rm, realpath } from 'node:fs/promises'
import { createHash,randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

// This is the existing F5 development profile: credentials remain in the provider's SecretStorage.
// No token extraction, account migration, model response fabrication, or protected SourceApply approval.
const writeFile=async(file,content,options)=>{const temp=file+'.'+randomUUID()+'.tmp';await rawWriteFile(temp,content,options??{mode:0o600});await rename(temp,file)}
const scenario=process.argv[2]??'comparison';assert.ok(['comparison','feedback'].includes(scenario))
const repo = fileURLToPath(new URL('../', import.meta.url))
const executable = process.env.SCAD_VSCODE_EXECUTABLE ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code'
const staged = JSON.parse(await readFile(join(repo, '.build/omlx-dev/host.json'), 'utf8'))
const directory = await mkdtemp(join(tmpdir(), 'review-'+scenario+'-f5-'))
const workspace = join(directory, 'workspace'),
    observer = join(directory, 'observer'),
    file = join(workspace, 'model.scad'), manifest=join(workspace,'.scad/verification.json')
await mkdir(join(workspace, '.vscode'), { recursive: true })
await mkdir(observer)
await mkdir(join(workspace,'.scad'),{recursive:true})
const source='part="body";\nhole=2;\nif(part=="body") difference(){cube([20,20,5]);translate([10,10,-1])cylinder(h=7,r=hole,$fn=32);}\nelse if(part=="shell")translate([30,0,0])cube([10,10,5]);\n'
const baseline={schemaVersion:1,units:'mm',entry:'./model.scad',parts:['body','shell'].map(id=>({id,selector:{type:'define',name:'part',value:id}})),checks:[{id:'body-bounds',type:'bounds',part:'body',minDimensions:[19.9999,19.9999,4.9999],maxDimensions:[20.0001,20.0001,5.0001]},{id:'body-volume',type:'volume',part:'body',min:1800,max:2000},{id:'shell-volume',type:'volume',part:'shell',min:499.99,max:500.01}]}
const profile=join(workspace,'.scad/print-profile.json'),profileText=JSON.stringify({schemaVersion:1,units:'mm',process:'fdm',buildVolumeMm:[200,200,200],buildPose:{rotate:[0,0,0],translate:[0,0,0]},maxOverhangFromVerticalDeg:45}),profileHash=createHash('sha256').update(profileText).digest('hex');await writeFile(profile,profileText)
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
await cp(join(repo, 'scripts/fixtures/review-native-agent.cjs'), join(observer, 'observer.cjs'))
await writeFile(join(directory, 'native-config.json'), JSON.stringify({file,ideExtension,manifest,manifestHash,profile,profileHash,scenario,dirtySetup:false,skill:scenario==='comparison'?'skills/openscad-design-review/SKILL.md':'skills/openscad-spatial-feedback/SKILL.md'}))
await writeFile(join(observer, 'package.json'), JSON.stringify({ publisher: 'local-test', name: 'cad-native-observer', version: '0.0.1', engines: { vscode: '^1.140.0' }, main: './index.cjs', activationEvents: ['onStartupFinished'] }))
await writeFile(join(observer, 'index.cjs'), `exports.activate=context=>{require('./observer.cjs').run(context).catch(e=>require('node:fs').writeFileSync(${JSON.stringify(join(directory, 'observer-error.json'))},JSON.stringify({error:String(e),stack:e.stack})));return {}}`)
const queryFor=setup=>scenario==='comparison'?`在未打开 Preview 的情况下检查临时模型 ${pathToFileURL(file).href}。只使用原生 CAD Tools：先 model_analyze(mode="verify",units="mm")获得当前 targetReportId；用 model_compare 对比基线 ${setup.baselineReportId} 与 targetReportId；再 model_checkPrintability(targetReportId,profileUri="${pathToFileURL(profile).href}")。允许读取文件和 getIssue/measure；禁止编辑任何源文件、Manifest 或打印 profile。总结变化、单位、未决项、printability NOT_CHECKED 和两个 report/snapshot。不要调用任何终端。`:`处理临时装配 ${pathToFileURL(manifest).href} 的空间反馈。固定 manifestDigest=${setup.manifestDigest}，原始 reportId=${setup.baselineReportId}。先读取 getFeedback；再 model_requestPointing(reportId="${setup.baselineReportId}",prompt="请在 body 零件孔口表面点击，填写将孔半径从2改为3，然后点击保存并发送位置。",ttl=180)，等待真人提交，禁止自动点击/伪造坐标或绕过确认。只有收到 ACCEPTED，才允许用原生 replace_string_in_file 把 ${file} 的 hole=2; 改为 hole=3;，允许保存这一个临时SCAD。其他源码逐字不变，Manifest/profile/ID/变换/阈值不能修改。用 model_checkAssembly(uri,expectedManifestDigest="${setup.manifestDigest}")复验全部必需约束；用 model_compare(baselineReportId="${setup.baselineReportId}",targetReportId=新报告,expectUnchangedPartIds=["shell"])证明独立shell整体未变。最后读取 getFeedback，说明旧批注已stale，不声称局部未变证明或打印成功。最多三轮，无进展即停，不用终端。`

const deadline = Date.now() + 240000
await writeFile(join(directory, 'request-input.json'), JSON.stringify({ scenario,file, sourceSha256: createHash('sha256').update(source).digest('hex'), scope:'One real Native Agent attempt per scenario, 240 seconds; human interaction is never simulated', manifestHash, saveBeforeSend: false, autoSave: 'off' }, null, 2))
console.log(`Phase 4 Native ${scenario} evidence: ${directory}`)
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
 for(const name of files.filter(f=>f.endsWith('.jsonl'))){const events=(await readFile(join(base,name),'utf8')).split('\n').flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}}),messages=events.filter(e=>e.type==='assistant.message');if(messages.some(m=>m.data?.toolRequests?.some(t=>/scad_ai_ide_model_/.test(t.name))))candidates.push(messages)}return candidates.at(-1)??[]
}
const approvals=[];let humanNotified=false
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
    const names=scenario==='comparison'?['scad_ai_ide_model_analyze','scad_ai_ide_model_compare','scad_ai_ide_model_checkPrintability','scad_ai_ide_model_getIssue','scad_ai_ide_model_measure']:['scad_ai_ide_model_getFeedback','scad_ai_ide_model_requestPointing','scad_ai_ide_model_checkAssembly','scad_ai_ide_model_compare','scad_ai_ide_model_getIssue']
    const query=queryFor(ready.setup);await writeFile(join(directory,'query.txt'),query)
    await writeFile(join(directory, 'request.json'), JSON.stringify({ file, query, model, toolsInclude:[...names,'copilot_readFile',...(scenario==='feedback'?['copilot_replaceString','copilot_editFiles']:[])] }))
    let response,finalText
    while(Date.now()<deadline){
        const value=await read('response.json')
        if(value){const observed=JSON.parse(value)
          if(observed.result?.type==='confirmation'&&scenario==='feedback'&&observed.result.toolId!=='copilot_replaceString'){if(!humanNotified){humanNotified=true;console.log('HUMAN_ACTION_REQUIRED: accept the CAD pointing tool in this temporary VS Code chat, then select body hole surface and submit.');await writeFile(join(directory,'human-needed.json'),JSON.stringify({scenario,toolId:observed.result.toolId,kind:'native-confirmation'}))}await rm(join(directory,'response.json'));continue}
          if(observed.result?.type==='confirmation'){
            await writeFile(join(directory,'pending-confirmation.json'),JSON.stringify(observed,null,2))
            const tool=(await nativeMessages()).flatMap(m=>m.data?.toolRequests??[]).findLast(t=>t.name==='replace_string_in_file'),args=tool?(typeof tool.arguments==='string'?JSON.parse(tool.arguments):tool.arguments):undefined
            assert.equal(observed.result.toolId,'copilot_replaceString','EDIT_SCOPE_UNVERIFIED')
            assert.ok(args&&await realpath(args.filePath)===await realpath(file)&&typeof args.oldString==='string'&&typeof args.newString==='string'&&observed.buffer.split(args.oldString).length===2&&observed.buffer.replace(args.oldString,args.newString)===source.replace('hole=2;','hole=3;'),'EDIT_SCOPE_UNVERIFIED')
            assert.equal(createHash('sha256').update(await readFile(manifest)).digest('hex'),manifestHash)
            assert.equal(approvals.length,0,'Only one exact temporary geometry edit is authorized.')
            const approval={reviewedApproval:true,file,toolId:observed.result.toolId,oldString:args.oldString,newString:args.newString,expectedBufferSha256:createHash('sha256').update(observed.buffer).digest('hex'),authorization:'user-approved-phase4-plan-temp-hole-only'};approvals.push(approval)
            await writeFile(join(directory,'approvals.json'),JSON.stringify(approvals,null,2));await rm(join(directory,'response.json'));await writeFile(join(directory,'request.json'),JSON.stringify(approval))
          }else{response=observed;break}
        }
        const calls=JSON.parse(await read('tool-traces.json')??'[]'),last=calls.findLast(t=>t.capability==='cad.compare'&&t.output?.ok)?.output.data
        if(scenario==='feedback'&&!humanNotified&&calls.some(t=>t.capability==='cad.requestPointing')){humanNotified=true;console.log('HUMAN_ACTION_REQUIRED: click the body hole surface in the frozen CAD Evidence view, then save and send.');await writeFile(join(directory,'human-needed.json'),JSON.stringify({scenario,kind:'frozen-surface-point'}))}
        if(last){const message=(await nativeMessages()).at(-1);if(message?.data?.content&&!message.data.toolRequests?.length){finalText=message.data.content;await writeFile(join(directory,'model-final.txt'),typeof finalText==='string'?finalText:JSON.stringify(finalText));await writeFile(join(directory,'request.json'),JSON.stringify({snapshot:true,file}));for(let i=0;i<30&&!await read('response.json');i++)await new Promise(r=>setTimeout(r,100))}}
        await new Promise(r=>setTimeout(r,500))
    }
    const traces = JSON.parse((await read('tool-traces.json')) ?? '[]'),
        find = (id) => traces.find((t) => t.capability === id && t.output?.ok)?.output.data
    const compared=find('cad.compare'),print=find('cad.checkPrintability'),point=find('cad.requestPointing'),checked=find('cad.checkAssembly'),target=find('cad.modelAnalyze')
    result={scenario,scope:'One real Native Agent session; graphical pointing only by an actual human',ready,model,response,finalText,approvals,compared,print,point,checked,target,manifestHash,profileHash,pass:false}
    assert.ok(response&&!response.error&&!response.result?.errorDetails,'AGENT_UNCLOSED: no successful completion within 240 seconds')
    assert.ok(compared&&compared.baselineReportId===ready.setup.baselineReportId&&compared.current.target,'DIFF_FLOW_UNCLOSED')
    assert.notEqual(compared.targetSnapshotId,compared.baselineSnapshotId)
    assert.equal(compared.regressionStatus,'NO_REGRESSIONS_FOUND')
    assert.ok(traces.filter(t=>t.capability.startsWith('cad.')).every(t=>t.manifestDiskHash===manifestHash&&t.manifestBufferHash===manifestHash&&t.profileDiskHash===profileHash),'Manifest and profile must stay byte-identical')
    assert.equal(createHash('sha256').update(await readFile(manifest)).digest('hex'),manifestHash);assert.equal(createHash('sha256').update(await readFile(profile)).digest('hex'),profileHash)
    if(scenario==='comparison'){assert.equal(print?.printability,'NOT_CHECKED');assert.equal(print?.sourceReportId,target?.reportId);assert.equal(compared.targetReportId,target?.reportId);assert.equal(response.disk,source.replace('hole=2;','hole=3;'))}
    else{assert.equal(point?.status,'ACCEPTED');assert.equal(point.feedback.anchor.partId,'body');assert.equal(checked?.overallStatus,'PASS');assert.equal(checked?.manifestDigest,ready.setup.manifestDigest);assert.ok(compared.items.some(r=>r.partId==='shell'&&r.protected&&r.status==='unchanged'));assert.equal(response.buffer,source.replace('hole=2;','hole=3;'));assert.equal(response.disk,response.buffer);assert.equal(response.dirty,false)}
    const required=scenario==='comparison'?['scad_ai_ide_model_analyze','scad_ai_ide_model_compare','scad_ai_ide_model_checkPrintability']:['scad_ai_ide_model_getFeedback','scad_ai_ide_model_requestPointing','scad_ai_ide_model_checkAssembly','scad_ai_ide_model_compare'];assert.ok(required.every(name=>exposure.some(r=>r.tools?.some(t=>t.name===name))),'Provider must receive actual required tool schemas')
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
