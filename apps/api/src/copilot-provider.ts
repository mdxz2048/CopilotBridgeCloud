import { CopilotClient, type ModelInfo } from '@github/copilot-sdk';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CanonicalRequest, CanonicalResult, ProviderAdapter, ResponseInput } from './provider.js';

export type CopilotFailureCode = 'PROVIDER_AUTH_REQUIRED' | 'COPILOT_AUTH_EXPIRED' | 'COPILOT_NOT_ENTITLED'
  | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'GATEWAY_TIMEOUT' | 'COPILOT_USAGE_UNAVAILABLE' | 'MODEL_NOT_AVAILABLE';
export class CopilotFailure extends Error {
  constructor(public readonly status: number, public readonly code: CopilotFailureCode) { super(code); }
}

export function mapCopilotFailure(error: unknown, aborted = false): CopilotFailure {
  if (error instanceof CopilotFailure) return error;
  if (aborted) return new CopilotFailure(504, 'GATEWAY_TIMEOUT');
  const message = error instanceof Error ? error.message : String(error);
  if (/\b401\b|unauthorized|invalid.token|not authenticated/i.test(message)) return new CopilotFailure(401, 'COPILOT_AUTH_EXPIRED');
  if (/copilot.*(not.entitled|not.enabled|subscription|required)|not.entitled|no.copilot.subscription/i.test(message))
    return new CopilotFailure(403, 'COPILOT_NOT_ENTITLED');
  if (/\b429\b|rate.limit|too.many.requests/i.test(message)) return new CopilotFailure(429, 'RATE_LIMITED');
  if (/\b403\b|forbidden/i.test(message)) return new CopilotFailure(403, 'COPILOT_NOT_ENTITLED');
  if (/timeout|timed.out|deadline.exceeded/i.test(message)) return new CopilotFailure(504, 'GATEWAY_TIMEOUT');
  return new CopilotFailure(503, 'PROVIDER_UNAVAILABLE');
}

type UsageCall = { model: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number;
  cacheWriteTokens?: number; reasoningTokens?: number; cost?: number; apiCallId?: string;
  providerCallId?: string; serviceRequestId?: string };
const safeCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647;
export function summarizeCopilotUsage(calls: UsageCall[]) {
  if (!calls.length || calls.some(call => !safeCount(call.inputTokens) || !safeCount(call.outputTokens)))
    throw new CopilotFailure(503, 'COPILOT_USAGE_UNAVAILABLE');
  const sum = (key: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'reasoningTokens') =>
    calls.reduce((value, call) => value + (safeCount(call[key]) ? call[key]! : 0), 0);
  const inputTokens = sum('inputTokens');
  const outputTokens = sum('outputTokens');
  const cachedInputTokens = sum('cacheReadTokens');
  const reasoningTokens = sum('reasoningTokens');
  if (![inputTokens, outputTokens, cachedInputTokens, reasoningTokens].every(safeCount)
    || cachedInputTokens > inputTokens || reasoningTokens > outputTokens)
    throw new CopilotFailure(503, 'COPILOT_USAGE_UNAVAILABLE');
  return { inputTokens, outputTokens, cachedInputTokens, reasoningTokens };
}

function promptFrom(input: ResponseInput): string {
  if (typeof input === 'string') return input;
  return input.map(item => {
    const role = item.type === 'function_call_output' ? 'tool' : item.role === 'system' || item.role === 'assistant' ? item.role : 'user';
    const content = item.type === 'function_call_output' ? item.output : item.content ?? item.output ?? '';
    return `${role}: ${typeof content === 'string' ? content : JSON.stringify(content)}`;
  }).join('\n');
}

export class CopilotProvider implements ProviderAdapter {
  constructor(private readonly token: string, private readonly timeoutMs: number) {}

  private async withClient<T>(run: (client: CopilotClient) => Promise<T>): Promise<T> {
    const parent = process.platform === 'linux' && existsSync('/dev/shm') ? '/dev/shm' : tmpdir();
    const baseDirectory = await mkdtemp(join(parent, 'bridge-copilot-'));
    const client = new CopilotClient({ mode: 'empty', baseDirectory, gitHubToken: this.token,
      useLoggedInUser: false, logLevel: 'none', workingDirectory: baseDirectory });
    try { await client.start(); return await run(client); }
    finally { await client.stop().catch(() => []); await rm(baseDirectory, { recursive: true, force: true }); }
  }

  async discover(): Promise<{ authenticated: boolean; login?: string; models: ModelInfo[] }> {
    try {
      return await this.withClient(async client => {
        const auth = await client.getAuthStatus();
        if (!auth.isAuthenticated) throw new CopilotFailure(401, 'COPILOT_AUTH_EXPIRED');
        const models = (await client.listModels()).filter(model => model.policy?.state !== 'disabled');
        if (!models.length) throw new CopilotFailure(403, 'COPILOT_NOT_ENTITLED');
        return { authenticated: true, login: auth.login, models };
      });
    } catch (error) { throw mapCopilotFailure(error); }
  }
  async health() {
    try { const result = await this.discover(); return { ready: result.authenticated && result.models.length > 0 }; }
    catch (error) { return { ready: false, reason: mapCopilotFailure(error).code }; }
  }
  async listModels() { return (await this.discover()).models.map(model => model.id); }
  async validateCredential() { const status = await this.health(); return { valid: status.ready, reason: status.reason }; }

  async createResponse(request: CanonicalRequest, modelId: string, signal: AbortSignal, onTextDelta?: (delta: string) => void): Promise<CanonicalResult> {
    if (request.tools?.length) throw new CopilotFailure(400, 'MODEL_NOT_AVAILABLE');
    if (signal.aborted) throw new CopilotFailure(504, 'GATEWAY_TIMEOUT');
    try {
      return await this.withClient(async client => {
        const session = await client.createSession({ model: modelId, streaming: Boolean(onTextDelta), enableSessionStore: false,
          availableTools: [], onPermissionRequest: async () => ({ kind: 'reject' }) });
        const calls: UsageCall[] = [];
        const deltas: string[] = [];
        session.on('assistant.usage', event => calls.push({ model: event.data.model, inputTokens: event.data.inputTokens,
          outputTokens: event.data.outputTokens, cacheReadTokens: event.data.cacheReadTokens, cacheWriteTokens: event.data.cacheWriteTokens,
          reasoningTokens: event.data.reasoningTokens, cost: event.data.cost, apiCallId: event.data.apiCallId,
          providerCallId: event.data.providerCallId, serviceRequestId: event.data.serviceRequestId }));
        session.on('assistant.message_delta', event => {
          if (event.data.deltaContent) { deltas.push(event.data.deltaContent); onTextDelta?.(event.data.deltaContent); }
        });
        const abort = () => { void session.abort().catch(() => {}); };
        signal.addEventListener('abort', abort, { once: true });
        try {
          const message = await session.sendAndWait({ prompt: promptFrom(request.input) }, this.timeoutMs);
          if (signal.aborted) throw new CopilotFailure(504, 'GATEWAY_TIMEOUT');
          if (!message?.data.content) throw new CopilotFailure(503, 'PROVIDER_UNAVAILABLE');
          const usage = summarizeCopilotUsage(calls);
          return { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: message.data.content }] }],
            ...usage, providerReportedUsage: { source: 'github-copilot-sdk', calls, streamedDeltaCount: deltas.length },
            costKind: 'UNKNOWN' };
        } finally { signal.removeEventListener('abort', abort); await session.disconnect().catch(() => {}); }
      });
    } catch (error) { throw mapCopilotFailure(error, signal.aborted); }
  }
  async resumeSession(request: CanonicalRequest, modelId: string, _providerSessionId: string, signal: AbortSignal,
    onTextDelta?: (delta: string) => void) { return this.createResponse(request, modelId, signal, onTextDelta); }
  async closeSession() {}
}
