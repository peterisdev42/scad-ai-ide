import http from 'node:http';
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const requests=[];
const evidence=process.env.SCAD_RELAY_EVIDENCE;
if(!evidence)throw new Error('Set SCAD_RELAY_EVIDENCE to a synthetic fixture report path');
const server=http.createServer((req,res)=>{
 if(!['/v1/models','/v1/chat/completions'].includes(req.url)){res.writeHead(404).end();return;}
 const chunks=[];
 req.on('data',chunk=>chunks.push(chunk));
 req.on('end',async()=>{
  const bytes=Buffer.concat(chunks);let body;try{body=JSON.parse(bytes)}catch{}
  const record={at:new Date().toISOString(),method:req.method,path:req.url,bytes:bytes.length,model:body?.model,toolChoice:body?.tool_choice,maxTokens:body?.max_tokens,tools:body?.tools?.map(tool=>({name:tool.function?.name,schemaSha256:createHash('sha256').update(JSON.stringify(tool.function?.parameters??{})).digest('hex')})),messageCount:body?.messages?.length};
  requests.push(record);await writeFile(evidence,JSON.stringify({scope:'Transparent HTTP transport observation, no prompt/result/tool/confirmation changes; no credentials or messages recorded',requests},null,2)+'\n');
  const upstream=http.request({hostname:'127.0.0.1',port:8000,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:8000'}},incoming=>{record.status=incoming.statusCode;res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);incoming.on('end',()=>writeFile(evidence,JSON.stringify({scope:'Transparent HTTP transport observation; no payload changes',requests},null,2)+'\n'));});
  upstream.on('error',()=>{res.writeHead(502).end();});upstream.end(bytes);
 });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const child=spawn(process.execPath,['scripts/customizer-native-agent.mjs'],{env:{...process.env,SCAD_AGENT_OMLX_URL:`http://127.0.0.1:${server.address().port}/v1`},stdio:'inherit'});
const result=await new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
server.closeAllConnections();server.close();
process.exitCode=result.code??1;
