// Local App + candidate Cloud adapter integration with a synthetic supplier.
// No account, real provider request, production service or local tool execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {OpenAIProvider} from '../../apps/api/src/openai-provider.js';

const appRoot=resolve(process.env.BRIDGE_APP_ROOT??fileURLToPath(new URL('../../../copilot-bridge-app/',import.meta.url)));
const {RemoteBridgeServer}=await import(pathToFileURL(resolve(appRoot,'dist-electron/cloud/remote-bridge-server.js')).href);
const originalFetch=globalThis.fetch;
const endpoint='https://gateai.fixture/v1/responses';
const tool={type:'namespace',name:'functions',tools:[{type:'custom',name:'exec',format:{type:'grammar',syntax:'lark',definition:'start: "text(1)"'}}]};
const inventory={type:'additional_tools',id:'at_fixture',role:'system',tools:[tool]};
const result=(id:string,output:unknown[])=>({id,object:'response',model:'gpt-fixture',status:'completed',output,usage:{input_tokens:10,output_tokens:5,total_tokens:15}});
const sse=(events:unknown[])=>events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('');
const parse=(text:string)=>text.split(/\r?\n\r?\n/).flatMap(block=>{const data=block.split('\n').find(line=>line.startsWith('data:'));return data?[JSON.parse(data.slice(5))]:[];});
async function setup(supplier:(body:any,count:number)=>unknown[]){
  const requests:any[]=[],cloud:any[]=[];
  globalThis.fetch=async(url,init)=>{
    if(String(url)!==endpoint)return originalFetch(url,init);
    const body=JSON.parse(String(init?.body));requests.push(body);
    return new Response(sse(supplier(body,requests.length)),{headers:{'content-type':'text/event-stream'}});
  };
  const adapter=new OpenAIProvider('https://gateai.fixture/v1','fixture-key',10000,[],true);
  const bridge=new RemoteBridgeServer({getMe:async()=>({id:'fixture'}),listModels:async()=>({data:[{id:'logical',capabilities:{nativeResponses:true,responsesProfile:'openai'}}]}),createResponse:async(request:any)=>{
    cloud.push(structuredClone(request));const events:unknown[]=[];
    const response=await adapter.executeNative(request,'gpt-fixture',new AbortController().signal,async(type,event)=>{events.push(event);});
    events.push({type:'response.completed',response:response.nativeResponse});
    return {contentType:'text/event-stream',response:new Response(sse(events))};
  }},0,undefined,undefined,undefined,{getApiKey:async()=>'fixture',getModel:async()=>'logical',getReasoning:async()=>'normal'});
  const status=await bridge.start();
  const post=async(body:unknown)=>{
    const response=await originalFetch(status.endpoint+'/v1/responses',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json',session_id:'synthetic-session'},body:JSON.stringify({model:'desktop',stream:true,...body as object})});
    const text=await response.text();assert.equal(response.status,200,text);return parse(text);
  };
  return {post,requests,cloud,close:async()=>{await bridge.stop();globalThis.fetch=originalFetch;}};
}

test('GateAI additional native custom tool survives App, adapter, SSE and output-only continuation',async()=>{
  const call={type:'custom_tool_call',id:'ctc_fixture',call_id:'call_fixture',namespace:'functions',name:'exec',input:'text(1)'};
  const harness=await setup((body,count)=>{
    assert.deepEqual(body.tools,[]);assert.equal(body.tool_choice??'auto','auto');assert.ok(body.input.some((item:any)=>item.type==='additional_tools'));
    if(count===1)return [{type:'response.output_item.added',output_index:0,item:{...call,input:''}},{type:'response.custom_tool_call_input.delta',output_index:0,item_id:call.id,delta:'text(1)'},{type:'response.custom_tool_call_input.done',output_index:0,item_id:call.id,input:call.input},{type:'response.output_item.done',output_index:0,item:call},{type:'response.completed',response:result('r1',[call])}];
    assert.deepEqual(body.input.at(-1),{type:'custom_tool_call_output',call_id:'call_fixture',output:[{type:'input_text',text:'SYNTHETIC_MARKER'}]});
    return [{type:'response.completed',response:result('r2',[])}];
  });
  try{
    const first=await harness.post({tools:[],tool_choice:'auto',input:[inventory,{role:'user',content:'synthetic'}]});
    assert.deepEqual(first.at(-1).response.output,[call]);
    assert.equal(first.find((event:any)=>event.type==='response.custom_tool_call_input.delta').delta,'text(1)');
    await harness.post({input:[{type:'custom_tool_call_output',call_id:call.call_id,output:[{type:'input_text',text:'SYNTHETIC_MARKER'}]}]});
    assert.equal(harness.requests.length,2);assert.equal(harness.cloud.length,2);
  }finally{await harness.close();}
});

test('GateAI two parallel arguments.done calls preserve IDs and reversed long results without deltas',async()=>{
  const calls=['a','b'].map(name=>({type:'function_call',id:'fc_'+name,call_id:'call_'+name,name:'probe_'+name,arguments:'{}'}));
  const long='synthetic long result '.repeat(6000);
  const harness=await setup((body,count)=>{
    if(count===1)return [...calls.flatMap((call,index)=>[
      {type:'response.output_item.added',output_index:index,item:{...call,arguments:''}},
      {type:'response.function_call_arguments.done',item_id:call.id,output_index:index,arguments:call.arguments},
      {type:'response.output_item.done',output_index:index,item:call}]),{type:'response.completed',response:result('parallel1',calls)}];
    const outputs=body.input.filter((item:any)=>item.type==='function_call_output');
    assert.deepEqual(outputs.map((item:any)=>item.call_id),['call_b','call_a']);assert.equal(outputs[1].output,long);
    return [{type:'response.completed',response:result('parallel2',[])}];
  });
  try{
    const first=await harness.post({input:'synthetic',tools:calls.map(call=>({type:'function',name:call.name,parameters:{type:'object',properties:{}}})),parallel_tool_calls:true});
    assert.deepEqual(first.at(-1).response.output,calls);assert.equal(first.filter((event:any)=>event.type==='response.function_call_arguments.done').length,2);
    await harness.post({previous_response_id:first.at(-1).response.id,input:[{type:'function_call_output',call_id:'call_b',output:'synthetic-b'},{type:'function_call_output',call_id:'call_a',output:long}]});
    assert.equal(harness.requests.length,2);assert.equal(harness.cloud.length,2);
  }finally{await harness.close();}
});
