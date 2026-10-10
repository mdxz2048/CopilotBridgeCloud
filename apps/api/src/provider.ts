import { db, providerAccountCredentials, providerAccounts, providerCredentials, providers } from '@bridge/db';
import { and, eq } from 'drizzle-orm';
import { decryptSecret } from './security.js';
import { MockProvider } from './mock-provider.js';
import { DeepSeekProvider } from './deepseek-provider.js';
export { DeepSeekProvider } from './deepseek-provider.js';
export const isDeepSeekProvider = (code: string) => code === 'DEEPSEEK' || /^DEEPSEEK_[A-F0-9]{12}$/.test(code);
import { CopilotFailure, CopilotProvider } from './copilot-provider.js';
export { MockProvider } from './mock-provider.js';

export type ResponseInput = string | Array<Record<string, unknown>>;
export type CanonicalRequest = { model: string; input: ResponseInput; tools?: Array<Record<string, unknown>>; reasoning?: Record<string, unknown>; stream?: boolean; maxOutputTokens?: number };
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
  createResponse(request: CanonicalRequest, modelId: string, signal: AbortSignal, onTextDelta?: (delta: string) => void): Promise<CanonicalResult>;
  resumeSession(request: CanonicalRequest, modelId: string, _providerSessionId: string, signal: AbortSignal, onTextDelta?: (delta: string) => void): Promise<CanonicalResult>;
  closeSession(_providerSessionId: string): Promise<void>;
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
  if (!credential) throw code === 'COPILOT' ? new CopilotFailure(503, 'PROVIDER_AUTH_REQUIRED') : new Error('PROVIDER_UNAVAILABLE');
  const key = decryptSecret(credential);
  if (code === 'COPILOT') return new CopilotProvider(key, provider.timeoutMs);
  if (isDeepSeekProvider(code)) return new DeepSeekProvider(provider.baseUrl ?? 'https://api.deepseek.com', key, provider.timeoutMs);
  throw new Error('PROVIDER_UNAVAILABLE');
}
