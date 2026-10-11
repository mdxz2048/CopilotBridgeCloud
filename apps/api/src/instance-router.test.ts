import { afterEach,describe,expect,it,vi } from 'vitest';
import {chooseInstance,logicalCapabilities,type Candidate} from './instance-router.js';
afterEach(()=>vi.unstubAllEnvs());
const candidate=(id:string,patch:Partial<Candidate['instance']>={}):Candidate=>({instance:{id,modelId:'logical',providerId:id,providerModelId:'deepseek-flash',enabled:true,priority:0,weight:1,nativeProtocols:['responses'],capabilities:{tools:true,streaming:true},healthStatus:'READY',healthCheckedAt:new Date(),cooldownUntil:null,createdAt:new Date(),...patch},provider:{id,code:'DEEPSEEK',name:id,enabled:true,baseUrl:'https://api.deepseek.com',timeoutMs:60000,config:{}}});
const request={model:'logical',input:'fixture'};
describe('logical instance routing',()=>{
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
