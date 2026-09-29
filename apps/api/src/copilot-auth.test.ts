import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

process.env.DATABASE_URL ??= 'postgres://localhost/bridge_copilot_auth_test';
process.env.ACCESS_SECRET ??= 'a'.repeat(64);
process.env.REFRESH_TOKEN_PEPPER ??= 'b'.repeat(64);
process.env.PROVIDER_MASTER_KEY ??= 'c'.repeat(64);
process.env.PUBLIC_BASE_URL ??= 'http://localhost:3001';

const { createCopilotAuthService, registerCopilotAuthRoutes } = await import('./copilot-auth.js');
const device = { device_code: 'secret-device-code', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device',
  expires_in: 120, interval: 5 };
const token = 'gho_secret-token-not-to-be-returned';
const json = (value: unknown, status = 200) => Response.json(value, { status });

function fixture(responses: Array<unknown | Response> = [device], clientId = 'Iv1.testclientid') {
  let now = 0;
  let credential: string | null = null;
  const waiters: Array<{ ms: number; resolve: () => void }> = [];
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const discover = vi.fn(async (_token: string) => ({ authenticated: true, login: 'verified-user', models: [{ id: 'gpt-5.4-mini' }] }));
  const saveCredential = vi.fn(async (value: string) => { credential = value; });
  const loadCredential = vi.fn(async () => credential);
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body as URLSearchParams });
    const result = responses.shift();
    if (!result) throw new Error('UNEXPECTED_FETCH');
    return result instanceof Response ? result : json(result);
  }) as unknown as typeof fetch;
  const options = { clientId, fetcher, discover, loadCredential, saveCredential, now: () => now,
    wait: (_ms: number, _signal: AbortSignal) => new Promise<void>(resolve => waiters.push({ ms: _ms, resolve })) };
  return { service: createCopilotAuthService(options), options, calls, waiters, discover, loadCredential, saveCredential,
    advance: (ms: number) => { now += ms; waiters.shift()?.resolve(); }, credential: () => credential };
}

describe('admin Copilot OAuth device flow', () => {
  afterEach(() => vi.restoreAllMocks());

  it('distinguishes missing configuration from a configured but unauthenticated provider', async () => {
    const configured = fixture();
    expect(await configured.service.status()).toEqual({ status: 'NOT_AUTHENTICATED' });
    const missing = fixture([], '');
    expect(await missing.service.status()).toEqual({ status: 'NOT_CONFIGURED' });
    expect(await missing.service.start('admin-id')).toEqual({ status: 'NOT_CONFIGURED' });
    expect(missing.calls).toHaveLength(0);
  });

  it('deduplicates starts, keeps codes and tokens out of responses, respects slow_down, and verifies before saving', async () => {
    const f = fixture([device, { error: 'authorization_pending' }, { error: 'slow_down' },
      { access_token: token, token_type: 'bearer' }]);
    const [first, repeated] = await Promise.all([f.service.start('admin-id'), f.service.start('admin-id')]);
    expect(first).toEqual(repeated);
    expect(first).toMatchObject({ status: 'PENDING', userCode: device.user_code, verificationUri: device.verification_uri });
    expect(JSON.stringify(first)).not.toMatch(/secret-device-code|gho_secret/);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ url: 'https://github.com/login/device/code' });
    expect(f.calls[0].body.get('client_id')).toBe('Iv1.testclientid');
    expect(f.calls[0].body.get('scope')).toBe('read:user');
    await vi.waitFor(() => expect(f.waiters).toHaveLength(1));
    f.advance(5000);
    await vi.waitFor(() => expect(f.waiters).toHaveLength(1));
    expect(f.calls[1].body.get('device_code')).toBe(device.device_code);
    expect(f.calls[1].body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
    f.advance(5000);
    await vi.waitFor(() => expect(f.waiters).toHaveLength(1));
    expect(f.waiters[0].ms).toBe(10000);
    f.advance(10000);
    await vi.waitFor(() => expect(f.saveCredential).toHaveBeenCalledOnce());
    expect(f.discover).toHaveBeenCalledWith(token);
    expect(f.credential()).toBe(token);
    expect(await f.service.status()).toEqual({ status: 'AUTHENTICATED', login: 'verified-user' });
    expect(JSON.stringify(await f.service.status())).not.toContain(token);
    f.service.cancel();
  });

  it('rejects authorization and expires without storing credentials', async () => {
    const refused = fixture([device, { error: 'access_denied' }]);
    await refused.service.start('admin-id');
    await vi.waitFor(() => expect(refused.waiters).toHaveLength(1));
    refused.advance(5000);
    await vi.waitFor(async () => expect(await refused.service.status()).toMatchObject({ status: 'ERROR', message: 'ACCESS_DENIED' }));
    expect(refused.saveCredential).not.toHaveBeenCalled();
    const expired = fixture([{ ...device, expires_in: 5 }]);
    await expired.service.start('admin-id');
    await vi.waitFor(() => expect(expired.waiters).toHaveLength(1));
    expired.advance(5000);
    await vi.waitFor(async () => expect(await expired.service.status()).toMatchObject({ status: 'ERROR', message: 'EXPIRED' }));
    expect(expired.calls).toHaveLength(1);
    expect(expired.saveCredential).not.toHaveBeenCalled();
  });

  it('never stores a token if SDK entitlement verification fails or GitHub HTTP fails', async () => {
    const denied = fixture([device, { access_token: token, token_type: 'bearer' }]);
    denied.discover.mockRejectedValueOnce(new Error('COPILOT_NOT_ENTITLED'));
    await denied.service.start('admin-id');
    await vi.waitFor(() => expect(denied.waiters).toHaveLength(1));
    denied.advance(5000);
    await vi.waitFor(async () => expect(await denied.service.status()).toMatchObject({ status: 'ERROR', message: 'COPILOT_NOT_ENTITLED' }));
    expect(denied.saveCredential).not.toHaveBeenCalled();
    const http = fixture([device, json({ error: 'private GH response' }, 503)]);
    await http.service.start('admin-id');
    await vi.waitFor(() => expect(http.waiters).toHaveLength(1));
    http.advance(5000);
    await vi.waitFor(async () => expect(await http.service.status()).toMatchObject({ status: 'ERROR', message: 'COPILOT_AUTH_FAILED' }));
    expect(JSON.stringify(await http.service.status())).not.toContain('private GH response');
  });

  it('rejects an untrusted verification URL and safely handles a polling timeout', async () => {
    const untrusted = fixture([{ ...device, verification_uri: 'https://example.com/login/device' }]);
    expect(await untrusted.service.start('admin-id')).toEqual({ status: 'ERROR', message: 'GITHUB_DEVICE_START_FAILED' });
    expect(untrusted.calls).toHaveLength(1);
    const timeout = fixture([device]);
    timeout.options.fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/device/code')) return json(device);
      throw new DOMException('private connection failure', 'TimeoutError');
    }) as typeof fetch;
    const service = createCopilotAuthService(timeout.options);
    await service.start('admin-id');
    await vi.waitFor(() => expect(timeout.waiters).toHaveLength(1));
    timeout.advance(5000);
    await vi.waitFor(async () => expect(await service.status()).toEqual({ status: 'ERROR', message: 'COPILOT_AUTH_FAILED' }));
    expect(timeout.saveCredential).not.toHaveBeenCalled();
  });

  it('cancels an unfinished flow without polling or persisting after shutdown', async () => {
    const f = fixture([device, { access_token: token, token_type: 'bearer' }]);
    await f.service.start('admin-id');
    await vi.waitFor(() => expect(f.waiters).toHaveLength(1));
    f.service.cancel();
    f.advance(5000);
    await vi.waitFor(() => expect(f.calls).toHaveLength(1));
    expect(f.saveCredential).not.toHaveBeenCalled();
  });

  it('restores authenticated status from stored credentials after restart without enabling provider', async () => {
    const f = fixture();
    const saved = vi.fn(async () => token);
    const restarted = createCopilotAuthService({ ...f.options, clientId: undefined, loadCredential: saved });
    expect(await restarted.status()).toEqual({ status: 'AUTHENTICATED', login: 'verified-user' });
    expect(saved).toHaveBeenCalledOnce();
    expect(f.discover).toHaveBeenCalledWith(token);
    expect(await restarted.start('admin-id')).toEqual({ status: 'NOT_CONFIGURED' });
  });

  it('restricts both endpoints to admins before initiating or reading a flow', async () => {
    const f = fixture();
    const app = Fastify();
    await registerCopilotAuthRoutes(app, f.service, async req => {
      if (req.headers['x-test-role'] !== 'ADMIN') throw Object.assign(new Error('FORBIDDEN'), { statusCode: 403 });
      return { user: { id: 'admin-id' } };
    });
    try {
      expect((await app.inject({ method: 'POST', url: '/api/v1/admin/copilot/auth' })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: '/api/v1/admin/copilot/auth' })).statusCode).toBe(403);
      expect(f.calls).toHaveLength(0);
      const started = await app.inject({ method: 'POST', url: '/api/v1/admin/copilot/auth', headers: { 'x-test-role': 'ADMIN' } });
      expect(started.json()).toMatchObject({ status: 'PENDING', userCode: device.user_code });
      expect(started.body).not.toContain(device.device_code);
      expect((await app.inject({ method: 'GET', url: '/api/v1/admin/copilot/auth', headers: { 'x-test-role': 'ADMIN' } }))
        .json()).toMatchObject({ status: 'PENDING' });
    } finally { await app.close(); }
  });
});
