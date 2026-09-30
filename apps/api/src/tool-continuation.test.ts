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

describe('bounded tool continuation', () => {
  it('allows a pending same-thread tool result and bounds the chain and lifetime', () => {
    const now = Date.now();
    const first = nextContinuationState(initial, call('call-1'), null, now);
    const authorized = pendingContinuation(first, answer(['call-1']), now + 1000);
    expect(authorized?.remaining).toBe(8);
    expect(pendingContinuation(first, answer(['unrelated']), now + 1000)).toBeNull();
    expect(pendingContinuation(first, answer(['call-1', 'call-1']), now + 1000)).toBeNull();
    expect(pendingContinuation(first, answer(['call-1']), now + 300_000)).toBeNull();
    let current = authorized;
    for (let count = 1; count <= 8; count++) {
      const state = nextContinuationState(answer([`call-${count}`]), call(`call-${count + 1}`), current, now + count * 1000);
      current = pendingContinuation(state, answer([`call-${count + 1}`]), now + count * 1000);
    }
    expect(current).toBeNull();
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
