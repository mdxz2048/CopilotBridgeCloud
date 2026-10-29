import {afterEach,describe,expect,it,vi} from 'vitest';
import {OpenAIProvider} from './openai-provider.js';
import {probeOpenAIResponses} from './native-provider-probe.js';
afterEach(()=>vi.unstubAllGlobals());
const output={id:'upstream',object:'response',status:'completed',output:[{type:'message',id:'m',role:'assistant',content:[{type:'output_text',text:'OK'}]}],usage:{input_tokens:4,output_tokens:2,total_tokens:6}};
describe('OpenAI native Responses adapter',()=>{
  it('isolates a disabled empty-tool workaround to configured gateways without changing client input',async()=>{
    const fetcher=vi.fn(async(_url:string,_init:{body:string})=>Response.json(output));vi.stubGlobal('fetch',fetcher);
    const request={model:'logical',input:'OK',tools:[],store:false};
    await new OpenAIProvider('https://relay.example/v1','fixture',10000,[],true).executeNative(request,'gpt-fixture',new AbortController().signal);
    const body=JSON.parse(fetcher.mock.calls[0][1].body);expect(body.tool_choice).toBe('none');expect(body.tools[0].name).toBe('bridge_disabled_placeholder');expect(request.tools).toEqual([]);
    await new OpenAIProvider('https://api.openai.com/v1','fixture',10000).executeNative(request,'gpt-fixture',new AbortController().signal);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).tools).toEqual([]);
  });
  it('preserves declared tools and rejects a forced call when no tools exist',async()=>{
    const fetcher=vi.fn(async(_url:string,_init:{body:string})=>Response.json(output));vi.stubGlobal('fetch',fetcher);
    const adapter=new OpenAIProvider('https://relay.example/v1','fixture',10000,[],true),tools=[{type:'function',name:'real_tool'}];
    await adapter.executeNative({model:'x',input:'OK',tools,tool_choice:'auto'},'x',new AbortController().signal);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).tools).toEqual(tools);
    await expect(adapter.executeNative({model:'x',input:'OK',tool_choice:'required'},'x',new AbortController().signal)).rejects.toMatchObject({code:'UNSUPPORTED_CAPABILITY'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['auto','required','none'])('does not disable native additional_tools on configured GateAI connections (%s)',async choice=>{
    const tools=[{type:'namespace',name:'functions',tools:[{type:'custom',name:'exec',format:{type:'grammar',syntax:'lark',definition:'start: /.+/'}}]}];
    const request={model:'logical',tools:[],tool_choice:choice,input:[{type:'additional_tools',id:'at_fixture',role:'system',tools},{role:'user',content:'synthetic'}]};
    const original=structuredClone(request);
    const fetcher=vi.fn(async(_url:string,init:{body:string})=>{
      const body=JSON.parse(init.body);expect(body.tools).toEqual([]);expect(body.input).toEqual(request.input);expect(body.tool_choice).toBe(choice);
      return Response.json(output);
    });vi.stubGlobal('fetch',fetcher);
    await new OpenAIProvider('https://gateai.example/v1','fixture',10000,[],true).executeNative(request,'gpt-fixture',new AbortController().signal);
    expect(request).toEqual(original);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('allows native custom calls from additional_tools through the SSE and final response guards',async()=>{
    const call={type:'custom_tool_call',id:'ctc_fixture',call_id:'call_fixture',name:'exec',namespace:'functions',input:'text(1)'};
    const response={...output,output:[call]};
    const events=[{type:'response.output_item.added',item:call},{type:'response.completed',response}];
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''))));
    const observed:unknown[]=[];
    const result=await new OpenAIProvider('https://gateai.example/v1','fixture',10000,[],true).executeNative({model:'logical',stream:true,tools:[],input:[{type:'additional_tools',tools:[{type:'namespace',name:'functions',tools:[{type:'custom',name:'exec'}]}]}]},'gpt-fixture',new AbortController().signal,async(_type,event)=>{observed.push(event);});
    expect(result.output).toEqual([call]);expect(observed).toEqual([events[0]]);
  });
  it('keeps the empty-tool workaround for empty additional_tools and rejects placeholder execution',async()=>{
    const fetcher=vi.fn(async(_url:string,init:{body:string})=>{
      const body=JSON.parse(init.body);expect(body.tool_choice).toBe('none');expect(body.tools[0].name).toBe('bridge_disabled_placeholder');
      return Response.json({...output,output:[{type:'function_call',name:'bridge_disabled_placeholder',call_id:'c',arguments:'{}'}]});
    });vi.stubGlobal('fetch',fetcher);
    await expect(new OpenAIProvider('https://gateai.example/v1','fixture',10000,[],true).executeNative({model:'x',tools:[],input:[{type:'additional_tools',tools:[]}]},'x',new AbortController().signal)).rejects.toMatchObject({code:'PROTOCOL_INVALID'});
  });
  it('reports unpaid API quota distinctly without affecting later requests',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(Response.json({error:{code:'insufficient_quota',message:'private'}},{status:429})).mockResolvedValueOnce(Response.json(output));vi.stubGlobal('fetch',fetchMock);
    const adapter=new OpenAIProvider('https://api.openai.com/v1','fixture',10000);
    await expect(adapter.executeNative({model:'logical',input:'x'},'fixture',new AbortController().signal)).rejects.toMatchObject({code:'PROVIDER_BALANCE_EXHAUSTED'});
    expect((await adapter.executeNative({model:'logical',input:'x'},'fixture',new AbortController().signal)).status).toBe('completed');
  });
  it('keeps native tools, inputs, choices and extensions with one POST and no DeepSeek instruction',async()=>{
    const tools=[{type:'namespace',name:'functions',tools:[{type:'custom',name:'exec',format:{type:'grammar',syntax:'lark',definition:'start: /.+/'}}]}];
    const input=[{type:'custom_tool_call_output',call_id:'c',output:[{type:'input_image',image_url:'data:image/png;base64,fixture'}]}];
    const fetchMock=vi.fn(async(url,init)=>{expect(url).toBe('https://api.openai.com/v1/responses');const body=JSON.parse(init.body);expect(body).toMatchObject({model:'fixture-native',tools,input,parallel_tool_calls:false,tool_choice:{type:'custom',name:'exec'},store:false,include:['reasoning.encrypted_content'],future_extension:{preserve:true}});expect(body.instructions).toBe('original');expect(body.reasoning).toBeUndefined();return Response.json(output);});
    vi.stubGlobal('fetch',fetchMock);
    const adapter=new OpenAIProvider('https://api.openai.com/v1','fixture-key',10000);
    const result=await adapter.executeNative({model:'logical',input,tools,instructions:'original',reasoning:{mode:'normal'},parallel_tool_calls:false,tool_choice:{type:'custom',name:'exec'},store:false,include:['reasoning.encrypted_content'],future_extension:{preserve:true}},'fixture-native',new AbortController().signal);
    expect(result.nativeResponse).toEqual(output);expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('preserves declared OpenAI effort without DeepSeek aliases and never retries a 429',async()=>{
    const fetchMock=vi.fn(async(_url,init)=>{expect(JSON.parse(init.body).reasoning).toEqual({effort:'xhigh'});return new Response('',{status:429});});vi.stubGlobal('fetch',fetchMock);
    const adapter=new OpenAIProvider('https://api.openai.com/v1','fixture-key',10000,['fixture-native']);
    await expect(adapter.executeNative({model:'logical',input:'x',reasoning:{mode:'thinking',effort:'xhigh'}},'fixture-native',new AbortController().signal)).rejects.toMatchObject({code:'PROVIDER_RATE_LIMITED'});expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('checks a catalog without a generation request and hides upstream authentication details',async()=>{
    const fetchMock=vi.fn(async(_url:string)=>Response.json({data:[{id:'fixture-native'}]}));vi.stubGlobal('fetch',fetchMock);
    const adapter=new OpenAIProvider('https://api.openai.com/v1','fixture-key',10000);expect(await adapter.listModels()).toEqual(['fixture-native']);expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
    fetchMock.mockImplementation(async()=>new Response('private upstream detail',{status:401}));expect(await adapter.health()).toEqual({ready:false,reason:'PROVIDER_CONNECTION_UNAVAILABLE'});
  });
  it('administrator capability check invokes bounded native text, tool and image requests without a tool executor',async()=>{
    const tool={...output,output:[{type:'function_call',call_id:'c',name:'bridge_probe',arguments:'{"value":1}'}]};
    const fetchMock=vi.fn(async(_url,init)=>{const body=JSON.parse(init.body);if(!body.stream)return Response.json(output);return new Response(`event: response.created\ndata: ${JSON.stringify({type:'response.created',response:{id:'u',status:'in_progress'}})}\n\nevent: response.completed\ndata: ${JSON.stringify({type:'response.completed',response:tool})}\n\n`);});vi.stubGlobal('fetch',fetchMock);
    const checked=await probeOpenAIResponses(new OpenAIProvider('https://api.openai.com/v1','fixture-key',10000),'fixture-native',false);
    expect(checked.capabilities).toMatchObject({responsesProfile:'openai',tools:true,streaming:true,reasoning:false,vision:false});expect(fetchMock).toHaveBeenCalledTimes(3);expect(checked.inputTokens).toBe(12);
  });
  it.each([['red',true],['blue',false],['unsupported',false]])('records vision only after successful synthetic image recognition: %s',async(color,vision)=>{
    const tool={...output,output:[{type:'function_call',call_id:'c',name:'bridge_probe',arguments:'{"value":1}'}]};
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
      const body=JSON.parse(init.body),image=Array.isArray(body.input)&&body.input[0]?.content?.find((p:{type:string})=>p.type==='input_image');
      if(image){expect(Buffer.from(image.image_url.split(',')[1],'base64').subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));if(color==='unsupported')return new Response('',{status:422});return Response.json({...output,output:[{type:'message',id:'m',role:'assistant',content:[{type:'output_text',text:color}]}]});}
      if(!body.stream)return Response.json(output);
      return new Response(`event: response.created\ndata: ${JSON.stringify({type:'response.created',response:{id:'u',status:'in_progress'}})}\n\nevent: response.completed\ndata: ${JSON.stringify({type:'response.completed',response:tool})}\n\n`);
    }));
    const checked=await probeOpenAIResponses(new OpenAIProvider('https://relay.example/v1','fixture',10000),'fixture-native',false);
    expect(checked.capabilities).toMatchObject({vision,visionProbe:vision?'passed':'unverified',tools:true,streaming:true});
  });
});
