import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepSeekProvider, deepSeekMessages } from './deepseek-provider.js';

afterEach(() => vi.unstubAllGlobals());
describe('DeepSeek agent adapter', () => {
  it('preserves message text and combines parallel function calls before tool results', () => {
    const messages = deepSeekMessages([{ role: 'user', content: [{ type: 'input_text', text: 'Read both files' }] },
      { type: 'function_call', call_id: 'a', name: 'read', arguments: '{"path":"a"}' },
      { type: 'function_call', call_id: 'b', name: 'read', arguments: '{"path":"b"}' },
      { type: 'function_call_output', call_id: 'a', output: 'ONE' },
      { type: 'function_call_output', call_id: 'b', output: 'TWO' }]);
    expect(messages[0].content).toEqual([{ type: 'text', text: 'Read both files' }]);
    expect(messages[1].tool_calls?.map(call => call.id)).toEqual(['a', 'b']);
    expect(messages.slice(2).map(message => message.tool_call_id)).toEqual(['a', 'b']);
  });
  it('delivers text before upstream completion and assembles split tool arguments with final usage', async () => {
    let finish!: () => void;
    const release = new Promise<void>(resolve => { finish = resolve; });
    let sent!: () => void;
    const deltaSeen = new Promise<void>(resolve => { sent = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.thinking).toEqual({ type: 'disabled' });
      expect(body.stream).toBe(true);
      return new Response(new ReadableStream({ async start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
        await release;
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"read","arguments":"{\\"path\\":"}}]}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"test.txt\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":8,"completion_tokens":6}}\n\ndata: [DONE]\n\n'));
        controller.close();
      } }));
    }));
    const provider = new DeepSeekProvider('https://api.deepseek.com', 'fixture-only', 1000);
    const pending = provider.createResponse({ model: 'deepseek-flash', input: 'read', stream: true }, 'deepseek-flash', new AbortController().signal, text => { expect(text).toBe('Hello'); sent(); });
    await deltaSeen; finish();
    const result = await pending;
    expect(result.output[1]).toMatchObject({ type: 'function_call', call_id: 'call_a', name: 'read', arguments: '{"path":"test.txt"}' });
    expect(result.inputTokens).toBe(8);
  });
  it('rejects an interrupted stream rather than reporting successful zero usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')));
    await expect(new DeepSeekProvider('https://api.deepseek.com', 'fixture', 1000).createResponse({ model: 'deepseek-flash', input: 'hi', stream: true },
      'deepseek-flash', new AbortController().signal, () => {})).rejects.toThrow('INCOMPLETE_PROVIDER_STREAM');
  });
});
