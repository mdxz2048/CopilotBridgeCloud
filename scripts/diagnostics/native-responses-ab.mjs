// External, bounded diagnostic driver. Never installed in the production gateway.
// No model-generated command is executed; tool implementations below are fixed.
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const VERSION='0.3.3';
const CASES=['N','W','C','T'];
const SYNTHETIC='合成🧪\n"quoted" \\ literal \\u4e2d\tend';
const GOOD_CODE='export function add(a, b) { return a + b; }\n';
const BAD_CODE='export function add(a, b) { return a - b; }\n';
const bytes=value=>Buffer.byteLength((typeof value==='string'?value:JSON.stringify(value))??'');
const safeCode=error=>typeof error?.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'DIAGNOSTIC_FAILED';
const fail=code=>{throw Object.assign(new Error(code),{code});};
async function cleanupTemporary(path){const target=resolve(path);if(dirname(target)!==resolve(tmpdir())||!target.split(/[\\/]/).at(-1).startsWith('bridge-native-ab-'))fail('UNSAFE_TEMP_CLEANUP');await rm(target,{recursive:true,force:true});}

export function requestShape(value,path='',result={}) {
  if(Object.keys(result).length>=800)return result;
  const type=Array.isArray(value)?'array':value===null?'null':typeof value;
  result[path||'/']={type,bytes:bytes(value)};
  if(value&&typeof value==='object')for(const [key,child] of Object.entries(value))requestShape(child,`${path}/${key.replaceAll('~','~0').replaceAll('/','~1')}`,result);
  return result;
}
export function shapeDiff(before,after) {
  const a=requestShape(before),b=requestShape(after);
  return [...new Set([...Object.keys(a),...Object.keys(b)])].filter(path=>JSON.stringify(a[path])!==JSON.stringify(b[path])).map(path=>({path,before:a[path]??null,after:b[path]??null}));
}
function crc32(buffer) {
  let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;
}
// Standard stored ZIP entries: real synthetic .docx, without an external ZIP executable.
export function syntheticDocx(marker) {
  const text=`Synthetic quiz marker ${marker}. Question one: 7 + 8. Question two: 9 * 6.`;
  const files={
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`};
  const local=[],central=[];let offset=0;
  for(const [filename,content] of Object.entries(files)){
    const name=Buffer.from(filename),data=Buffer.from(content),crc=crc32(data),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    local.push(header,name,data);const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);central.push(entry,name);offset+=header.length+name.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
export function readFixedDocx(buffer) {
  let offset=0;while(buffer.readUInt32LE(offset)===0x04034b50){
    const method=buffer.readUInt16LE(offset+8),length=buffer.readUInt32LE(offset+18),nameLength=buffer.readUInt16LE(offset+26),extra=buffer.readUInt16LE(offset+28);
    const name=buffer.subarray(offset+30,offset+30+nameLength).toString(),start=offset+30+nameLength+extra;
    if(name==='word/document.xml'){if(method!==0)fail('FIXTURE_ZIP_UNSUPPORTED');return buffer.subarray(start,start+length).toString().replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();}offset=start+length;
  }fail('FIXTURE_DOCX_MISSING');
}
export function budgetUpperBound(request,rate) {
  if(!rate||!['input','output'].every(key=>Number.isFinite(rate[key])&&rate[key]>=0)||[rate.reasoning??rate.output,rate.toolRmb??0,rate.minimumRmb??0].some(value=>!Number.isFinite(value)||value<0))fail('BLOCKED_BUDGET_RATE_UNVERIFIED');
  const input=bytes(request)+512,output=Math.max(rate.output,rate.reasoning??rate.output);
  return Math.ceil(Math.max(rate.minimumRmb??0,input*rate.input/1e6+(request.max_output_tokens??1024)*output/1e6+(request.tools?.length?(request.max_output_tokens??1024)*(rate.toolRmb??0):0)+.0001)*10000)/10000;
}
async function consumeSse(response,metrics={}) {
  if(!response.body)fail('STREAM_BODY_MISSING');const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';const events=[];const start=performance.now();
  function parse(block){const text=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!text||text==='[DONE]')return;const event=JSON.parse(text);events.push(event);metrics.firstEventMs??=Math.round(performance.now()-start);if(event.type==='response.output_text.delta')metrics.ttftMs??=Math.round(performance.now()-start);if(event.type==='response.reasoning_text.delta')metrics.firstReasoningMs??=Math.round(performance.now()-start);if(['function_call','custom_tool_call'].includes(event.item?.type))metrics.firstToolMs??=Math.round(performance.now()-start);}
  try {for(;;){const part=await reader.read();metrics.responseBytes=(metrics.responseBytes??0)+(part.value?.byteLength??0);pending+=decoder.decode(part.value,{stream:!part.done});let boundary;while((boundary=/\r?\n\r?\n/.exec(pending))){parse(pending.slice(0,boundary.index));pending=pending.slice(boundary.index+boundary[0].length);}if(part.done)break;}if(pending.trim())parse(pending);}
  finally{reader.releaseLock();}metrics.streamMs=Math.round(performance.now()-start);metrics.eventCount=events.length;return events;
}
function terminal(events){return events.find(event=>['response.completed','response.failed','response.incomplete'].includes(event.type))?.response;}
function answer(response){return (response.output??[]).filter(item=>item.type==='message').flatMap(item=>item.content??[]).map(part=>part.text??'').join('');}
function fixedFunction(name,description,properties={}){return {type:'function',name,description,strict:true,parameters:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}};}
async function credentials() {
  let email=process.env.BRIDGE_AB_EMAIL,password=process.env.BRIDGE_AB_PASSWORD;
  if((!email||!password)&&process.env.BRIDGE_AB_CREDENTIALS_FILE){const text=await readFile(process.env.BRIDGE_AB_CREDENTIALS_FILE,'utf8');try{const data=JSON.parse(text);email??=data.email;password??=data.password;}catch{email??=text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];password??=text.match(/密码[：:]\s*(.+)/)?.[1]?.trim();}}
  if(!email||!password)fail('BLOCKED_PRIVATE_CREDENTIALS_MISSING');return {email,password};
}
async function loadApp() {
  const root=resolve(process.env.BRIDGE_APP_ROOT??join(dirname(fileURLToPath(import.meta.url)),'../../..','copilot-bridge-app'));
  const load=name=>import(pathToFileURL(join(root,'dist-electron/cloud',name)).href);
  return Object.assign({},...await Promise.all(['http-cloud-client.js','remote-bridge-server.js','device-identity.js','device-proof.js','token-store.js'].map(load)));
}
export async function runCase({app,client,model,mode,test,fixture,budget,report}) {
  const row={profile:model.capabilities.responsesProfile,model:model.id,mode,case:test,status:'RUNNING',requests:[],localRequests:[],fixedToolExecutions:0,officialDesktop:'NOT_VERIFIED_EXTERNAL_DRIVER'};report.matrix.push(row);
  const thread=randomUUID(),key=randomUUID(),observations=[];let activeDesktop,activeCall;const originalFetch=globalThis.fetch;
  const cloud={getMe:()=>client.getMe(),listModels:()=>client.listModels(),createResponse:async(request,options)=>{
    if(row.requests.length>=5)fail('CASE_POST_LIMIT');const upper=budgetUpperBound(request,budget.rates[model.id]);const me=await client.getMeV2();
    const available=me.billing?.remainingRmb??(me.wallet.balance/10000);if(upper>budget.maxRmb-budget.actualRmb||upper>available)fail('BLOCKED_BUDGET_OR_BALANCE');
    const call={traceId:options.traceId,threadId:options.threadId,requestBytes:bytes(request),shapeDiff:shapeDiff(activeDesktop,request),budgetUpperRmb:upper,actualPostCount:0};row.requests.push(call);activeCall=call;const started=performance.now();
    const transport=await client.createResponse(request,options);call.httpStatus=transport.response.status;call.headersMs=Math.round(performance.now()-started);call.requestId=transport.response.headers.get('X-Bridge-AI-Request-Id');
    if(!transport.response.ok){const error=await transport.response.json().catch(()=>({}));call.errorCode=safeCode(error.error);fail(call.errorCode);}
    const [relay,observe]=transport.response.body.tee();const observation=(async()=>{
      const events=await consumeSse(new Response(observe),call);const result=terminal(events);call.totalMs=Math.round(performance.now()-started);call.responseId=result?.id;call.status=result?.status;call.eventTypes=[...new Set(events.map(event=>event.type))];
      for(const name of ['firstEventMs','firstReasoningMs','ttftMs','firstToolMs'])call[name]=call[name]===undefined?null:call[name]+call.headersMs;
      const settlement=call.requestId?await client.getUsageByRequest(call.requestId):await client.getUsageByResponse(result.id);call.billingStatus=settlement.usage?.billingStatus;call.pointsCharged=settlement.usage?.pointsCharged;call.costRmb=typeof call.pointsCharged==='number'?call.pointsCharged/10000:null;call.supplierCostKnown=false;
      if(call.billingStatus!=='SETTLED'||call.costRmb===null)fail('BILLING_NOT_SETTLED');budget.actualRmb+=call.costRmb;if(budget.actualRmb>budget.maxRmb)fail('BUDGET_EXCEEDED');
    })();observation.catch(()=>{});observations.push(observation);return {...transport,response:new Response(relay,{status:transport.response.status,headers:transport.response.headers})};
  }};
  const trace={write(stage,traceId,metadata){row.bridgeStages??=[];row.bridgeStages.push({stage,traceId,metrics:Object.fromEntries(Object.entries(metadata).filter(([,value])=>typeof value==='number'||typeof value==='boolean'))});}};
  const bridge=new app.RemoteBridgeServer(cloud,0,undefined,undefined,undefined,{getApiKey:async()=>key,getModel:async()=>model.id,getReasoning:async()=>mode,trace});
  // Detect and block an automatic auth retry before it sends a second Responses POST.
  budget.currentPost=()=>activeCall;
  try {
    const status=await bridge.start();if(status.state!=='ready')fail('LOCAL_BRIDGE_NOT_READY');
    const base={model:model.id,stream:true,max_output_tokens:1024,parallel_tool_calls:false,reasoning:{mode}};
    const send=async body=>{activeDesktop=body;const metrics={requestBytes:bytes(body)};row.localRequests.push(metrics);const start=performance.now();const response=await originalFetch(`${status.endpoint}/v1/responses`,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json',session_id:thread},body:JSON.stringify(body)});metrics.headersMs=Math.round(performance.now()-start);metrics.httpStatus=response.status;if(!response.ok){const error=await response.json().catch(()=>({}));fail(safeCode(error.error));}const events=await consumeSse(response,metrics);for(const name of ['firstEventMs','firstReasoningMs','ttftMs','firstToolMs'])metrics[name]=metrics[name]===undefined?null:metrics[name]+metrics.headersMs;metrics.totalMs=Math.round(performance.now()-start);await Promise.all(observations);const result=terminal(events);if(result?.status!=='completed')fail('RESPONSE_NOT_COMPLETED');return {result,events};};
    if(test==='N'){
      const {result}=await send({...base,input:[{role:'user',content:'Calculate 7 + 8 and 9 * 6. Reply with just the two numbers.'}]});row.correctness=/\b15\b/.test(answer(result))&&/\b54\b/.test(answer(result));
    }else if(test==='T'){
      const tools=[{type:'namespace',name:'functions',tools:[{type:'custom',name:'exec',description:'Fixed synthetic tool; its input is text, not executable code. Its result contains a hidden marker.'}]}];
      const first=await send({...base,tools,input:[{role:'user',content:`Call functions.exec once with this synthetic text. Wait for the result, then repeat its hidden marker. Text: ${SYNTHETIC}`}]});const calls=first.result.output.filter(item=>item.type==='custom_tool_call');if(calls.length!==1||calls[0].name!=='exec'||typeof calls[0].input!=='string')fail('UNEXPECTED_TOOL');
      const call=calls[0],deltas=first.events.filter(event=>event.type==='response.custom_tool_call_input.delta').map(event=>event.delta??'').join('');row.toolInputDeltaMatches=deltas===call.input;row.toolInputDoneMatches=first.events.some(event=>event.type==='response.custom_tool_call_input.done'&&event.input===call.input);row.inputFixtureExact=call.input===SYNTHETIC;row.fixedToolExecutions++;
      const second=await send({...base,tools,previous_response_id:first.result.id,input:[{type:'custom_tool_call_output',call_id:call.call_id,output:fixture.marker}]});row.correctness=answer(second.result).includes(fixture.marker)&&row.toolInputDeltaMatches&&row.toolInputDoneMatches;
    }else if(test==='W'){
      const tools=[fixedFunction('read_word_quiz','Read the provided synthetic Word document with its hidden marker and two quiz questions.')];
      const first=await send({...base,tools,input:[{role:'user',content:'Read the provided Word quiz with read_word_quiz. Answer both questions and include its hidden marker. Read it first.'}]});const calls=first.result.output.filter(item=>item.type==='function_call');if(calls.length!==1||calls[0].name!=='read_word_quiz'||Object.keys(JSON.parse(calls[0].arguments)).length)fail('UNEXPECTED_TOOL');
      const text=readFixedDocx(await readFile(fixture.docx));row.fixedToolExecutions++;const second=await send({...base,tools,previous_response_id:first.result.id,input:[{type:'function_call_output',call_id:calls[0].call_id,output:text}]});row.correctness=answer(second.result).includes(fixture.marker)&&/\b15\b/.test(answer(second.result))&&/\b54\b/.test(answer(second.result));row.realSyntheticDocxRead=true;
    }else {
      const tools=[fixedFunction('read_code','Read a fixed synthetic add function and its failing tests.'),fixedFunction('repair_code','Replace the source with exactly: export function add(a, b) { return a + b; } followed by one newline. Only that exact patch is allowed.',{source:{type:'string'}})];
      const first=await send({...base,tools,input:[{role:'user',content:'Read the synthetic code with read_code, fix its arithmetic bug using repair_code, then report the tests and returned hidden marker. Read before repairing.'}]});const readCalls=first.result.output.filter(item=>item.type==='function_call');if(readCalls.length!==1||readCalls[0].name!=='read_code'||Object.keys(JSON.parse(readCalls[0].arguments)).length)fail('UNEXPECTED_TOOL');row.fixedToolExecutions++;
      const second=await send({...base,tools,previous_response_id:first.result.id,input:[{type:'function_call_output',call_id:readCalls[0].call_id,output:JSON.stringify({source:BAD_CODE,tests:[{args:[7,8],expected:15},{args:[9,6],expected:15}],instruction:'repair_code accepts only its documented exact source'})}]});const patchCalls=second.result.output.filter(item=>item.type==='function_call');if(patchCalls.length!==1||patchCalls[0].name!=='repair_code')fail('UNEXPECTED_TOOL');const patch=JSON.parse(patchCalls[0].arguments);if(patch.source!==GOOD_CODE||Object.keys(patch).length!==1)fail('FIXED_PATCH_WHITELIST_REJECTED');
      // Execute our fixed trusted implementation, never the provider's source or command.
      await writeFile(fixture.code,GOOD_CODE);const fixedAdd=(a,b)=>a+b;assert.equal(fixedAdd(7,8),15);assert.equal(fixedAdd(9,6),15);row.fixedTestsPassed=2;row.fixedToolExecutions++;
      const third=await send({...base,tools,previous_response_id:second.result.id,input:[{type:'function_call_output',call_id:patchCalls[0].call_id,output:`Fixed patch applied. 2 tests passed. Marker ${fixture.marker}`}]});row.correctness=answer(third.result).includes(fixture.marker);row.patchWhitelisted=true;
    }
    row.noAutomaticRetries=row.requests.every(call=>call.actualPostCount===1);row.status=row.correctness&&row.noAutomaticRetries?'PASS':'FAIL_CORRECTNESS';
  }catch(error){row.status=safeCode(error);}
  finally {await Promise.allSettled(observations);await bridge.stop();budget.currentPost=null;row.totalPoints=row.requests.reduce((sum,call)=>sum+(call.pointsCharged??0),0);row.totalRmb=row.totalPoints/10000;}
  return row;
}

async function main() {
  const chosen=(process.env.BRIDGE_AB_CASES??'N,W,C,T').split(',');if(chosen.some(test=>!CASES.includes(test)))fail('INVALID_CASE_FILTER');
  const modes=(process.env.BRIDGE_AB_MODES??'normal,thinking').split(',');if(modes.some(mode=>!['normal','thinking'].includes(mode)))fail('INVALID_MODE_FILTER');
  const maxRmb=Number(process.env.AB_MAX_RMB??'.03');if(!Number.isFinite(maxRmb)||maxRmb<=0||maxRmb>1)fail('INVALID_BUDGET');
  const report={date:new Date().toISOString(),appVersion:VERSION,scope:'EXTERNAL_FIXED_DIAGNOSTIC_NOT_PRODUCTION_HARNESS',paidEnabled:process.env.BRIDGE_AB_RUN==='1',supplierCostKnown:false,maxRmb,matrix:[],actualPostCount:0,totalPoints:0};
  const output=resolve(process.env.BRIDGE_AB_OUTPUT??'outputs/native-responses-ab.json');let client,login,temporary;const secrets=new Map();
  const save=async()=>{report.actualPostCount=report.matrix.reduce((sum,row)=>sum+(row.requests??[]).reduce((n,call)=>n+(call.actualPostCount??0),0),0);report.totalPoints=report.matrix.reduce((sum,row)=>sum+(row.totalPoints??0),0);report.totalRmb=report.totalPoints/10000;await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({paidEnabled:report.paidEnabled,actualPostCount:report.actualPostCount,totalRmb:report.totalRmb,matrix:report.matrix.map(({profile,model,mode,case:test,status})=>({profile,model,mode,case:test,status}))},null,2));};
  if(!report.paidEnabled){for(const profile of ['deepseek','openai'])for(const mode of modes)for(const test of chosen)report.matrix.push({profile,mode,case:test,status:profile==='openai'?'BLOCKED_NO_GPT_CONNECTION_NOT_CHECKED':'UNPAID_NOT_RUN'});await save();return;}
  const baseUrl=(process.env.BRIDGE_AB_BASE_URL??'https://ai.mddxz.top').replace(/\/$/,'');const budget={maxRmb,actualRmb:0,rates:JSON.parse(process.env.BRIDGE_AB_RATE_CNY_PER_MILLION_JSON??'{}'),currentPost:null};
  try {
    const config=await(await fetch(`${baseUrl}/api/v1/client/config`)).json();if(config.minimumVersion!==VERSION||config.latestVersion!==VERSION)fail('BLOCKED_RELEASE_NOT_CURRENT');
    const app=await loadApp(),creds=await credentials();temporary=await mkdtemp(join(tmpdir(),'bridge-native-ab-'));
    const store={read:async key=>secrets.get(key)??null,write:async(key,value)=>{secrets.set(key,value);},delete:async key=>{secrets.delete(key);}};
    const devices=new app.DeviceIdentityStore(join(temporary,'device.json'),VERSION);const originalFetch=globalThis.fetch;
    client=new app.HttpCloudClient({baseUrl,devices,tokens:new app.CloudTokenSession(new app.WindowsCredentialManagerTokenStore(store)),deviceKeys:new app.DeviceKeyStore(store,'native-ab-fixed-driver'),timeoutMs:240000,fetch:async(url,options)=>{
      if(String(url)===`${baseUrl}/v1/responses`&&options?.method==='POST'){const call=budget.currentPost?.();if(!call)fail('UNTRACKED_POST_BLOCKED');if(call.actualPostCount)fail('UNEXPECTED_POST_RETRY_BLOCKED');call.actualPostCount++;}return originalFetch(url,options);
    }});
    login=await client.login({...creds,device:{...await devices.get(),deviceName:'Temporary native Responses A/B diagnostic'}});
    const modelList=(await client.listModels()).data.filter(model=>model.capabilities.nativeResponses===true);const selected=process.env.BRIDGE_AB_MODELS?.split(',');
    // Inventory blocked profiles before any paid case, so a later failure cannot hide missing GPT.
    for(const profile of ['deepseek','openai'])if(!modelList.some(model=>model.capabilities.responsesProfile===profile&&(!selected||selected.includes(model.id))))for(const mode of modes)for(const test of chosen)report.matrix.push({profile,mode,case:test,status:profile==='openai'?'BLOCKED_NO_GPT_CONNECTION':'BLOCKED_NO_NATIVE_DEEPSEEK_MODEL'});
    const marker=`AB_FIXED_${randomUUID().replaceAll('-','').slice(0,12)}`,docx=join(temporary,'synthetic-quiz.docx');await writeFile(docx,syntheticDocx(marker));
    const fixture={marker,docx,code:join(temporary,'fixed-add.mjs')};
    for(const profile of ['deepseek','openai']){
      const models=modelList.filter(model=>model.capabilities.responsesProfile===profile&&(!selected||selected.includes(model.id)));
      if(!models.length)continue;
      for(const model of models)for(const mode of modes)for(const test of chosen){
        const blocked=mode==='thinking'&&!model.capabilities.reasoningModes?.includes('thinking')?'BLOCKED_REASONING_CAPABILITY':test!=='N'&&!model.capabilities.tools?'BLOCKED_TOOL_CAPABILITY':!budget.rates[model.id]?'BLOCKED_BUDGET_RATE_UNVERIFIED':null;
        if(blocked){report.matrix.push({profile,model:model.id,mode,case:test,status:blocked});continue;}
        const row=await runCase({app,client,model,mode,test,fixture,budget,report});if(row.status!=='PASS'){report.stoppedAfterFailure=true;fail('CASE_FAILED_STOP');}
      }
    }
  }catch(error){report.errorCode=safeCode(error);process.exitCode=1;}
  finally {if(login){try{await client.revokeDevice(login.device.id);report.testDeviceRevoked=true;}catch{report.testDeviceRevoked=false;process.exitCode=1;}try{await client.logout();}catch{}}secrets.clear();if(temporary)await cleanupTemporary(temporary);await save();}
}
if(process.argv.includes('--mock-bridge-test')){
  const app=await loadApp(),temporary=await mkdtemp(join(tmpdir(),'bridge-native-ab-')),marker='AB_FIXED_MOCK';
  try {
    const docx=join(temporary,'synthetic-quiz.docx');await writeFile(docx,syntheticDocx(marker));
    const model={id:'deepseek/mock-fixed',object:'model',owned_by:'MOCK',capabilities:{responsesProfile:'deepseek',nativeResponses:true,tools:true,vision:false,reasoning:true,streaming:true,reasoningModes:['normal','thinking','auto']}};
    for(const mode of ['normal','thinking']){
      const budget={maxRmb:.03,actualRmb:0,rates:{[model.id]:{input:1,output:2}},currentPost:null},report={matrix:[]};let posts=0;
      const client={getMe:async()=>({id:'mock-account'}),getMeV2:async()=>({billing:{remainingRmb:1}}),listModels:async()=>({object:'list',data:[model]}),getUsageByRequest:async()=>({usage:{billingStatus:'SETTLED',pointsCharged:0}}),createResponse:async()=>{
        posts++;budget.currentPost().actualPostCount++;const id=`resp_mock_${posts}`,call={type:'function_call',id:'fc_mock',name:'read_word_quiz',call_id:'call_mock',arguments:'{}'},reasoning={type:'reasoning',id:'rs_mock',content:[{type:'reasoning_text',text:'synthetic mock reasoning'}]};
        const output=posts===1?[...(mode==='thinking'?[reasoning]:[]),call]:[{type:'message',id:'msg_mock',role:'assistant',content:[{type:'output_text',text:`${marker} 15 54`}]}];
        const response={id,object:'response',status:'completed',model:model.id,output,usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
        const events=[{type:'response.created',response:{...response,output:[]}}];if(mode==='thinking'&&posts===1)events.push({type:'response.reasoning_text.delta',delta:'synthetic mock reasoning'});
        if(posts===1)events.push({type:'response.output_item.added',output_index:mode==='thinking'?1:0,item:{...call,arguments:''}},{type:'response.function_call_arguments.delta',item_id:call.id,output_index:mode==='thinking'?1:0,delta:'{}'},{type:'response.function_call_arguments.done',item_id:call.id,output_index:mode==='thinking'?1:0,arguments:'{}'},{type:'response.output_item.done',output_index:mode==='thinking'?1:0,item:call});else events.push({type:'response.output_text.delta',delta:`${marker} 15 54`});events.push({type:'response.completed',response});
        return {contentType:'text/event-stream',response:new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream','X-Bridge-AI-Request-Id':randomUUID()}})};
      }};
      const row=await runCase({app,client,model,mode,test:'W',fixture:{marker,docx},budget,report});assert.equal(row.status,'PASS');assert.equal(posts,2);assert.ok(row.requests.every(call=>call.actualPostCount===1));console.log(JSON.stringify({status:'MOCK_DRIVER_ONLY',mode,fixedDocxLoop:'PASS',fakePostCount:posts,paidPostCount:0}));
    }
  }finally{await cleanupTemporary(temporary);}
}else if(process.argv.includes('--self-test')){
  const marker='AB_FIXED_SELFTEST',docx=syntheticDocx(marker);assert.equal(docx.readUInt32LE(0),0x04034b50);assert.ok(readFixedDocx(docx).includes(marker));assert.ok(readFixedDocx(docx).includes('7 + 8'));
  const shape=JSON.stringify(shapeDiff({input:'PRIVATE_FIXTURE'}, {input:[{type:'message',content:'OTHER_PRIVATE'}]}));assert.ok(!shape.includes('PRIVATE_FIXTURE'));assert.ok(!shape.includes('OTHER_PRIVATE'));
  assert.throws(()=>budgetUpperBound({input:'x'},undefined));assert.ok(budgetUpperBound({input:'x',max_output_tokens:1024},{input:1,output:2})>.002);
  console.log(JSON.stringify({status:'MOCK_DRIVER_ONLY',paidPostCount:0,checks:['real DOCX ZIP','fixed DOCX read','shape privacy','budget failclosed']}));
}else if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
