import type { CanonicalRequest, CanonicalResult, ProviderAdapter, ResponseInput } from './provider.js';
import { ApiError } from './errors.js';
import { executeNativeResponses, nativeReasoning, providerHttpFailure } from './native-responses.js';

type Call = { id: string; type: 'function'; function: { name: string; arguments: string } };
type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | unknown[] | null; tool_call_id?: string; tool_calls?: Call[] };
type Usage = { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
type Chunk = { choices?: Array<{ message?: { content?: string; tool_calls?: Call[] }; delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>; usage?: Usage };

export function deepSeekMessages(input: ResponseInput): Message[] {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  const messages: Message[] = [];
  for (const item of input) {
    if (item.type === 'function_call_output') {
      if (typeof item.output !== 'string') throw new ApiError(422,'UNSUPPORTED_CAPABILITY','此转换资源只接收文本工具结果。');
      messages.push({ role: 'tool', content: String(item.output ?? ''), tool_call_id: String(item.call_id ?? '') });
    } else if (item.type === 'function_call') {
      const call: Call = { id: String(item.call_id ?? ''), type: 'function', function: { name: String(item.name ?? ''), arguments: String(item.arguments ?? '{}') } };
      const last = messages.at(-1);
      if (last?.role === 'assistant') (last.tool_calls ??= []).push(call);
      else messages.push({ role: 'assistant', content: null, tool_calls: [call] });
    } else {
      const role = item.role === 'system' || item.role === 'assistant' ? item.role : 'user';
      const parts = Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : null;
      const content = !parts ? String(item.content ?? '') : parts.map(part => {
        if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') return { type: 'text', text: String(part.text ?? '') };
        if (part.type === 'input_image' && typeof part.image_url === 'string') return { type: 'image_url', image_url: { url: part.image_url } };
        throw new ApiError(422,'UNSUPPORTED_CAPABILITY','此资源不支持该输入内容类型。');
      });
      messages.push({ role, content: role === 'user' || typeof content === 'string' ? content : content.map(part => 'text' in part ? part.text : '').join('\n') });
    }
  }
  return messages;
}

export class DeepSeekProvider implements ProviderAdapter {
  readonly nativeProtocols = ['responses','chat_completions'] as const;
  executeNative(request: CanonicalRequest, modelId: string, signal: AbortSignal, onEvent?: (type: string, event: Record<string, unknown>,signal?:AbortSignal) => Promise<void>) {
    return executeNativeResponses(this.baseUrl, this.key, request, modelId, signal, onEvent,{timeoutMs:this.timeoutMs});
  }
  constructor(private readonly baseUrl: string, private readonly key: string, private readonly timeoutMs: number) {}
  private url(path: string) { return `${this.baseUrl.replace(/\/$/, '')}/${path}`; }
  async health() {
    try { await this.listModels(); return { ready: true }; }
    catch (error) { return { ready: false, reason: error instanceof Error ? error.message : 'UNREACHABLE' }; }
  }
  async balance(signal?: AbortSignal) {
    const response = await fetch(this.url('user/balance'), { headers: { Authorization: `Bearer ${this.key}` }, signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const body = await response.json() as { is_available: boolean; balance_infos: Array<{currency:string;total_balance:string;granted_balance:string;topped_up_balance:string}> };
    return { isAvailable: body.is_available, balances: body.balance_infos.map(item => ({ currency:item.currency,total:item.total_balance,granted:item.granted_balance,toppedUp:item.topped_up_balance })), checkedAt: new Date().toISOString() };
  }
  async listModels() {
    const response = await fetch(this.url('models'), { headers: { Authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const body = await response.json() as { data?: Array<{ id: string }> };
    if (!body.data?.length) throw new Error('EMPTY_MODEL_CATALOG');
    return body.data.map(model => model.id);
  }
  async validateCredential() { const state = await this.health(); return { valid: state.ready, reason: state.reason }; }
  async createResponse(request: CanonicalRequest, modelId: string, signal: AbortSignal, onTextDelta?: (delta: string) => void): Promise<CanonicalResult> {
    const known = new Set(['model','input','stream','tools','reasoning','instructions','tool_choice','parallel_tool_calls','text','max_output_tokens','maxOutputTokens']);
    if (Object.keys(request).some(k => !known.has(k)) || request.tools?.some(t => (t.type && t.type !== 'function') || typeof t.name !== 'string')) throw new ApiError(422,'UNSUPPORTED_PROTOCOL','此资源的转换协议不支持该字段或工具类型。');
    // Legacy chat conversion is explicitly non-thinking; native Responses retains all reasoning items.
    if (nativeReasoning(request).effort && nativeReasoning(request).effort !== 'none') throw new ApiError(422,'UNSUPPORTED_CAPABILITY','此旧连接暂未验证思考模式，请使用原生 Responses 资源。');
    const streaming = Boolean(request.stream && onTextDelta);
    const tools = request.tools?.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters ?? {} } }));
    // Stateless replay must not fabricate missing reasoning_content. Start with non-thinking tools.
    const response = await fetch(this.url('chat/completions'), {
      method: 'POST', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ model: modelId, messages: [...(request.instructions ? [{role:'system',content:request.instructions}] : []), ...deepSeekMessages(request.input)], tools: tools?.length ? tools : undefined,
        tool_choice: request.tool_choice, parallel_tool_calls:request.parallel_tool_calls, response_format: (request.text as {format?:unknown}|undefined)?.format,
        thinking: { type: 'disabled' }, ...(request.maxOutputTokens ? {max_tokens:request.maxOutputTokens}:{}), stream: streaming, ...(streaming ? { stream_options: { include_usage: true } } : {}) }),
    });
    if (!response.ok) throw providerHttpFailure(response.status);
    let text = ''; let usage: Usage | undefined; const calls = new Map<number, Call>();
    if (!streaming) {
      const body = await response.json() as Chunk;
      const message = body.choices?.[0]?.message;
      if (!message) throw new Error('EMPTY_PROVIDER_RESPONSE');
      text = message.content ?? ''; usage = body.usage;
      (message.tool_calls ?? []).forEach((call, index) => calls.set(index, call));
    } else {
      if (!response.body) throw new Error('EMPTY_PROVIDER_STREAM');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let completed = false;
      const consume = (block: string) => {
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (!data) return;
        if (data === '[DONE]') { completed = true; return; }
        const chunk = JSON.parse(data) as Chunk;
        if (chunk.usage) usage = chunk.usage;
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) { text += delta.content; onTextDelta!(delta.content); }
        for (const part of delta?.tool_calls ?? []) {
          const call = calls.get(part.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
          call.id += part.id ?? ''; call.function.name += part.function?.name ?? ''; call.function.arguments += part.function?.arguments ?? '';
          calls.set(part.index, call);
        }
      };
      try {
        while (true) {
          const chunk = await reader.read();
          buffer += decoder.decode(chunk.value, { stream: !chunk.done }).replace(/\r\n/g, '\n');
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 2); }
          if (chunk.done) break;
        }
        if (buffer.trim()) consume(buffer);
        if (!completed) throw new Error('INCOMPLETE_PROVIDER_STREAM');
      } finally { reader.releaseLock(); }
    }
    if (!Number.isSafeInteger(usage?.prompt_tokens) || !Number.isSafeInteger(usage?.completion_tokens)) throw new Error('PROVIDER_USAGE_UNAVAILABLE');
    const output: Array<Record<string, unknown>> = [];
    if (text || streaming) output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
    for (const call of calls.values()) {
      if (!call.id || !call.function.name) throw new Error('INVALID_PROVIDER_TOOL_CALL');
      output.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
    return { output, inputTokens: usage!.prompt_tokens!, outputTokens: usage!.completion_tokens!, cachedInputTokens: usage!.prompt_cache_hit_tokens ?? 0,
      reasoningTokens: usage!.completion_tokens_details?.reasoning_tokens ?? 0, toolCalls: calls.size, providerReportedUsage: usage as Record<string, unknown>, costKind: 'UNKNOWN' };
  }
  resumeSession(request: CanonicalRequest, modelId: string, _sessionId: string, signal: AbortSignal, onTextDelta?: (delta: string) => void) {
    return this.createResponse(request, modelId, signal, onTextDelta);
  }
  async closeSession() {}
}
