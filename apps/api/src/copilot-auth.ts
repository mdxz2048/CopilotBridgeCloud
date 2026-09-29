import type { FastifyInstance, FastifyRequest } from 'fastify';
import { auditLogs, db, providerCredentials, providers } from '@bridge/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { admin } from './core.js';
import { CopilotProvider } from './copilot-provider.js';
import { decryptSecret, encryptSecret } from './security.js';

const deviceEndpoint = 'https://github.com/login/device/code';
const tokenEndpoint = 'https://github.com/login/oauth/access_token';
const deviceResponse = z.object({
  device_code: z.string().min(1).max(4096), user_code: z.string().min(1).max(100),
  verification_uri: z.url(), expires_in: z.number().int().positive().max(900),
  interval: z.number().int().positive().max(120).optional(),
});
const tokenResponse = z.object({
  access_token: z.string().min(1).max(4096).optional(),
  token_type: z.string().optional(),
  error: z.enum(['authorization_pending', 'slow_down', 'expired_token', 'access_denied',
    'incorrect_device_code', 'incorrect_client_credentials', 'unsupported_grant_type']).optional(),
});
export type CopilotAuthStatus = {
  status: 'NOT_CONFIGURED' | 'NOT_AUTHENTICATED' | 'PENDING' | 'VERIFYING' | 'AUTHENTICATED' | 'ERROR';
  login?: string; userCode?: string; verificationUri?: string; expiresAt?: string; message?: string;
};
type Discovery = { authenticated: boolean; login?: string; models: Array<{ id: string }> };
type Dependencies = {
  clientId?: string; fetcher: typeof fetch;
  discover: (token: string) => Promise<Discovery>;
  loadCredential: () => Promise<string | null>;
  saveCredential: (token: string, actorId: string, login: string | undefined, modelCount: number) => Promise<void>;
  wait: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
};
type Flow = { deviceCode: string; actorId: string; controller: AbortController; expiresAt: number;
  intervalMs: number; status: CopilotAuthStatus };

function safeMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return ['COPILOT_AUTH_EXPIRED', 'COPILOT_NOT_ENTITLED', 'PROVIDER_AUTH_REQUIRED',
    'RATE_LIMITED', 'GATEWAY_TIMEOUT', 'PROVIDER_UNAVAILABLE'].includes(code) ? code : 'COPILOT_AUTH_FAILED';
}
function verificationUrl(value: string) {
  const url = new URL(value);
  if (url.origin !== 'https://github.com' || url.pathname !== '/login/device' || url.search || url.hash)
    throw new Error('GITHUB_DEVICE_RESPONSE_INVALID');
  return url.href;
}
function defaultWait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, ms);
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener('abort', aborted, { once: true });
  });
}

export class CopilotAuthService {
  private flow: Flow | null = null;
  private starting: Promise<CopilotAuthStatus> | null = null;
  private startingController: AbortController | null = null;
  private lastError: CopilotAuthStatus | null = null;
  private verified: { login?: string; until: number } | null = null;
  constructor(private readonly deps: Dependencies) {}

  private async github(url: string, data: Record<string, string>, signal: AbortSignal): Promise<unknown> {
    const response = await this.deps.fetcher(url, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Copilot-Bridge-Cloud' }, body: new URLSearchParams(data), signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('GITHUB_HTTP_ERROR');
    return response.json();
  }

  async status(): Promise<CopilotAuthStatus> {
    if (this.flow) {
      if (this.deps.now() >= this.flow.expiresAt) this.fail(this.flow, 'EXPIRED');
      else return this.flow.status;
    }
    if (this.lastError) return this.lastError;
    try {
      const token = await this.deps.loadCredential();
      if (!token) return { status: this.deps.clientId ? 'NOT_AUTHENTICATED' : 'NOT_CONFIGURED' };
      if (this.verified && this.verified.until > this.deps.now()) return { status: 'AUTHENTICATED', login: this.verified.login };
      const discovered = await this.deps.discover(token);
      if (!discovered.authenticated || !discovered.models.length) return { status: 'NOT_AUTHENTICATED' };
      this.verified = { login: discovered.login, until: this.deps.now() + 30000 };
      return { status: 'AUTHENTICATED', login: discovered.login };
    } catch (error) {
      const message = safeMessage(error);
      return message === 'COPILOT_AUTH_EXPIRED' || message === 'COPILOT_NOT_ENTITLED'
        ? { status: 'NOT_AUTHENTICATED', message } : { status: 'ERROR', message };
    }
  }

  async start(actorId: string): Promise<CopilotAuthStatus> {
    if (!this.deps.clientId) return { status: 'NOT_CONFIGURED' };
    if (this.flow && this.deps.now() < this.flow.expiresAt) return this.flow.status;
    if (this.starting) return this.starting;
    if (this.flow) this.fail(this.flow, 'EXPIRED');
    this.lastError = null;
    const controller = new AbortController();
    this.startingController = controller;
    const start = (async (): Promise<CopilotAuthStatus> => {
      try {
        const response = deviceResponse.parse(await this.github(deviceEndpoint, {
          client_id: this.deps.clientId!, scope: 'read:user',
        }, controller.signal));
        if (controller.signal.aborted) throw new Error('GITHUB_DEVICE_START_CANCELLED');
        const expiresAt = this.deps.now() + response.expires_in * 1000;
        const flow: Flow = { deviceCode: response.device_code, actorId, controller, expiresAt,
          intervalMs: Math.max(5000, (response.interval ?? 5) * 1000),
          status: { status: 'PENDING', userCode: response.user_code,
            verificationUri: verificationUrl(response.verification_uri), expiresAt: new Date(expiresAt).toISOString() } };
        this.flow = flow;
        queueMicrotask(() => { void this.poll(flow); });
        return flow.status;
      } catch {
        this.lastError = { status: 'ERROR', message: 'GITHUB_DEVICE_START_FAILED' };
        return this.lastError;
      }
    })();
    this.starting = start;
    try { return await start; } finally { this.starting = null; this.startingController = null; }
  }

  private fail(flow: Flow, message: string) {
    if (this.flow !== flow) return;
    flow.controller.abort();
    this.flow = null;
    this.lastError = { status: 'ERROR', message };
  }
  private async poll(flow: Flow) {
    try {
      while (this.flow === flow) {
        if (this.deps.now() >= flow.expiresAt) { this.fail(flow, 'EXPIRED'); return; }
        await this.deps.wait(flow.intervalMs, flow.controller.signal);
        if (this.flow !== flow) return;
        if (this.deps.now() >= flow.expiresAt) { this.fail(flow, 'EXPIRED'); return; }
        const response = tokenResponse.parse(await this.github(tokenEndpoint, {
          client_id: this.deps.clientId!, device_code: flow.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }, flow.controller.signal));
        if (response.error === 'authorization_pending') continue;
        if (response.error === 'slow_down') { flow.intervalMs += 5000; continue; }
        if (response.error) { this.fail(flow, response.error.toUpperCase()); return; }
        if (!response.access_token || (response.token_type && response.token_type.toLowerCase() !== 'bearer'))
          throw new Error('GITHUB_TOKEN_RESPONSE_INVALID');
        flow.status = { status: 'VERIFYING', expiresAt: new Date(flow.expiresAt).toISOString() };
        const discovered = await this.deps.discover(response.access_token);
        if (this.flow !== flow) return;
        if (!discovered.authenticated || !discovered.models.length) { this.fail(flow, 'COPILOT_NOT_ENTITLED'); return; }
        await this.deps.saveCredential(response.access_token, flow.actorId, discovered.login, discovered.models.length);
        if (this.flow !== flow) return;
        this.verified = { login: discovered.login, until: this.deps.now() + 30000 };
        this.lastError = null;
        this.flow = null;
        return;
      }
    } catch (error) {
      this.fail(flow, safeMessage(error));
    }
  }

  cancel() {
    this.startingController?.abort();
    if (this.flow) { this.flow.controller.abort(); this.flow = null; }
  }
}

export function createCopilotAuthService(overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = {
    clientId: process.env.COPILOT_GITHUB_CLIENT_ID?.trim(),
    fetcher: fetch, now: Date.now, wait: defaultWait,
    discover: token => new CopilotProvider(token, 60000).discover(),
    loadCredential: async () => {
      const [provider] = await db.select().from(providers).where(eq(providers.code, 'COPILOT')).limit(1);
      if (!provider) return null;
      const [credential] = await db.select().from(providerCredentials).where(eq(providerCredentials.providerId, provider.id)).limit(1);
      return credential ? decryptSecret(credential) : null;
    },
    saveCredential: async (token, actorId, login, modelCount) => {
      const encrypted = encryptSecret(token);
      await db.transaction(async tx => {
        const [provider] = await tx.select().from(providers).where(eq(providers.code, 'COPILOT')).limit(1);
        if (!provider) throw new Error('COPILOT_PROVIDER_NOT_SEEDED');
        await tx.insert(providerCredentials).values({ providerId: provider.id, ...encrypted })
          .onConflictDoUpdate({ target: providerCredentials.providerId, set: { ...encrypted, updatedAt: new Date() } });
        await tx.insert(auditLogs).values({ actorId, action: 'COPILOT_DEVICE_AUTHENTICATED', targetType: 'PROVIDER', targetId: provider.id,
          metadata: { githubLogin: login, discoveredModelCount: modelCount } });
      });
    },
    ...overrides,
  };
  if (deps.clientId && !/^[A-Za-z0-9._-]{6,128}$/.test(deps.clientId)) deps.clientId = undefined;
  return new CopilotAuthService(deps);
}

export async function registerCopilotAuthRoutes(app: FastifyInstance, service = createCopilotAuthService(),
  authorize: (request: FastifyRequest) => Promise<{ user: { id: string } }> = admin) {
  app.post('/api/v1/admin/copilot/auth', async req => {
    const actor = await authorize(req);
    return service.start(actor.user.id);
  });
  app.get('/api/v1/admin/copilot/auth', async req => {
    await authorize(req);
    return service.status();
  });
  app.addHook('onClose', async () => { service.cancel(); });
}
