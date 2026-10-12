import { afterEach,describe,expect,it,vi } from 'vitest';
import {chooseInstance,logicalCapabilities,catalogPresentation,instanceHealthAfterResult,instanceHealthAfterFailure,type Candidate} from './instance-router.js';
import {declaredOpenAICapabilities} from './openai-catalog.js';
afterEach(()=>vi.unstubAllEnvs());
const candidate=(id:string,patch:Partial<Candidate['instance']>={}):Candidate=>({instance:{id,modelId:'logical',providerId:id,providerModelId:'deepseek-flash',enabled:true,priority:0,weight:1,nativeProtocols:['responses'],capabilities:{tools:true,streaming:true},healthStatus:'READY',healthCheckedAt:new Date(),cooldownUntil:null,createdAt:new Date(),...patch},provider:{id,code:'DEEPSEEK',name:id,enabled:true,baseUrl:'https://api.deepseek.com',timeoutMs:60000,config:{}}});
const request={model:'logical',input:'fixture'};
describe('logical instance routing',()=>{
  it('lists configured GPT separately from routable resources and retains model-specific modes',()=>{
    const gpt=candidate('gpt',{enabled:false,healthStatus:'UNKNOWN',capabilities:declaredOpenAICapabilities('gpt-6.1-sol',false)});
    gpt.provider={...gpt.provider,code:'OPENAI',enabled:false,config:{catalogConfigured:true}};
    expect(catalogPresentation([gpt])).toMatchObject({availability:'SETUP_REQUIRED',capabilities:{responsesProfile:'openai',reasoningModes:['thinking','auto']}});
    expect(()=>chooseInstance([gpt],request)).toThrow();
    expect(catalogPresentation([candidate('ready')]).availability).toBe('READY');
    expect(catalogPresentation([]).availability).toBe('UNAVAILABLE');
  });
  it('distinguishes capability errors, transient cooldown and permanently unavailable pins',()=>{
    const normal=candidate('normal');
    try{chooseInstance([normal],{...request,reasoning:{mode:'thinking'}});throw new Error('accepted');}catch(error){expect(error).toMatchObject({status:422,code:'UNSUPPORTED_CAPABILITY'});}
    try{chooseInstance([normal],{...request,input:[{role:'user',content:[{type:'input_image',image_url:'fixture'}]}]},'normal');throw new Error('accepted');}catch(error){expect(error).toMatchObject({status:422,code:'UNSUPPORTED_CAPABILITY'});}
    expect(chooseInstance([normal],{...request,input:[{role:'user',content:'literal "input_image" is text'}]}).instance.id).toBe('normal');
    try{chooseInstance([candidate('cool',{cooldownUntil:new Date(Date.now()+60000)}),candidate('other')],request,'cool');throw new Error('accepted');}catch(error){expect(error).toMatchObject({status:503,code:'MODEL_UNAVAILABLE'});}
    try{chooseInstance([candidate('disabled',{enabled:false}),candidate('other')],request,'disabled');throw new Error('accepted');}catch(error){expect(error).toMatchObject({status:409,code:'MODEL_UNAVAILABLE'});}
  });
  it('does not poison resource health for compatibility or user errors',()=>{
    const result={status:'failed' as const,output:[],inputTokens:0,outputTokens:0,costKind:'UNKNOWN' as const};
    for(const code of ['UNSUPPORTED_CAPABILITY','invalid_request_error','PROTOCOL_INVALID','content_filter'])expect(instanceHealthAfterResult({...result,nativeResponse:{error:{code}}})).toBeNull();
    expect(instanceHealthAfterResult(result)).toBeNull();
    expect(instanceHealthAfterResult({...result,nativeResponse:{error:{code:'server_error'}}},1000)).toMatchObject({healthStatus:'DEGRADED',cooldownUntil:new Date(61000)});
    expect(instanceHealthAfterFailure('PROVIDER_RATE_LIMITED')).toMatchObject({healthStatus:'DEGRADED'});
    expect(instanceHealthAfterFailure('PROVIDER_AUTH_REQUIRED')).toMatchObject({healthStatus:'UNAVAILABLE'});
    expect(instanceHealthAfterResult({...result,status:'completed'})).toMatchObject({healthStatus:'READY',cooldownUntil:null});
  });
  it('fails closed for disabled native, unrecognized adapters and mixed profiles',()=>{
    const unsupported=candidate('unsupported');unsupported.provider.code='UNIMPLEMENTED';
    expect(()=>chooseInstance([unsupported],request)).toThrow();
    vi.stubEnv('NATIVE_RESPONSES_ENABLED','false');expect(()=>chooseInstance([candidate('native')],request)).toThrow();vi.unstubAllEnvs();
    const openai=candidate('gpt');openai.provider.code='OPENAI';
    expect(()=>chooseInstance([candidate('deepseek'),openai],request)).toThrow('相同 Responses');
    expect(logicalCapabilities([openai])).toMatchObject({nativeResponses:true,responsesProfile:'openai'});
    expect(logicalCapabilities([candidate('drained',{weight:0})])).toMatchObject({nativeResponses:false,tools:false});
    expect(chooseInstance([candidate('normal')],{...request,reasoning:{mode:'normal',effort:'high'}}).instance.id).toBe('normal');
  });
  it('prioritizes native protocol before priority and performs bounded weighted choice',()=>{
    expect(chooseInstance([candidate('translated',{priority:999,nativeProtocols:['chat_completions']}),candidate('native',{nativeProtocols:['responses']})],request).instance.id).toBe('native');
    const group=[candidate('a',{weight:2}),candidate('b',{weight:3})];
    expect(chooseInstance(group,request,null,()=>1).instance.id).toBe('a');expect(chooseInstance(group,request,null,()=>2).instance.id).toBe('b');
    expect(chooseInstance([candidate('low',{priority:0}),candidate('high',{priority:1})],request).instance.id).toBe('high');
  });
  it('filters disabled, cooldown, unknown new resources and requested capabilities',()=>{
    expect(()=>chooseInstance([candidate('disabled',{enabled:false}),candidate('unhealthy',{cooldownUntil:new Date(Date.now()+60000)}),candidate('unchecked',{healthStatus:'UNKNOWN'})],request)).toThrow();
    expect(()=>chooseInstance([candidate('normal')],{...request,reasoning:{mode:'thinking'}})).toThrow();
    expect(chooseInstance([candidate('legacy',{healthStatus:'UNKNOWN',capabilities:{legacy:true}})],request).instance.id).toBe('legacy');
  });
  it('does not reroute pinned continuation and permits draining resources only for existing sessions',()=>{
    expect(chooseInstance([candidate('old',{weight:0}),candidate('new')],request).instance.id).toBe('new');
    expect(chooseInstance([candidate('old',{weight:0}),candidate('new')],request,'old').instance.id).toBe('old');
    expect(()=>chooseInstance([candidate('old',{enabled:false}),candidate('new')],request,'old')).toThrow();
  });
});
