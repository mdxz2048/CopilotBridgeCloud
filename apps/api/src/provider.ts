import { db, providerAccountCredentials, providerAccounts, providerCredentials, providers } from '@bridge/db';
import { and, eq } from 'drizzle-orm';
import { decryptSecret } from './security.js';
import { MockProvider } from './mock-provider.js';
export { MockProvider } from './mock-provider.js';

export type ResponseInput = string | Array<Record<string, unknown>>;
export type CanonicalRequest = { model: string; input: ResponseInput; tools?: Array<Record<string, unknown>>; reasoning?: Record<string, unknown>; stream?: boolean };
export type CanonicalResult = {
  output: Array<Record<string, unknown>>;
  inputTokens: number;
  outputTokens: number;
  providerSessionId?: string;
  costKind: 'UNKNOWN' | 'ESTIMATED' | 'ACTUAL';
  providerCost?: number;
  providerCurrency?: string;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  imageInput?: number;
  imageOutput?: number;
  toolCalls?: number;
  providerReportedUsage?: Record<string, unknown>;
};
export interface ProviderAdapter {
  health(): Promise<{ ready: boolean; reason?: string }>;
  listModels(): Promise<string[]>;
  validateCredential?(): Promise<{ valid: boolean; reason?: string }>;
  createResponse(request: CanonicalRequest, modelId: string, signal: AbortSignal): Promise<CanonicalResult>;
  resumeSession(request: CanonicalRequest, modelId: string, _providerSessionId: string, signal: AbortSignal): Promise<CanonicalResult>;
  closeSession(_providerSessionId: string): Promise<void>;
}

type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_call_id?: string; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> };
function toMessages(input: ResponseInput): ChatMessage[] {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  return input.map(item => {
    if (item.type === 'function_call_output') return { role: 'tool', content: String(item.output ?? ''), tool_call_id: String(item.call_id ?? '') };
    if (item.type === 'function_call') return { role: 'assistant', content: null, tool_calls: [{ id: String(item.call_id ?? ''), type: 'function', function: { name: String(item.name ?? ''), arguments: String(item.arguments ?? '{}') } }] };
    const role = item.role === 'system' || item.role === 'assistant' ? item.role : 'user';
    const content = typeof item.content === 'string' ? item.content : JSON.stringify(item.content ?? '');
    return { role, content };
  });
}
export class DeepSeekProvider implements ProviderAdapter {
  constructor(private baseUrl: string, private key: string, private timeoutMs: number) {}
  async health() {
    try { const r = await fetch(`${this.baseUrl}/models`, { headers: { Authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(this.timeoutMs) }); return { ready: r.ok, reason: r.ok ? undefined : `HTTP ${r.status}` }; }
    catch { return { ready: false, reason: 'UNREACHABLE' }; }
  }
  async listModels() {
    const r = await fetch(`${this.baseUrl}/models`, { headers: { Authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!r.ok) throw new Error(`Provider returned ${r.status}`);
    const body = await r.json() as { data?: Array<{ id: string }> };
    return body.data?.map(m => m.id) ?? [];
  }
  async validateCredential() { const status = await this.health(); return { valid: status.ready, reason: status.reason }; }
  async createResponse(request: CanonicalRequest, modelId: string, signal: AbortSignal): Promise<CanonicalResult> {
    const tools = request.tools?.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters ?? {} } }));
    const r = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ model: modelId, messages: toMessages(request.input), tools: tools?.length ? tools : undefined, stream: false }),
    });
    if (!r.ok) throw new Error(`Provider returned ${r.status}`);
    const body = await r.json() as { choices?: Array<{ message: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } };
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error('Empty provider response');
    const output: Array<Record<string, unknown>> = [];
    if (message.content) output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: message.content }] });
    for (const call of message.tool_calls ?? []) output.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    return { output, inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0,
      cachedInputTokens: body.usage?.prompt_cache_hit_tokens ?? 0, reasoningTokens: body.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      toolCalls: message.tool_calls?.length ?? 0, providerReportedUsage: body.usage as Record<string, unknown> | undefined, costKind: 'UNKNOWN' };
  }
  async resumeSession(request: CanonicalRequest, modelId: string, _id: string, signal: AbortSignal) { return this.createResponse(request, modelId, signal); }
  async closeSession() {}
}

export async function providerFor(providerId: string, code: string, connection?: { id: string; userId: string }): Promise<ProviderAdapter> {
  if (code === 'MOCK') return new MockProvider();
  const [provider] = await db.select().from(providers).where(eq(providers.id, providerId)).limit(1);
  if (!provider?.enabled) throw new Error('PROVIDER_UNAVAILABLE');
  const [account] = connection ? await db.select().from(providerAccounts).where(and(eq(providerAccounts.id, connection.id), eq(providerAccounts.userId, connection.userId),
    eq(providerAccounts.providerId, providerId), eq(providerAccounts.ownership, 'BYOS'), eq(providerAccounts.status, 'ACTIVE'))).limit(1) : [];
  if (connection && !account) throw new Error('PROVIDER_AUTH_REQUIRED');
  const [credential] = account
    ? await db.select().from(providerAccountCredentials).where(eq(providerAccountCredentials.accountId, account.id)).limit(1)
    : await db.select().from(providerCredentials).where(eq(providerCredentials.providerId, providerId)).limit(1);
  if (!credential) throw new Error('PROVIDER_UNAVAILABLE');
  const key = decryptSecret(credential);
  if (code === 'DEEPSEEK') return new DeepSeekProvider(provider.baseUrl ?? 'https://api.deepseek.com', key, provider.timeoutMs);
  throw new Error('PROVIDER_UNAVAILABLE');
}
