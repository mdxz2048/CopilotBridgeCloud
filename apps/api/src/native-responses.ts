import { ApiError } from './errors.js';
import type { CanonicalRequest, CanonicalResult } from './provider.js';

export function validateNativeRequest(request: CanonicalRequest) {
  if (request.background === true || request.prompt || request.conversation || request.context_management) throw new ApiError(422,'UNSUPPORTED_CAPABILITY','此资源不支持后台、服务器会话、模板或自动压缩。');
  if (request.parallel_tool_calls === false && request.tools?.length) throw new ApiError(422,'UNSUPPORTED_CAPABILITY','DeepSeek 不支持关闭并行工具调用。');
  const supportedItems = new Set(['message','function_call','function_call_output','custom_tool_call','custom_tool_call_output','reasoning','web_search_call']);
  const checkParts = (parts: unknown) => {
    if (!Array.isArray(parts)) return;
    for (const part of parts as Array<Record<string,unknown>>) {
      if (!part || !['input_text','output_text','text','input_image','reasoning_text'].includes(String(part.type))) throw new ApiError(422,'UNSUPPORTED_CAPABILITY','此资源不能接收原始文件、音频或该内容类型，请通过客户端文件读取工具提供文本。');
      if (part.type==='input_image' && part.file_id && !String(part.file_id).startsWith('file-api-')) throw new ApiError(422,'UNSUPPORTED_CAPABILITY','此图片文件引用不属于 DeepSeek，请提供图片数据。');
    }
  };
  if (Array.isArray(request.input)) for (const item of request.input) {
    if (item.type && !supportedItems.has(String(item.type))) throw new ApiError(422,'UNSUPPORTED_PROTOCOL','不支持此历史条目，请提供完整未压缩历史。');
    if (item.type==='reasoning') {
      // DeepSeek returns an opaque sidecar alongside usable plaintext reasoning.
      // Retain both on native replay; the sidecar alone cannot restore history.
      const hasPlaintext = Array.isArray(item.content) && item.content.some(part => part && typeof part === 'object' && part.type === 'reasoning_text' && typeof part.text === 'string' && part.text.length > 0);
      if (!hasPlaintext && (item.encrypted_content || (Array.isArray(item.summary) && item.summary.length))) throw new ApiError(422,'UNSUPPORTED_CAPABILITY','加密或摘要推理历史不能用于该资源，请新建会话。');
    }
    checkParts(item.content); checkParts(item.output);
  }
  const choice=request.tool_choice as Record<string,unknown>|undefined;
  if (choice && typeof choice==='object' && !['function','custom'].includes(String(choice.type))) throw new ApiError(422,'UNSUPPORTED_CAPABILITY','指定的工具不受该资源支持。');
  if ((request.tool_choice === 'required' || (choice && typeof choice === 'object')) && nativeReasoning(request).effort !== 'none') throw new ApiError(422,'UNSUPPORTED_CAPABILITY','DeepSeek 思考模式不支持强制指定工具，请使用 normal 模式或自动工具选择。');
  if (request.tools?.some(t=>t.type==='namespace' || (t.type==='custom' && t.name!=='apply_patch'))) throw new ApiError(422,'UNSUPPORTED_CAPABILITY','工具命名空间或该自定义工具需要 Bridge 适配。');
  const ignoredFields=['metadata','include','store','service_tier','safety_identifier','prompt_cache_key','prompt_cache_retention','stream_options','max_tool_calls','truncation'].filter(k=>request[k]!==undefined);
  const ignoredToolTypes=[...new Set(request.tools?.filter(t=>!['function','custom'].includes(String(t.type))).map(t=>/^[a-z_][a-z0-9_]{0,60}$/.test(String(t.type))?String(t.type):'unknown')??[])];
  return {ignoredFields,ignoredToolTypes};
}

export function nativeReasoning(request: CanonicalRequest, canThink = true) {
  const value = request.reasoning ?? {};
  const mode = value.mode;
  if (mode !== undefined && !['normal','thinking','auto'].includes(String(mode))) throw new ApiError(422, 'UNSUPPORTED_CAPABILITY', '思考模式必须为 normal、thinking 或 auto。');
  const aliases: Record<string, string> = { minimal:'low', medium:'high', xhigh:'high', ultra:'max' };
  const effort = typeof value.effort === 'string' ? aliases[value.effort] ?? value.effort : undefined;
  if (effort && !['none','low','high','max'].includes(effort)) throw new ApiError(422, 'UNSUPPORTED_CAPABILITY', '不支持的上游思考强度。');
  const resolved = mode === 'normal' ? 'none' : mode === 'thinking' ? (effort && effort !== 'none' ? effort : 'high') : effort;
  if (!canThink && resolved && resolved !== 'none') throw new ApiError(422, 'UNSUPPORTED_CAPABILITY', '该资源不支持思考模式。');
  const { mode: _mode, ...rest } = value;
  return { ...rest, ...(resolved ? { effort: resolved } : {}) };
}
export function providerHttpFailure(status: number): ApiError {
  if (status === 429) return new ApiError(503, 'PROVIDER_RATE_LIMITED', '上游模型并发繁忙，请稍后重试。');
  if (status === 401 || status === 403) return new ApiError(503, 'PROVIDER_AUTH_REQUIRED', '上游连接认证失效，请管理员检查。');
  if (status === 402) return new ApiError(503, 'PROVIDER_BALANCE_EXHAUSTED', '上游账号余额不足，请管理员充值。');
  if (status === 400 || status === 422) return new ApiError(422, 'PROTOCOL_INVALID', '上游不支持此请求格式或能力，请查看匿名请求诊断。');
  return new ApiError(503, 'PROVIDER_UNAVAILABLE', '上游服务暂时不可用。');
}
export function nativeResult(response: Record<string, unknown>, terminal?: string): CanonicalResult {
  const usage = response.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } } | undefined;
  if (!Array.isArray(response.output) || !['completed','incomplete','failed'].includes(String(response.status))) throw new ApiError(502, 'PROTOCOL_INVALID');
  const unavailable = !Number.isSafeInteger(usage?.input_tokens) || !Number.isSafeInteger(usage?.output_tokens) || usage!.input_tokens! < 0 || usage!.output_tokens! < 0;
  if (unavailable && response.status !== 'failed') throw new ApiError(502, 'PROVIDER_USAGE_UNAVAILABLE', '上游用量缺失，本次消费需核对。');
  const output = response.output as Array<Record<string, unknown>>;
  return { output, inputTokens: unavailable?0:usage!.input_tokens!, outputTokens: unavailable?0:usage!.output_tokens!, cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0, toolCalls: output.filter(i => ['function_call','custom_tool_call'].includes(String(i.type))).length, usageUnavailable:unavailable,
    providerReportedUsage: usage as Record<string, unknown>, costKind:'UNKNOWN', nativeResponse: response, nativeTerminalEvent: terminal, status: response.status as CanonicalResult['status'] };
}
export async function executeNativeResponses(baseUrl: string, key: string, request: CanonicalRequest, modelId: string, signal: AbortSignal,
  onEvent?: (type: string, event: Record<string, unknown>) => Promise<void>): Promise<CanonicalResult> {
  validateNativeRequest(request);
  const { maxOutputTokens, ...wire } = request;
  const body = { ...wire, model: modelId, reasoning: nativeReasoning(request),
    ...(maxOutputTokens ? { max_output_tokens: Math.min(maxOutputTokens, typeof request.max_output_tokens === 'number' ? request.max_output_tokens : maxOutputTokens) } : {}) };
  const response = await fetch(`${baseUrl.replace(/\/$/,'')}/responses`, { method:'POST', headers:{ Authorization:`Bearer ${key}`, 'Content-Type':'application/json' }, body:JSON.stringify(body), signal });
  if (!response.ok) { await response.body?.cancel(); throw providerHttpFailure(response.status); }
  if (!request.stream) return nativeResult(await response.json() as Record<string, unknown>);
  if (!response.body) throw new ApiError(502,'PROTOCOL_INVALID');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let terminal: CanonicalResult | undefined;
  const consume = async (block: string) => {
    const lines = block.split(/\r?\n/);
    const data = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let event: Record<string, unknown>;
    try { event = JSON.parse(data); } catch { throw new ApiError(502,'PROTOCOL_INVALID','上游流格式无效。'); }
    const type = typeof event.type === 'string' ? event.type : lines.find(l => l.startsWith('event:'))?.slice(6).trim();
    if (!type) throw new ApiError(502,'PROTOCOL_INVALID');
    if (terminal) throw new ApiError(502,'PROTOCOL_INVALID','上游终止事件之后仍发送数据。');
    if (['response.completed','response.incomplete','response.failed'].includes(type)) {
      if (!event.response || typeof event.response !== 'object') throw new ApiError(502,'PROTOCOL_INVALID');
      terminal = nativeResult(event.response as Record<string, unknown>, type); terminal.nativeTerminalData=event;
      // Withhold the terminal until the existing billing transaction settles.
    } else if (onEvent) await onEvent(type, event);
  };
  try {
    while (true) {
      const part = await reader.read(); buffer += decoder.decode(part.value, { stream:!part.done });
      if (buffer.length > 8 * 1024 * 1024) throw new ApiError(502,'PROTOCOL_INVALID','上游事件超过安全大小限制。');
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) { await consume(buffer.slice(0,boundary.index)); buffer = buffer.slice(boundary.index + boundary[0].length); }
      if (part.done) break;
    }
    if (buffer.trim()) await consume(buffer);
    if (!terminal) throw new ApiError(502,'PROTOCOL_INVALID','上游流未正常终止。');
    return terminal;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
