import {afterEach,describe,expect,it,vi} from 'vitest';
import {OpenAIProvider} from './openai-provider.js';
import {probeOpenAIResponses} from './native-provider-probe.js';
afterEach(()=>vi.unstubAllGlobals());
const output={id:'upstream',object:'response',status:'completed',output:[{type:'message',id:'m',role:'assistant',content:[{type:'output_text',text:'OK'}]}],usage:{input_tokens:4,output_tokens:2,total_tokens:6}};
describe('OpenAI native Responses adapter',()=>{
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
  it('administrator capability check invokes two bounded native requests without a tool executor',async()=>{
    const tool={...output,output:[{type:'function_call',call_id:'c',name:'bridge_probe',arguments:'{"value":1}'}]};
    const fetchMock=vi.fn(async(_url,init)=>{const body=JSON.parse(init.body);if(!body.stream)return Response.json(output);return new Response(`event: response.created\ndata: ${JSON.stringify({type:'response.created',response:{id:'u',status:'in_progress'}})}\n\nevent: response.completed\ndata: ${JSON.stringify({type:'response.completed',response:tool})}\n\n`);});vi.stubGlobal('fetch',fetchMock);
    const checked=await probeOpenAIResponses(new OpenAIProvider('https://api.openai.com/v1','fixture-key',10000),'fixture-native',false);
    expect(checked.capabilities).toMatchObject({responsesProfile:'openai',tools:true,streaming:true,reasoning:false,vision:false});expect(fetchMock).toHaveBeenCalledTimes(2);expect(checked.inputTokens).toBe(8);
  });
});
