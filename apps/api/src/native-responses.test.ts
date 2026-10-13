import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeNativeResponses, nativeInput, nativeReasoning, nativeResult, providerHttpFailure, validateNativeRequest } from './native-responses.js';

afterEach(()=>vi.unstubAllGlobals());
const terminal = {id:'upstream',object:'response',model:'deepseek-flash',status:'completed',output:[{id:'rs_1',type:'reasoning',content:[{type:'reasoning_text',text:'fixture reasoning'}]},{id:'fc_1',type:'function_call',call_id:'call_1',name:'probe',arguments:'{}'}],usage:{input_tokens:20,input_tokens_details:{cached_tokens:4},output_tokens:8,output_tokens_details:{reasoning_tokens:3},total_tokens:28},provider_extension:{keep:true}};
describe('native Responses protocol',()=>{
  it('replays client discovery and an empty result before ordinary tools without losing history',async()=>{
    const discovery={type:'tool_search_call',call_id:'search_1',status:'completed',execution:'client',arguments:'{"query":"probe"}',extension:{retained:true}};
    const empty={type:'tool_search_output',call_id:'search_1',execution:'client',status:'completed',tools:[]};
    const input=[{type:'message',role:'user',content:'synthetic task'},discovery,{...terminal.output[1]},empty,{type:'function_call_output',call_id:'call_1',output:'synthetic result'}];
    const original=JSON.stringify(input),sent:Array<Record<string,unknown>>=[];
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
      const body=JSON.parse(init.body);sent.push(body);
      expect(body.input.some((item:Record<string,unknown>)=>String(item.type).startsWith('tool_search'))).toBe(false);
      expect(body.input[0].type).toBe('message');expect(body.input[0].role).toBe('user');
      expect(JSON.parse(body.input[0].content[0].text.split('\n').slice(1).join('\n')).records).toEqual([{index:1,item:discovery},{index:3,item:empty}]);
      expect(body.input[2].call_id).toBe('call_1');expect(body.input[3].output).toBe('synthetic result');
      return Response.json({...terminal,output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'done'}]}]});
    }));
    const request={model:'logical',input,tools:[{type:'function',name:'probe'}],reasoning:{mode:'normal'}};
    expect(()=>validateNativeRequest(request)).not.toThrow();
    await executeNativeResponses('https://fixture.test','fixture',request,'fixture',new AbortController().signal);
    await executeNativeResponses('https://fixture.test','fixture',{...request,input:[...input,{type:'message',role:'user',content:'continue'}]},'fixture',new AbortController().signal);
    expect(sent).toHaveLength(2);expect((sent[1].input as unknown[]).length).toBe(input.length);expect(JSON.stringify(input)).toBe(original);
  });
  it('retains nonempty discovered definitions while using only desktop-advertised executable tools',async()=>{
    const tools=[{type:'function',name:'functions__probe',parameters:{type:'object',properties:{}}}];
    const item={type:'tool_search_output',id:'search_output',call_id:'search_2',execution:'client',tools:[{type:'namespace',name:'functions',tools:[{type:'function',name:'probe',parameters:{type:'object',properties:{}}}]}]};
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
      const wire=JSON.parse(init.body);expect(wire.tools).toEqual(tools);
      expect(JSON.parse(wire.input[0].content[0].text.split('\n').slice(1).join('\n')).records).toEqual([{index:0,item}]);
      return new Response(`data: ${JSON.stringify({type:'response.completed',response:terminal})}\n\n`);
    }));
    await executeNativeResponses('https://fixture.test','fixture',{model:'logical',input:[item],tools,stream:true},'fixture',new AbortController().signal);
    expect(nativeInput([item],'openai')).toEqual([item]);expect(validateNativeRequest({model:'logical',input:[item]},'openai')).toEqual({ignoredFields:[],ignoredToolTypes:[]});
  });
  it('keeps policy first and compacts interleaved discovery without breaking tool-result adjacency',()=>{
    const policy={type:'message',role:'developer',content:'fixture policy'};
    const first={type:'tool_search_call',execution:'client',call_id:'search_a',arguments:'{}'};
    const result={type:'tool_search_output',execution:'client',call_id:'search_a',tools:[]};
    const second={...first,call_id:'search_b'};
    const call=terminal.output[1],output={type:'function_call_output',call_id:call.call_id,output:'fixture'};
    const input=[policy,first,call,result,second,output];
    const normalized=nativeInput(input) as Array<Record<string,unknown>>;
    expect(normalized[0]).toEqual(policy);expect(normalized.slice(2)).toEqual([call,output]);
    const content=normalized[1].content as Array<{text:string}>;
    expect(JSON.parse(content[0].text.split('\n').slice(1).join('\n')).records).toEqual([{index:1,item:first},{index:3,item:result},{index:4,item:second}]);
    expect(input).toEqual([policy,first,call,result,second,output]);
  });
  it('rejects server discovery and malformed client records without calling upstream',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    for(const item of[
      {type:'tool_search_call',call_id:'s',execution:'server'},
      {type:'tool_search_call',call_id:'',execution:'client'},
      {type:'tool_search_output',call_id:'s',execution:'client'},
      {type:'tool_search_output',call_id:'s',execution:'client',tools:[null]},
      {type:'compaction',encrypted_content:'fixture'}
    ])await expect(executeNativeResponses('https://fixture.test','fixture',{model:'logical',input:[item]},'fixture',new AbortController().signal)).rejects.toMatchObject({status:422});
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves collaboration envelope content and routing in DeepSeek history',async()=>{
    const item={type:'agent_message',id:'message',author:{agent_id:'child'},recipient:{agent_id:'parent'},content:'fixture result',internal_chat_message_metadata_passthrough:{keep:true}};
    const request={model:'logical',input:[item]};
    expect(()=>validateNativeRequest(request)).not.toThrow();
    expect(nativeInput(request.input,'openai')).toEqual([item]);
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const wire=JSON.parse(init.body);expect(wire.input[0].role).toBe('user');expect(JSON.parse(wire.input[0].content[0].text.split('\n').slice(1).join('\n'))).toEqual(item);return Response.json(terminal);}));
    await executeNativeResponses('https://fixture.test','fixture',request,'fixture',new AbortController().signal);
  });
  it('keeps OpenAI fields and tool semantics while rejecting platform asynchronous ownership',async()=>{
    const request={model:'logical',input:[{type:'message',role:'user',content:[{type:'input_file',file_data:'data:application/pdf;base64,fixture'}]}],tools:[{type:'namespace',name:'functions',tools:[{type:'custom',name:'exec'}]}],parallel_tool_calls:false,reasoning:{mode:'thinking',effort:'medium'},metadata:{keep:true},future_extension:{keep:true}};
    expect(validateNativeRequest(request,'openai')).toEqual({ignoredFields:[],ignoredToolTypes:[]});
    expect(nativeReasoning(request,true,'openai')).toEqual({effort:'medium'});
    expect(nativeReasoning({...request,reasoning:{mode:'normal'}},false,'openai')).toEqual({});
    for(const profile of ['openai','deepseek'] as const)for(const patch of [{background:true},{conversation:'external'}])expect(()=>validateNativeRequest({...request,...patch},profile)).toThrow();
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const wire=JSON.parse(init.body);expect(wire.tools).toEqual(request.tools);expect(wire.instructions).toBeUndefined();expect(wire.reasoning).toEqual({effort:'medium'});expect(wire.metadata).toEqual({keep:true});return Response.json({...terminal,output:[terminal.output[1],{...terminal.output[1],id:'fc_2',call_id:'call_2'}]});}));
    const result=await executeNativeResponses('https://api.openai.com/v1','fixture',request,'gpt-fixture',new AbortController().signal,undefined,{responsesProfile:'openai',canThink:true});expect(result.status).toBe('completed');expect(result.toolCalls).toBe(2);
  });
  it('streams reasoning, tools and later text immediately without another POST',async()=>{
    let controller!:ReadableStreamDefaultController;const received:string[]=[];
    const push=(event:unknown)=>controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
    const fetch=vi.fn(async()=>new Response(new ReadableStream({start(c){controller=c;}})));vi.stubGlobal('fetch',fetch);
    const pending=executeNativeResponses('https://api.deepseek.com','fixture',{model:'x',input:'fixture',stream:true,parallel_tool_calls:false,tools:[{type:'function',name:'probe'}]},'deepseek-flash',new AbortController().signal,async type=>{received.push(type);});
    await vi.waitFor(()=>expect(controller).toBeDefined());
    push({type:'response.reasoning_text.delta',delta:'private fixture'});await vi.waitFor(()=>expect(received).toEqual(['response.reasoning_text.delta']));
    push({type:'response.output_item.added',output_index:1,item:terminal.output[1]});push({type:'response.output_text.delta',delta:'later fixture'});
    await vi.waitFor(()=>expect(received).toEqual(['response.reasoning_text.delta','response.output_item.added','response.output_text.delta']));
    push({type:'response.completed',response:terminal});controller.close();
    const result=await pending;expect(received).toEqual(['response.reasoning_text.delta','response.output_item.added','response.output_text.delta']);expect(fetch).toHaveBeenCalledTimes(1);expect(result).toMatchObject({nativeMetrics:{upstreamAttemptCount:1,eventCount:4}});
  });
  it('does not add serial instructions for advertised nonexecutable tools',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{expect(JSON.parse(init.body).instructions).toBeUndefined();return Response.json(terminal);}));
    const result=await executeNativeResponses('https://api.deepseek.com','fixture',{model:'x',input:'fixture',parallel_tool_calls:false,tools:[{type:'web_search'}]},'deepseek-flash',new AbortController().signal);expect(result.status).toBe('completed');
  });
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
    expect(()=>validateNativeRequest({model:'x',input:'',parallel_tool_calls:false,tools:[{type:'function',name:'probe'}]})).not.toThrow();
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
  it('preserves multiple native tools despite the upstream ignored parallel flag and retains billable usage',async()=>{
    const multi={...terminal,output:[terminal.output[1],{...terminal.output[1],id:'fc_2',call_id:'call_2'}]};
    const wire=[{type:'response.created',response:{id:'upstream'}},{type:'response.output_item.added',item:multi.output[0]},{type:'response.output_item.added',item:multi.output[1]},{type:'response.completed',response:multi}].map(e=>`data: ${JSON.stringify(e)}\n\n`).join('');
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const body=JSON.parse(init.body);expect(body.parallel_tool_calls).toBe(false);expect(body.instructions).toBeUndefined();return new Response(wire);}));
    const events:string[]=[];const result=await executeNativeResponses('https://api.deepseek.com','fixture',{model:'x',input:'fixture',tools:[{type:'function',name:'probe'}],parallel_tool_calls:false,stream:true},'deepseek-flash',new AbortController().signal,async type=>{events.push(type);});
    expect(events).toEqual(['response.created','response.output_item.added','response.output_item.added']);expect(result.status).toBe('completed');expect(result.output).toEqual(multi.output);expect(result.inputTokens).toBe(20);expect(result.outputTokens).toBe(8);expect(result.toolCalls).toBe(2);expect(result.nativeResponse?.error).toBeUndefined();
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json(multi)));
    const json=await executeNativeResponses('https://api.deepseek.com','fixture',{model:'x',input:'fixture',tools:[{type:'function',name:'probe'}],parallel_tool_calls:false},'deepseek-flash',new AbortController().signal);expect(json.status).toBe('completed');expect(json.output).toEqual(multi.output);
    expect(validateNativeRequest({model:'x',input:'fixture',instructions:'original',parallel_tool_calls:false})).toMatchObject({ignoredFields:['parallel_tool_calls']});
  });
  it('releases a single-call serial stream only after validated completion',async()=>{
    const events=[{type:'response.created',response:{id:'upstream'}},{type:'response.output_item.added',item:terminal.output[1]},{type:'response.completed',response:terminal}];
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''))));
    const delivered:string[]=[];const result=await executeNativeResponses('https://api.deepseek.com','fixture',{model:'x',input:'fixture',tools:[{type:'function',name:'probe'}],parallel_tool_calls:false,stream:true},'deepseek-flash',new AbortController().signal,async type=>{delivered.push(type);});
    expect(result.status).toBe('completed');expect(result.output).toEqual(terminal.output);expect(delivered).toEqual(['response.created','response.output_item.added']);
  });
  it('does not mistake assigned call IDs or repeated item events for additional serial tools',async()=>{
    const item=terminal.output[1];
    const events=[{type:'response.output_item.added',item:{...item,call_id:''}},{type:'response.output_item.done',output_index:1,item},{type:'response.output_item.done',item},{type:'response.completed',response:terminal}];
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''))));
    const result=await executeNativeResponses('https://api.deepseek.com','fixture',{model:'x',input:'fixture',tools:[{type:'function',name:'probe'}],parallel_tool_calls:false,stream:true},'deepseek-flash',new AbortController().signal,async()=>{});
    expect(result.status).toBe('completed');expect(result.toolCalls).toBe(1);
  });
});
