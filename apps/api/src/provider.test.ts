import { describe, expect, it } from 'vitest';
import { MockProvider } from './mock-provider.js';

describe('production gated Mock adapter', () => {
  it('passes local tool output back into the continuation', async () => {
    const provider = new MockProvider();
    const first = await provider.createResponse({ model: 'mock/mock-chat', input: 'Read a file', tools: [{ name: 'read', parameters: {} }] }, 'mock-chat', new AbortController().signal);
    expect(first.output[0]).toMatchObject({ type: 'function_call', name: 'read' });
    const callId = String(first.output[0].call_id);
    const second = await provider.resumeSession({ model: 'mock/mock-chat', input: [{ type: 'function_call_output', call_id: callId, output: 'LOCAL-RESULT-549' }] }, 'mock-chat', 'session', new AbortController().signal);
    expect(JSON.stringify(second.output)).toContain('LOCAL-RESULT-549');
  });
  it('continues through two sequential tools before returning their outputs', async () => {
    const provider = new MockProvider();
    const tools = [{ name: 'read', parameters: {} }, { name: 'write', parameters: {} }];
    const first = await provider.createResponse({ model: 'mock/mock-chat', input: 'Use tools', tools }, 'mock-chat', new AbortController().signal);
    expect(first.output[0]).toMatchObject({ type: 'function_call', name: 'read' });
    const one = { type: 'function_call_output', call_id: String(first.output[0].call_id), output: 'LOCAL-RESULT-549' };
    const second = await provider.resumeSession({ model: 'mock/mock-chat', input: [one], tools }, 'mock-chat', 'session', new AbortController().signal);
    expect(second.output[0]).toMatchObject({ type: 'function_call', name: 'write' });
    const two = { type: 'function_call_output', call_id: String(second.output[0].call_id), output: 'WRITE-DONE-550' };
    const final = await provider.resumeSession({ model: 'mock/mock-chat', input: [one, two], tools }, 'mock-chat', 'session', new AbortController().signal);
    expect(JSON.stringify(final.output)).toContain('LOCAL-RESULT-549');
    expect(JSON.stringify(final.output)).toContain('WRITE-DONE-550');
  });
});
