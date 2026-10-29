import type { CanonicalRequest, ProviderAdapter } from './provider.js';
import { executeNativeResponses, providerHttpFailure } from './native-responses.js';
import { ApiError } from './errors.js';

/** Native Responses only. No tool executor, completion converter or generation retry. */
export class OpenAIProvider implements ProviderAdapter {
  readonly nativeProtocols = ['responses'] as const;
  constructor(private readonly baseUrl: string, private readonly key: string, private readonly timeoutMs: number, private readonly reasoningModels: string[] = [], private readonly emptyToolsWorkaround = false) {}
  async executeNative(request: CanonicalRequest, modelId: string, signal: AbortSignal, onEvent?: Parameters<typeof executeNativeResponses>[5]) {
    // Some compatible gateways reject an empty tool list. The placeholder is
    // explicitly disabled; it must never become a client-executable tool.
    let wire=request;
    // Codex may declare native namespace/custom tools inside input rather than
    // the top-level list. GateAI accepts these; disabling them breaks tool use.
    const additionalTools=Array.isArray(request.input)&&request.input.some(item=>item.type==='additional_tools'&&Array.isArray(item.tools)&&item.tools.length>0);
    if(this.emptyToolsWorkaround && !request.tools?.length && !additionalTools) {
      if(request.tool_choice && request.tool_choice!=='auto' && request.tool_choice!=='none')throw new ApiError(422,'UNSUPPORTED_CAPABILITY','空工具列表不能指定工具调用。');
      wire={...request,tools:[{type:'function',name:'bridge_disabled_placeholder',description:'Disabled compatibility placeholder. Never call.',parameters:{type:'object',properties:{},required:[],additionalProperties:false},strict:true}],tool_choice:'none'};
    }
    const placeholder=wire!==request;
    const guard=onEvent?async(type:string,event:Record<string,unknown>,eventSignal?:AbortSignal)=>{
      const item=event.item as Record<string,unknown>|undefined;
      if(placeholder&&item?.type==='function_call')throw new ApiError(502,'PROTOCOL_INVALID','上游未遵守禁止工具调用的要求。');
      await onEvent(type,event,eventSignal);
    }:undefined;
    const result=await executeNativeResponses(this.baseUrl, this.key, wire, modelId, signal, guard, { responsesProfile: 'openai', canThink: this.reasoningModels.includes(modelId),timeoutMs:this.timeoutMs });
    if(placeholder&&result.output.some(item=>item.type==='function_call'||item.type==='custom_tool_call'))throw new ApiError(502,'PROTOCOL_INVALID','上游未遵守禁止工具调用的要求。');
    return result;
  }
  async listModels() {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) { await response.body?.cancel(); throw providerHttpFailure(response.status); }
    const body = await response.json() as { data?: Array<{ id: string }> };
    if (!Array.isArray(body.data) || !body.data.length) throw new Error('EMPTY_MODEL_CATALOG');
    return body.data.filter(item => typeof item.id === 'string').map(item => item.id);
  }
  async health() {
    try { await this.listModels(); return { ready: true }; }
    catch { return { ready: false, reason: 'PROVIDER_CONNECTION_UNAVAILABLE' }; }
  }
  async validateCredential() { const result = await this.health(); return { valid: result.ready, reason: result.reason }; }
  createResponse(request: CanonicalRequest, modelId: string, signal: AbortSignal) { return this.executeNative(request, modelId, signal); }
  resumeSession(request: CanonicalRequest, modelId: string, _sessionId: string, signal: AbortSignal) { return this.executeNative(request, modelId, signal); }
  async closeSession(_sessionId: string) {}
}
