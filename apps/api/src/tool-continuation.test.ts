import { describe, expect, it } from 'vitest';
import { nextContinuationState, pendingContinuation } from './tool-continuation.js';

const tools = [{ name: 'read' }, { name: 'write' }];
const call = (callId: string) => ({
  output: [{ type: 'function_call', call_id: callId, name: 'read', arguments: '{}' }],
  inputTokens: 1, outputTokens: 1, costKind: 'UNKNOWN' as const,
});
const answer = (ids: string[]) => ({
  model: 'mock/mock-chat', tools, input: ids.map(call_id => ({ type: 'function_call_output', call_id, output: 'done' })),
});
const initial = { model: 'mock/mock-chat', tools, input: 'Read and write' };

describe('authenticated tool continuation', () => {
  it('keeps discovery history separate from pending executable calls during sequential results',()=>{
    const now=Date.now();
    const input=[{type:'tool_search_call',call_id:'search',execution:'client',arguments:'{}'},
      {type:'tool_search_output',call_id:'search',execution:'client',tools:[]}];
    const request={...initial,input};
    const output=[call('first').output[0],call('second').output[0]];
    const state=nextContinuationState(request,{...call('unused'),output,nativeResponse:{output}},null,now);
    expect(state.pendingCallIds).toEqual(['first','second']);
    const follow={...request,input:[...input,...output,{type:'function_call_output',call_id:'first',output:'one'}]};
    const claim=pendingContinuation(state,follow,now+1);
    expect(claim?.satisfiedCallIds).toEqual(['first']);
    const next=nextContinuationState(follow,{...call('unused'),output:[]},claim,now+1);
    expect(pendingContinuation(next,{...follow,input:[...follow.input,{type:'function_call_output',call_id:'second',output:'two'}]},now+2)?.satisfiedCallIds).toEqual(['second']);
    expect(pendingContinuation(state,{...follow,input:[{...input[0],arguments:'tampered'},...follow.input.slice(1)]},now+1)).toBeNull();
  });
  it('keeps a signed-history tool result rate exemption after a one-hour local operation, bounded to 65 minutes',()=>{
    const now=Date.now();const state=nextContinuationState(initial,call('long'),null,now);
    expect(pendingContinuation(state,answer(['long']),now+60*60000)).not.toBeNull();
    expect(pendingContinuation(state,answer(['long']),now+65*60000)).toBeNull();
  });
  it('recognizes native reasoning and custom tool transcript as the same metered conversation', () => {
    const now=Date.now();
    const output=[{id:'rs_1',type:'reasoning',content:[{type:'reasoning_text',text:'fixture'}]},
      {id:'custom_1',type:'custom_tool_call',call_id:'patch_1',name:'apply_patch',input:'fixture patch'}];
    const result={...call('unused'),output,nativeResponse:{output}};
    const state=nextContinuationState(initial,result,null,now);
    const follow={...initial,input:[{role:'user',content:initial.input},...output,{type:'custom_tool_call_output',call_id:'patch_1',output:'done'}]};
    expect(pendingContinuation(state,follow,now+1000)?.satisfiedCallIds).toEqual(['patch_1']);
    expect(pendingContinuation(state,{...follow,input:follow.input.map(i=>i.type==='reasoning'?{...i,content:[]}:i)},now+1000)).toBeNull();
  });
  it('allows more than eight tool continuations and renews history lifetime', () => {
    const now = Date.now();
    const first = nextContinuationState(initial, call('call-1'), null, now);
    const authorized = pendingContinuation(first, answer(['call-1']), now + 1000);
    expect(authorized?.pendingCallIds).toEqual(['call-1']);
    expect(pendingContinuation(first, answer(['unrelated']), now + 1000)).toBeNull();
    expect(pendingContinuation(first, answer(['call-1', 'call-1']), now + 1000)).toBeNull();
    expect(pendingContinuation(first, answer(['call-1']), now + 65*60_000)).toBeNull();
    let current = authorized;
    for (let count = 1; count <= 100; count++) {
      const state = nextContinuationState(answer([`call-${count}`]), call(`call-${count + 1}`), current, now + count * 60000);
      current = pendingContinuation(state, answer([`call-${count + 1}`]), now + count * 60000);
    }
    expect(current?.pendingCallIds).toEqual(['call-101']);
  });
  it('recognizes official reasoning transport changes while rejecting altered private execution history',()=>{
    const now=Date.now();
    const reasoning={type:'reasoning',id:'rs_official',status:'completed',content:[{type:'reasoning_text',text:'fixture'}],summary:[],encrypted_content:'opaque-fixture'};
    const output=[reasoning,...call('call-official').output];
    const state=nextContinuationState(initial,{...call('unused'),output,nativeResponse:{output}},null,now);
    const {status:_status,...replay}=reasoning;
    const follow={...initial,input:[{role:'user',content:initial.input},{...replay,internal_chat_message_metadata_passthrough:{fixture:true}},output[1],{type:'function_call_output',call_id:'call-official',output:'done'}]};
    expect(pendingContinuation(state,follow,now+1)?.satisfiedCallIds).toEqual(['call-official']);
    for(const changed of [{content:[{type:'reasoning_text',text:'tampered'}]},{encrypted_content:'tampered'},{summary:[{type:'summary_text',text:'tampered'}]}]) expect(pendingContinuation(state,{...follow,input:follow.input.map(i=>i.type==='reasoning'?{...i,...changed}:i)},now+1)).toBeNull();
    expect(pendingContinuation(state,{...follow,input:[...follow.input,{role:'user',content:'new prompt'}]},now+1)).toBeNull();
  });

  it('does not accept ordinary prompts or forged outputs as a continuation', () => {
    const state = nextContinuationState(initial, call('call-1'), null, Date.now());
    expect(pendingContinuation(state, { model: 'mock/mock-chat', input: 'new prompt' }, Date.now())).toBeNull();
    expect(pendingContinuation(state, answer(['call-2']), Date.now())).toBeNull();
    expect(pendingContinuation(state, { model: 'mock/mock-chat', input: [
      ...answer(['call-1']).input, { role: 'user', content: 'Answer a new question' },
    ] }, Date.now())).toBeNull();
    expect(nextContinuationState(initial, { ...call('unused'), output: [{ type: 'message' }] }, null, Date.now())).toEqual({});
  });

  it('accepts the exact accumulated Desktop transcript but rejects appended new prompts', () => {
    const now = Date.now();
    const first = nextContinuationState(initial, call('call-1'), null, now);
    const history = [
      { role: 'user', content: 'Read and write' },
      { type: 'function_call', call_id: 'call-1', name: 'read', arguments: '{}' },
    ];
    const firstOutput = { type: 'function_call_output', call_id: 'call-1', output: 'file content' };
    const followUp = { model: 'mock/mock-chat', tools, input: [...history, firstOutput] };
    expect(pendingContinuation(first, followUp, now + 1000)).not.toBeNull();
    expect(pendingContinuation(first,{...followUp,input:followUp.input.map(item=>item.type==='function_call'?{...item,id:'transport-item',status:'completed'}:item)},now+1000)).not.toBeNull();
    const second = nextContinuationState(followUp, call('call-2'), pendingContinuation(first, followUp, now + 1000), now + 1000);
    const secondOutput = { type: 'function_call_output', call_id: 'call-2', output: 'write completed' };
    expect(pendingContinuation(second, { model: 'mock/mock-chat', tools,
      input: [...followUp.input, { type: 'function_call', call_id: 'call-2', name: 'read', arguments: '{}' }, secondOutput] }, now + 2000)).not.toBeNull();
    expect(pendingContinuation(first, { model: 'mock/mock-chat', tools,
      input: [...history, { role: 'user', content: 'unrelated question' }, firstOutput] }, now + 1000)).toBeNull();
    expect(pendingContinuation(first, { model: 'mock/mock-chat', tools,
      input: [...history, firstOutput, { role: 'user', content: 'unrelated question' }] }, now + 1000)).toBeNull();
  });

  it('keeps other pending calls usable when separate tool results arrive sequentially', () => {
    const now = Date.now();
    const parallel = { ...call('first'), output: [call('first').output[0], call('second').output[0]] };
    const first = nextContinuationState(initial, parallel, null, now);
    const history = [
      { role: 'user', content: 'Read and write' },
      ...parallel.output,
    ];
    const firstOutput = { type: 'function_call_output', call_id: 'first', output: 'read result' };
    const firstRequest = { model: 'mock/mock-chat', tools, input: [...history, firstOutput] };
    const claim = pendingContinuation(first, firstRequest, now + 1000);
    expect(claim?.satisfiedCallIds).toEqual(['first']);
    const afterFirst = nextContinuationState(firstRequest, { ...call('none'), output: [{ type: 'message' }] },
      claim, now + 1000);
    expect(afterFirst.pendingCallIds).toEqual(['second']);
    expect(pendingContinuation(afterFirst, { model: 'mock/mock-chat', tools,
      input: [...firstRequest.input, { type: 'function_call_output', call_id: 'second', output: 'write result' }] },
    now + 2000)?.satisfiedCallIds).toEqual(['second']);
    expect(pendingContinuation(afterFirst, { model: 'mock/mock-chat', tools,
      input: [...firstRequest.input, { role: 'user', content: 'new prompt' },
        { type: 'function_call_output', call_id: 'second', output: 'write result' }] }, now + 2000)).toBeNull();
  });
});
