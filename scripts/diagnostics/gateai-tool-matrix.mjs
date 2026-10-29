// Bounded, synthetic GateAI-only provider probe. No model-generated code is executed.
// Run beside a bundled openai-provider.js inside the API container; credentials stay there.
import {createRequire} from 'node:module';
import {createDecipheriv,randomBytes} from 'node:crypto';
import {OpenAIProvider} from './openai-provider.js';

if(process.env.GATEAI_PROBE_RUN!=='1')throw new Error('SET_GATEAI_PROBE_RUN_1_FOR_PAID_SYNTHETIC_TESTS');
const require=createRequire('/workspace/packages/db/package.json');
const {Client}=require('pg');
const db=new Client({connectionString:process.env.DATABASE_URL});
await db.connect();
let provider;
try {
  const {rows}=await db.query("select p.base_url,p.config,c.ciphertext,c.iv,c.tag from providers p join provider_credentials c on c.provider_id=p.id where p.base_url=$1 and p.enabled=true",['https://gateai.cc/v1']);
  if(rows.length!==1)throw new Error('GATEAI_CONNECTION_NOT_UNIQUE');
  provider=rows[0];
} finally {await db.end();}
const decipher=createDecipheriv('aes-256-gcm',Buffer.from(process.env.PROVIDER_MASTER_KEY,'hex'),Buffer.from(provider.iv,'base64'));
decipher.setAuthTag(Buffer.from(provider.tag,'base64'));
const key=Buffer.concat([decipher.update(Buffer.from(provider.ciphertext,'base64')),decipher.final()]).toString();
const adapter=new OpenAIProvider(provider.base_url,key,60000,provider.config.nativeReasoningModels??[],provider.config.emptyToolsWorkaround===true);
const fn=name=>({type:'function',name,description:'Return a synthetic diagnostic marker. No side effects.',strict:true,parameters:{type:'object',properties:{},required:[],additionalProperties:false}});
const custom={type:'custom',name:'probe',description:'Return a synthetic marker. Supply exactly ping as raw input. No side effects.',format:{type:'text'}};
const ns=tool=>({type:'namespace',name:'fixture',description:'Synthetic diagnostic tools',tools:[tool]});
const additional=tools=>({type:'additional_tools',id:'at_'+randomBytes(24).toString('hex'),role:'system',tools});
const prompt='Call probe once to get the diagnostic marker. Never guess the marker. After receiving the result, reply with only that marker. If unavailable reply TOOL_UNAVAILABLE.';
const cases=[
  {name:'function_json',tools:[fn('probe')],stream:false},
  {name:'function_sse',tools:[fn('probe')]},
  {name:'namespace_function',tools:[ns(fn('probe'))]},
  {name:'namespace_custom',tools:[ns(custom)],raw:'ping'},
  {name:'additional_function',tools:[],extra:()=>[additional([ns(fn('probe'))])]},
  {name:'additional_custom',tools:[],extra:()=>[additional([ns(custom)])],raw:'ping'},
  {name:'mixed_top_and_additional',tools:[fn('unrelated')],extra:()=>[additional([ns(custom)])],raw:'ping'},
  {name:'required_function',tools:[fn('probe')],choice:'required'},
  {name:'named_function',tools:[fn('probe')],choice:{type:'function',name:'probe'}},
  {name:'native_grammar_wrapper',tools:[{type:'namespace',name:'functions',description:'Synthetic wrapper fixture',tools:[{type:'custom',name:'exec',description:'For this synthetic diagnostic call this tool with exactly text(1). No code will be executed.',format:{type:'grammar',syntax:'lark',definition:'start: "text(1)"'}}]}],prompt:'Call functions.exec with exactly text(1) to get a marker. After receiving the tool result reply only its marker.',callName:'exec',raw:'text(1)'},
  {name:'parallel_results',tools:[fn('probe_a'),fn('probe_b')],parallel:true,names:['probe_a','probe_b'],prompt:'Call both probe_a and probe_b in parallel, in the same response, to obtain two markers. After both results reply with both markers separated by a space. Do not guess the markers.'},
  {name:'long_output',tools:[fn('probe')],long:true},
  {name:'text_array_output',tools:[fn('probe')],array:true},
  {name:'tool_error_result',tools:[fn('probe')],error:true},
  {name:'three_tool_rounds',tools:[fn('probe')],rounds:3,prompt:'Call probe three times sequentially, waiting for each result before the next call. After the third result reply only the third marker.'},
  {name:'no_tools_placeholder',tools:[],noCall:true,prompt:'Reply exactly OK.'},
  {name:'additional_explicit_none',tools:[],extra:()=>[additional([ns(custom)])],choice:'none',noCall:true,prompt:'Do not call any tools. Reply exactly OK.'},
  {name:'additional_thinking',tools:[],extra:()=>[additional([ns(custom)])],raw:'ping',thinking:true},
];
const selected=(process.env.GATEAI_PROBE_CASES??cases.map(c=>c.name).join(',')).split(',');
if(selected.some(name=>!cases.some(c=>c.name===name)))throw new Error('UNKNOWN_CASE');
const models=(process.env.GATEAI_PROBE_MODELS??'gpt-6-sol,gpt-6.1-sol').split(',');
if(models.some(m=>!['gpt-6-sol','gpt-6.1-sol'].includes(m)))throw new Error('MODEL_NOT_ALLOWED');
let posts=0,inputTokens=0,outputTokens=0;
const realFetch=globalThis.fetch;
globalThis.fetch=async(...args)=>{if(++posts>90)throw new Error('POST_BUDGET');return realFetch(...args);};
const report={at:new Date().toISOString(),provider:'GateAI',scope:'REAL_PROVIDER_SYNTHETIC_TOOLS_NO_LOCAL_EXECUTION',rows:[]};
async function send(model,c,input,continuation=false){
  const events=[],start=Date.now();
  const request={model:'diagnostic',input,tools:c.tools,stream:c.stream!==false,store:false,max_output_tokens:c.thinking?1024:384,
    reasoning:c.thinking?{mode:'thinking',effort:'low'}:{mode:'normal'},parallel_tool_calls:c.parallel??false,
    tool_choice:continuation?'auto':c.choice??'auto'};
  const result=await adapter.executeNative(request,model,AbortSignal.timeout(60000),async(type,event)=>{events.push({type,event});});
  inputTokens+=result.inputTokens;outputTokens+=result.outputTokens;
  for(const call of result.output.filter(x=>['function_call','custom_tool_call'].includes(x.type))){
    const customCall=call.type==='custom_tool_call';
    const deltaType=customCall?'response.custom_tool_call_input.delta':'response.function_call_arguments.delta';
    const doneType=customCall?'response.custom_tool_call_input.done':'response.function_call_arguments.done';
    const field=customCall?'input':'arguments';
    const parts=events.filter(e=>e.type===deltaType&&e.event.item_id===call.id);
    const done=events.find(e=>e.type===doneType&&e.event.item_id===call.id);
    // GateAI can send complete arguments.done without delta chunks for parallel
    // calls. The authoritative done payload must still match the final call.
    if(request.stream&&((parts.length>0&&parts.map(e=>e.event.delta).join('')!==call[field])||done?.event[field]!==call[field])){
      const error=new Error('SSE_ARGUMENT_MISMATCH');
      error.details={call,resultCalls:result.output.filter(x=>['function_call','custom_tool_call'].includes(x.type)),events:events.filter(e=>/output_item|arguments|custom_tool_call/.test(e.type))};
      throw error;
    }
  }
  return {result,summary:{ms:Date.now()-start,status:result.status,inputTokens:result.inputTokens,outputTokens:result.outputTokens,eventCount:events.length,
    calls:result.output.filter(x=>['function_call','custom_tool_call'].includes(x.type)).map(x=>({type:x.type,name:x.name,namespace:x.namespace,input:x.input,arguments:x.arguments})),
    upstreamId:result.nativeResponse?.id}};
}
for(const model of models)for(const c of cases.filter(c=>selected.includes(c.name))){
  if(c.thinking&&model!=='gpt-6.1-sol')continue;
  const row={model,case:c.name,status:'RUNNING',requests:[]};report.rows.push(row);
  try {
    let input=[...(c.extra?.()??[]),{role:'user',content:(c.prompt??prompt)+(c.raw?` Use exactly ${c.raw} as raw tool input.`:'')}],markers=[];
    for(let round=0;round<(c.rounds??1);round++){
      const {result,summary}=await send(model,c,input,round>0);row.requests.push(summary);
      if(result.status!=='completed')throw new Error('NOT_COMPLETED');
      const calls=result.output.filter(x=>['function_call','custom_tool_call'].includes(x.type));
      if(c.noCall){if(calls.length)throw new Error('UNEXPECTED_CALL');if(!result.output.some(x=>JSON.stringify(x.content).includes('OK')))throw new Error('MISSING_OK');row.status='PASS';break;}
      const expected=c.names??[c.callName??'probe'];
      if(calls.length!==expected.length||expected.some(name=>!calls.some(x=>x.name===name)))throw new Error('MISSING_EXPECTED_CALL');
      if(c.raw&&calls.some(x=>String(x.input).trim()!==c.raw))throw new Error('RAW_INPUT_MISMATCH');
      input=[...input,...result.output];markers=[];
      for(const call of calls){
        const marker='GATEAI_PROBE_'+randomBytes(8).toString('hex');markers.push(marker);
        const text=c.long?'synthetic padding '.repeat(3000)+'\nmarker='+marker:c.error?JSON.stringify({ok:false,error:'SYNTHETIC_EXPECTED_FAILURE',marker}):marker;
        input.push({type:call.type==='custom_tool_call'?'custom_tool_call_output':'function_call_output',call_id:call.call_id,output:c.array?[{type:'input_text',text}]:text});
      }
    }
    if(!c.noCall){
      const {result,summary}=await send(model,c,input,true);row.requests.push(summary);
      const answer=result.output.filter(x=>x.type==='message').flatMap(x=>x.content??[]).map(x=>x.text??'').join('');
      if(result.status!=='completed'||!markers.every(marker=>answer.includes(marker))){
        const error=new Error('RESULT_MARKER_MISMATCH');error.details={answerPreview:answer.slice(0,500),answerLength:answer.length,expectedMarkers:markers};throw error;
      }
      row.status='PASS';
    }
  }catch(error){row.status='FAIL';row.errorCode=error.code??error.message;if(error.details)row.details=error.details;}
  console.log(JSON.stringify({kind:'case',...row}));
}
console.log(JSON.stringify({kind:'report',...report,posts,inputTokens,outputTokens}));
