import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeNativeResponses, nativeReasoning, nativeResult, providerHttpFailure, validateNativeRequest } from './native-responses.js';

afterEach(()=>vi.unstubAllGlobals());
const terminal = {id:'upstream',object:'response',model:'deepseek-flash',status:'completed',output:[{id:'rs_1',type:'reasoning',content:[{type:'reasoning_text',text:'fixture reasoning'}]},{id:'fc_1',type:'function_call',call_id:'call_1',name:'probe',arguments:'{}'}],usage:{input_tokens:20,input_tokens_details:{cached_tokens:4},output_tokens:8,output_tokens_details:{reasoning_tokens:3},total_tokens:28},provider_extension:{keep:true}};
describe('native Responses protocol',()=>{
  it('preserves full wire fields and output IDs without forcing a Canonical translation',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      expect(url).toBe('https://api.deepseek.com/responses');
      const request=JSON.parse(init.body); expect(request.max_output_tokens).toBe(12); expect(request.reasoning).toEqual({effort:'none'});
      expect(request.future_extension).toEqual({keep:true}); expect(request.instructions).toBe('fixture instructions');
      return Response.json(terminal);
    }));
    const result=await executeNativeResponses('https://api.deepseek.com','fixture-key',{model:'logical',input:'fixture',instructions:'fixture instructions',reasoning:{mode:'normal',effort:'low'},maxOutputTokens:20,max_output_tokens:12,future_extension:{keep:true}},'deepseek-flash',new AbortController().signal);
    expect(result.nativeResponse).toEqual(terminal); expect(result.output[1].id).toBe('fc_1');expect(result.cachedInputTokens).toBe(4);expect(result.reasoningTokens).toBe(3);
  });
  it('preserves unknown events and sequence numbers across fragmented CRLF and withholds terminal',async()=>{
    const event={type:'response.future_event',sequence_number:6,unknown:{keep:true}};
    const wire=`event: response.future_event\r\ndata: ${JSON.stringify(event)}\r\n\r\nevent: response.incomplete\r\ndata: ${JSON.stringify({type:'response.incomplete',sequence_number:7,extension:'keep',response:{...terminal,status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}})}\r\n\r\n`;
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream({start(controller){for(let i=0;i<wire.length;i+=3)controller.enqueue(new TextEncoder().encode(wire.slice(i,i+3)));controller.close();}}))));
    const received:unknown[]=[];
    const result=await executeNativeResponses('https://api.deepseek.com','fixture',{model:'logical',input:'fixture',stream:true},'deepseek-flash',new AbortController().signal,async(type,event)=>{received.push({type,event});});
    expect(received).toEqual([{type:event.type,event}]);expect(result.status).toBe('incomplete');expect(result.nativeTerminalData).toMatchObject({sequence_number:7,extension:'keep'});
  });
  it('rejects truncated and malformed streams instead of creating completed responses',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('event: response.created\ndata: {"type":"response.created"}\n\n')));
    await expect(executeNativeResponses('https://api.deepseek.com','fixture',{model:'logical',input:'fixture',stream:true},'deepseek-flash',new AbortController().signal)).rejects.toMatchObject({code:'PROTOCOL_INVALID'});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('data: {not-json}\n\n')));
    await expect(executeNativeResponses('https://api.deepseek.com','fixture',{model:'logical',input:'fixture',stream:true},'deepseek-flash',new AbortController().signal)).rejects.toMatchObject({code:'PROTOCOL_INVALID'});
  });
  it('preserves failed semantics and marks missing usage for review',()=>{
    const failed=nativeResult({...terminal,status:'failed',error:{code:'upstream_failure'},usage:null},'response.failed');
    expect(failed.status).toBe('failed');expect(failed.usageUnavailable).toBe(true);expect(failed.nativeResponse?.error).toEqual({code:'upstream_failure'});
    expect(()=>nativeResult({...terminal,usage:null})).toThrow();
  });
  it('uses actual effort mappings and rejects unsupported executable input',()=>{
    expect(nativeReasoning({model:'x',input:'',reasoning:{mode:'thinking',effort:'minimal'}})).toEqual({effort:'low'});
    expect(nativeReasoning({model:'x',input:'',reasoning:{mode:'auto',effort:'xhigh'}})).toEqual({effort:'high'});
    expect(nativeReasoning({model:'x',input:'',reasoning:{mode:'normal',effort:'max'}})).toEqual({effort:'none'});
    expect(()=>validateNativeRequest({model:'x',input:[{role:'user',content:[{type:'input_file',file_data:'fixture'}]}]})).toThrow();
    expect(()=>validateNativeRequest({model:'x',input:[{type:'reasoning',encrypted_content:'fixture'}]})).toThrow();
    expect(()=>validateNativeRequest({model:'x',input:'',parallel_tool_calls:false,tools:[{type:'function',name:'probe'}]})).toThrow();
    expect(validateNativeRequest({model:'x',input:'',metadata:{fixture:true},tools:[{type:'web_search'}]})).toEqual({ignoredFields:['metadata'],ignoredToolTypes:['web_search']});
  });
  it('separates upstream auth, quota, rate and invalid protocol without exposing provider bodies',()=>{
    expect(providerHttpFailure(429)).toMatchObject({status:503,code:'PROVIDER_RATE_LIMITED'});
    expect(providerHttpFailure(401)).toMatchObject({status:503,code:'PROVIDER_AUTH_REQUIRED'});
    expect(providerHttpFailure(402)).toMatchObject({status:503,code:'PROVIDER_BALANCE_EXHAUSTED'});
    expect(providerHttpFailure(400)).toMatchObject({status:422,code:'PROTOCOL_INVALID'});
  });
  it('replays plaintext reasoning with opaque native sidecars without accepting encrypted-only history',async()=>{
    const reasoning={type:'reasoning',id:'rs_fixture',status:'completed',content:[{type:'reasoning_text',text:'fixture reasoning'}],summary:[],encrypted_content:'opaque-fixture',internal_chat_message_metadata_passthrough:{fixture:true}};
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
      expect(JSON.parse(init.body).input[0]).toEqual(reasoning);
      return Response.json(terminal);
    }));
    await executeNativeResponses('https://api.deepseek.com','fixture',{model:'x',input:[reasoning],reasoning:{mode:'thinking'}},'deepseek-flash',new AbortController().signal);
    for(const item of [{type:'reasoning',content:[],encrypted_content:'opaque'},{type:'reasoning',summary:[{type:'summary_text',text:'fixture'}]}]) expect(()=>validateNativeRequest({model:'x',input:[item]})).toThrow();
  });
  it('rejects forced tools in effective thinking mode before invoking upstream',()=>{
    for(const reasoning of [{mode:'thinking'},{mode:'auto'},{}]) for(const tool_choice of ['required',{type:'function',name:'probe'}]) expect(()=>validateNativeRequest({model:'x',input:'fixture',reasoning,tool_choice})).toThrow('思考模式不支持强制指定工具');
    expect(()=>validateNativeRequest({model:'x',input:'fixture',reasoning:{mode:'normal'},tool_choice:{type:'function',name:'probe'}})).not.toThrow();
    expect(()=>validateNativeRequest({model:'x',input:'fixture',reasoning:{mode:'thinking'},tool_choice:'auto'})).not.toThrow();
  });
});
