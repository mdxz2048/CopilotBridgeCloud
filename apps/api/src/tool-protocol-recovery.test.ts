import {expect,it,vi} from 'vitest';
import {addRecoveryUsage,regenerateWrapperInput,regeneratedInput} from './tool-protocol-recovery.js';
import type {CanonicalRequest,CanonicalResult,ProviderAdapter} from './provider.js';
const result=(input:string):CanonicalResult=>({status:'completed',output:[{type:'function_call',name:'functions__exec',arguments:JSON.stringify({input})}],inputTokens:10,outputTokens:4,cachedInputTokens:2,costKind:'UNKNOWN'});
it('makes one forced protocol correction without mutating or executing the original task',async()=>{
 const executeNative=vi.fn(async(_request:CanonicalRequest,_model:string,_signal:AbortSignal)=>result('text("synthetic");')),adapter={executeNative} as unknown as ProviderAdapter;
 const wrapper={type:'function',name:'functions__exec',parameters:{type:'object'}};const request={model:'logical',input:[{role:'user',content:'synthetic task'}],tools:[wrapper,{type:'function',name:'unrelated'}],stream:true,previous_response_id:'old',max_output_tokens:20000};const before=JSON.stringify(request);
 const corrected=await regenerateWrapperInput(adapter,request,'model',{name:'exec',call_id:'call_fixture',arguments:'{}'},new AbortController().signal);
 expect(executeNative).toHaveBeenCalledTimes(1);expect(executeNative.mock.calls[0][0]).toMatchObject({stream:false,reasoning:{mode:'normal'},tool_choice:{type:'function',name:'functions__exec'},max_output_tokens:8192,tools:[wrapper]});expect(executeNative.mock.calls[0][0]).not.toHaveProperty('previous_response_id');expect(JSON.stringify(request)).toBe(before);expect(regeneratedInput(corrected)).toBe('text("synthetic");');
});
it('rejects empty, multiple or unrelated correction calls and aggregates actual usage once',()=>{
 for(const bad of [{...result(''),status:'failed'},result(''),{...result('x'),output:[...result('x').output,...result('y').output]},{...result('x'),output:[{type:'function_call',name:'unrelated',arguments:'{"input":"x"}'}]}])expect(()=>regeneratedInput(bad as CanonicalResult)).toThrow();
 const first=result('first'),next=result('second'),sum=addRecoveryUsage(first,next);expect(sum).toMatchObject({inputTokens:20,outputTokens:8,cachedInputTokens:4});expect(sum.output).toBe(first.output);expect(first.inputTokens).toBe(10);expect(sum.providerReportedUsage?.bridge_protocol_recovery).toMatchObject({attempts:2});
});
