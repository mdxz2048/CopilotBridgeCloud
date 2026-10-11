import type { CanonicalRequest, ProviderAdapter } from './provider.js';
import { executeNativeResponses, providerHttpFailure } from './native-responses.js';

/** Native Responses only. No tool executor, completion converter or generation retry. */
export class OpenAIProvider implements ProviderAdapter {
  readonly nativeProtocols = ['responses'] as const;
  constructor(private readonly baseUrl: string, private readonly key: string, private readonly timeoutMs: number, private readonly reasoningModels: string[] = []) {}
  executeNative(request: CanonicalRequest, modelId: string, signal: AbortSignal, onEvent?: Parameters<typeof executeNativeResponses>[5]) {
    return executeNativeResponses(this.baseUrl, this.key, request, modelId, signal, onEvent, { responsesProfile: 'openai', canThink: this.reasoningModels.includes(modelId),timeoutMs:this.timeoutMs });
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
