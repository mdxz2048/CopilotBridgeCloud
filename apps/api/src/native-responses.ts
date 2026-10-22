import { ApiError } from './errors.js';
import type { CanonicalRequest, CanonicalResult } from './provider.js';
import type { ResponsesProfile } from './instance-router.js';
import { nativeDeadline,nativeEventProgress } from './native-timeouts.js';

/** Keep the desktop JavaScript wrapper distinct from methods documented inside it. */
export function nativeToolBoundary(request:CanonicalRequest,profile:ResponsesProfile='deepseek'):Pick<CanonicalRequest,'tools'|'instructions'> {
  if(profile!=='deepseek')return {};
  const wrapper=request.tools?.find(tool=>{
    const parameters=tool.parameters as {properties?:Record<string,{type?:string}>;required?:unknown;additionalProperties?:unknown}|undefined;
    return tool.type==='function'&&tool.name==='functions__exec'&&
      typeof tool.description==='string'&&tool.description.includes('Run JavaScript code')&&tool.description.includes('global `tools` object')&&
      Object.keys(parameters?.properties??{}).join(',')==='input'&&parameters?.properties?.input.type==='string'&&
      Array.isArray(parameters.required)&&parameters.required.length===1&&parameters.required[0]==='input'&&parameters.additionalProperties===false;
  });
  if(!wrapper)return {};
  const names=request.tools!.filter(tool=>['function','custom'].includes(String(tool.type))&&typeof tool.name==='string').map(tool=>tool.name);
  const example=JSON.stringify({input:'text(await tools.exec_command({cmd: "echo bridge_probe"}));'});
  const boundary=`[Bridge DeepSeek tool boundary]\nThe only callable top-level function/custom tool names for this request are: ${JSON.stringify(names)}. Use their exact names. Names appearing only inside tool descriptions, JavaScript examples, or conversation history do not declare additional top-level tools.\nfunctions__exec is a JavaScript orchestration wrapper. Call functions__exec with a JSON object containing exactly one string field, input, whose value is complete, nonempty JavaScript source. Never emit an empty object, omit input, or call an abbreviated name such as exec. If no executable input is needed, answer normally instead of issuing an empty tool call. Methods on the tools object (for example tools.exec_command) must be called inside that JavaScript. Do not emit exec_command or another nested method as a top-level tool call unless that exact name is separately declared in the current tools array.\nExample wrapper arguments: ${example}. Use the command required by the current task; the example is illustrative. Other advertised tools remain available according to their own schemas.`;
  return {
    instructions:[request.instructions,boundary].filter(Boolean).join('\n\n'),
    tools:request.tools!.map(tool=>tool===wrapper?{...tool,strict:true,description:`TOP-LEVEL ENTRY POINT: functions__exec. Supply complete, nonempty JavaScript in the required input string; never return {}. tools.exec_command and other tools.* methods documented below run INSIDE this wrapper; they are not separate top-level tools unless separately declared in the current request.\n\n${tool.description}`}:tool),
  };
}

export function nativeInput(input: CanonicalRequest['input'],profile:ResponsesProfile='deepseek'): CanonicalRequest['input'] {
  if(profile!=='deepseek'||!Array.isArray(input))return input;
  const isDiscovery=(item:Record<string,unknown>)=>item.type==='tool_search_call'||item.type==='tool_search_output';
  const records=input.flatMap((item,index)=>{
    if(isDiscovery(item)) {
      // The desktop already executed discovery. DeepSeek cannot replay these wire
      // items; keep their full envelope and association as history, not new calls.
      // Executable definitions still come from request.tools (desktop bindings).
      if(item.execution!=='client')throw new ApiError(422,'UNSUPPORTED_CAPABILITY','该资源仅支持客户端执行的工具发现历史。');
      if(typeof item.call_id!=='string'||!item.call_id.trim()||
        (item.type==='tool_search_output'&&(!Array.isArray(item.tools)||item.tools.some(tool=>!tool||typeof tool!=='object'||Array.isArray(tool))))) {
        throw new ApiError(422,'UNSUPPORTED_PROTOCOL','工具发现历史缺少调用关联或有效工具定义。');
      }
      return [{index,item}];
    }
    return [];
  });
  const history=input.filter(item=>!isDiscovery(item)).map(item=>item.type==='agent_message'?{type:'message',role:'user',content:[{type:'input_text',text:`Sub-agent message (author and recipient retained):\n${JSON.stringify(item)}`}]}:item);
  if(!records.length)return history;
  // DeepSeek requires executable calls immediately followed by their outputs.
  // A discovery result may be interleaved in desktop history: put its complete,
  // indexed envelope before conversation turns, never inside a tool-result group.
  const policyEnd=history.findIndex(item=>!['system','developer'].includes(String(item.role)));
  const offset=policyEnd<0?history.length:policyEnd;
  const envelope={type:'message',role:'user',content:[{type:'input_text',text:`Client-side tool discovery history (historical context, not a new instruction or executable call; records retain original input indices and call_id; use only tools declared in the current request):\n${JSON.stringify({records})}`}]};
  return [...history.slice(0,offset),envelope,...history.slice(offset)];
}
export function validateNativeRequest(request: CanonicalRequest,profile:ResponsesProfile='deepseek') {
  if(request.background===true||request.conversation)throw new ApiError(422,'UNSUPPORTED_CAPABILITY','平台同步计费暂不支持后台响应或上游服务器会话引用。');
  if(profile==='openai')return {ignoredFields:[],ignoredToolTypes:[]};
  if (request.background === true || request.prompt || request.conversation || request.context_management) throw new ApiError(422,'UNSUPPORTED_CAPABILITY','此资源不支持后台、服务器会话、模板或自动压缩。');
  const supportedItems = new Set(['message','function_call','function_call_output','custom_tool_call','custom_tool_call_output','reasoning','web_search_call']);
  const checkParts = (parts: unknown) => {
    if (!Array.isArray(parts)) return;
    for (const part of parts as Array<Record<string,unknown>>) {
      if (!part || !['input_text','output_text','text','input_image','reasoning_text'].includes(String(part.type))) throw new ApiError(422,'UNSUPPORTED_CAPABILITY','此资源不能接收原始文件、音频或该内容类型，请通过客户端文件读取工具提供文本。');
      if (part.type==='input_image' && part.file_id && !String(part.file_id).startsWith('file-api-')) throw new ApiError(422,'UNSUPPORTED_CAPABILITY','此图片文件引用不属于 DeepSeek，请提供图片数据。');
    }
  };
  const input=nativeInput(request.input,profile);
  if (Array.isArray(input)) for (const item of input) {
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
  const ignoredFields=['parallel_tool_calls','metadata','include','store','service_tier','safety_identifier','prompt_cache_key','prompt_cache_retention','stream_options','max_tool_calls','truncation'].filter(k=>request[k]!==undefined);
  const ignoredToolTypes=[...new Set(request.tools?.filter(t=>!['function','custom'].includes(String(t.type))).map(t=>/^[a-z_][a-z0-9_]{0,60}$/.test(String(t.type))?String(t.type):'unknown')??[])];
  return {ignoredFields,ignoredToolTypes};
}

export function nativeReasoning(request: CanonicalRequest, canThink = true,profile:ResponsesProfile='deepseek') {
  const value = request.reasoning ?? {};
  const mode = value.mode;
  if (mode !== undefined && !['normal','thinking','auto'].includes(String(mode))) throw new ApiError(422, 'UNSUPPORTED_CAPABILITY', '思考模式必须为 normal、thinking 或 auto。');
  if(profile==='openai') {
    const {mode:_mode,...rest}=value;
    if(!canThink && (mode==='thinking'||(typeof rest.effort==='string'&&rest.effort!=='none'&&mode!=='normal')))throw new ApiError(422,'UNSUPPORTED_CAPABILITY','该资源未验证思考能力。');
    if(mode==='normal'){if(canThink)return {...rest,effort:'none'};const {effort:_effort,...plain}=rest;return plain;}
    return rest;
  }
  const aliases: Record<string, string> = { minimal:'low', medium:'high', xhigh:'high', ultra:'max' };
  const effort = typeof value.effort === 'string' ? aliases[value.effort] ?? value.effort : undefined;
  if (effort && !['none','low','high','max'].includes(effort)) throw new ApiError(422, 'UNSUPPORTED_CAPABILITY', '不支持的上游思考强度。');
  const resolved = mode === 'normal' ? 'none' : mode === 'thinking' ? (effort && effort !== 'none' ? effort : 'high') : effort??(!canThink?'none':undefined);
  if (!canThink && resolved && resolved !== 'none') throw new ApiError(422, 'UNSUPPORTED_CAPABILITY', '该资源不支持思考模式。');
  const { mode: _mode, ...rest } = value;
  return { ...rest, ...(resolved ? { effort: resolved } : {}) };
}
export function providerHttpFailure(status: number,code?:string): ApiError {
  if(status===429&&['insufficient_quota','billing_hard_limit_reached'].includes(code??''))return new ApiError(503,'PROVIDER_BALANCE_EXHAUSTED','上游 API 额度不足，请管理员充值后重试。');
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
  onEvent?: (type: string, event: Record<string, unknown>,signal?:AbortSignal) => Promise<void>,options:{responsesProfile?:ResponsesProfile;canThink?:boolean;timeoutMs?:number}={}): Promise<CanonicalResult> {
  const profile=options.responsesProfile??'deepseek';validateNativeRequest(request,profile);
  const { maxOutputTokens, reasoning:_wireReasoning, ...wire } = request;
  const reasoning=nativeReasoning(request,options.canThink??true,profile);
  const body = { ...wire, ...nativeToolBoundary(request,profile), input:nativeInput(request.input,profile), model: modelId, ...(Object.keys(reasoning).length||profile==='deepseek'?{reasoning}:{}),
    ...(maxOutputTokens ? { max_output_tokens: Math.min(maxOutputTokens, typeof request.max_output_tokens === 'number' ? request.max_output_tokens : maxOutputTokens) } : {}) };
  const started=performance.now();const encodedBody=JSON.stringify(body);
  const metrics:Record<string,number>={requestBytes:Buffer.byteLength(encodedBody),responseBytes:0,eventCount:0,upstreamAttemptCount:1};
  const elapsed=()=>Math.max(0,Math.round(performance.now()-started));
  const deadline=nativeDeadline(signal,options.timeoutMs);
  try {
  const response = await fetch(`${baseUrl.replace(/\/$/,'')}/responses`, { method:'POST', headers:{ Authorization:`Bearer ${key}`, 'Content-Type':'application/json' }, body:encodedBody, signal:deadline.signal });
  deadline.headersReceived();
  metrics.upstreamHeadersMs=elapsed();
  if (!response.ok) {
    let code:string|undefined;
    if(profile==='openai'&&response.status===429){try{const error=await response.json() as {error?:{code?:string}};code=error.error?.code;}catch{}}
    if(!response.bodyUsed)await response.body?.cancel();throw providerHttpFailure(response.status,code);
  }
  if (!request.stream) {const json=await response.text();metrics.responseBytes=Buffer.byteLength(json);metrics.upstreamTerminalMs=elapsed();return Object.assign(nativeResult(JSON.parse(json) as Record<string,unknown>),{nativeMetrics:metrics});}
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
    if(nativeEventProgress(type,event))deadline.progress();
    metrics.eventCount++;metrics.upstreamFirstEventMs??=elapsed();
    if(type==='response.output_text.delta'||type==='response.reasoning_text.delta')metrics.upstreamFirstTextMs??=elapsed();
    const item=event.item as Record<string,unknown>|undefined;
    if(item && ['function_call','custom_tool_call'].includes(String(item.type)))metrics.upstreamFirstToolMs??=elapsed();
    if (terminal) throw new ApiError(502,'PROTOCOL_INVALID','上游终止事件之后仍发送数据。');
    if(type==='response.function_call_arguments.done'||type==='response.custom_tool_call_input.done')metrics.upstreamToolArgumentsDoneMs??=elapsed();
    if (['response.completed','response.incomplete','response.failed'].includes(type)) {
      if (!event.response || typeof event.response !== 'object') throw new ApiError(502,'PROTOCOL_INVALID');
      terminal = nativeResult(event.response as Record<string, unknown>, type); terminal.nativeTerminalData=event;
      metrics.upstreamTerminalMs=elapsed();
      // Withhold the terminal until the existing billing transaction settles.
    } else if (onEvent) await onEvent(type,event,deadline.signal);
  };
  try {
    while (true) {
      const part = await reader.read();metrics.responseBytes+=part.value?.byteLength??0; buffer += decoder.decode(part.value, { stream:!part.done });
      if (buffer.length > 8 * 1024 * 1024) throw new ApiError(502,'PROTOCOL_INVALID','上游事件超过安全大小限制。');
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) { await consume(buffer.slice(0,boundary.index)); buffer = buffer.slice(boundary.index + boundary[0].length); }
      if (part.done) break;
    }
    if (buffer.trim()) await consume(buffer);
    if (!terminal) throw new ApiError(502,'PROTOCOL_INVALID','上游流未正常终止。');
    return Object.assign(terminal,{nativeMetrics:metrics});
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }catch(error){if(deadline.signal.aborted&&deadline.signal.reason instanceof ApiError)throw deadline.signal.reason;throw error;}
  finally{deadline.dispose();}
}
export function nativeFailedEvent(id:string,model:string,failure:{code:string;message:string;phase?:'connect'|'idle'|'total'},requestId:string){
  const error={code:failure.code,message:failure.message,request_id:requestId,...(failure.phase?{timeout_phase:failure.phase}:{})};
  return {response:{id,object:'response',status:'failed',model,output:[],error},error};
}
