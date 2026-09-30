import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { AccountSchema, DeviceCredentialV2Schema, ErrorResponseSchema, LatestReleaseResponseSchema, LoginResponseSchema, ModelListSchema, ResponseSchema } from '@bridge/contract';
import { createSignedMockServer as createMockServer, previousProofHeaders, rawMockInject } from './mock-proof-fixture.js';

const deviceId = '44444444-4444-4444-8444-444444444444';
const threadId = 'desktop-thread-1';
const app = await createMockServer();
let accessToken = '';
let refreshToken = '';
beforeAll(async () => {
  await app.ready();
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desktop@example.test', password: 'MockDesktop123!', device: { deviceId, deviceName: 'Test PC', platform: 'windows', osVersion: '11', appVersion: '0.1.0' } } });
  expect(r.statusCode).toBe(200);
  const body = LoginResponseSchema.parse(r.json());
  expect(DeviceCredentialV2Schema.safeParse(r.json()).success).toBe(true);
  accessToken = body.accessToken;
  refreshToken = body.refreshToken;
});
afterAll(async () => { await app.close(); });
const headers = () => ({ authorization: `Bearer ${accessToken}`, 'x-device-id': deviceId, 'x-client-thread-id': threadId });

describe('Desktop mock integration', () => {
  it('counts one user turn but permits bounded same-thread tool continuation at one device request per minute', async () => {
    const isolated = await createMockServer({ accountRpm: 2, deviceRpm: 1 });
    await isolated.ready();
    try {
      const identity = randomUUID();
      const login = await isolated.inject({ method: 'POST', url: '/api/v1/auth/login',
        payload: { email: 'desktop@example.test', password: 'MockDesktop123!',
          device: { deviceId: identity, deviceName: 'Tool PC', platform: 'windows' } } });
      expect(login.statusCode).toBe(200);
      const session = LoginResponseSchema.parse(login.json());
      const thread = randomUUID();
      const tools = [{ name: 'read', parameters: {} }, { name: 'write', parameters: {} }];
      const send = (input: unknown, clientThreadId = thread) => isolated.inject({ method: 'POST', url: '/v1/responses',
        headers: { authorization: `Bearer ${session.accessToken}`, 'x-device-id': identity, 'x-client-thread-id': clientThreadId },
        payload: { model: 'mock/mock-chat', input, tools } });
      const first = await send('Use local tools');
      expect(first.statusCode).toBe(200);
      const firstCall = first.json().output[0].call_id as string;
      const firstOutput = { type: 'function_call_output', call_id: firstCall, output: 'read result' };
      const second = await send([firstOutput]);
      expect(second.statusCode).toBe(200);
      const secondCall = second.json().output[0].call_id as string;
      const third = await send([firstOutput, { type: 'function_call_output', call_id: secondCall, output: 'write result' }]);
      expect(third.statusCode).toBe(200);
      expect(third.json().output[0].type).toBe('message');
      expect((await send('another turn')).statusCode).toBe(429);
      expect((await send([firstOutput])).statusCode).toBe(429);
      expect((await send([firstOutput], randomUUID())).statusCode).toBe(429);
    } finally { await isolated.close(); }
  });
  it('accepts the Desktop accumulated transcript but counts a new prompt as another turn', async () => {
    const isolated = await createMockServer({ accountRpm: 2, deviceRpm: 1 });
    await isolated.ready();
    try {
      const identity = randomUUID();
      const login = await isolated.inject({ method: 'POST', url: '/api/v1/auth/login',
        payload: { email: 'desktop@example.test', password: 'MockDesktop123!',
          device: { deviceId: identity, deviceName: 'Conversation PC', platform: 'windows' } } });
      expect(login.statusCode).toBe(200);
      const session = LoginResponseSchema.parse(login.json());
      const thread = randomUUID();
      const tools = [{ name: 'read', parameters: {} }];
      const send = (input: unknown) => isolated.inject({ method: 'POST', url: '/v1/responses',
        headers: { authorization: `Bearer ${session.accessToken}`, 'x-device-id': identity, 'x-client-thread-id': thread },
        payload: { model: 'mock/mock-chat', input, tools } });
      const prompt = { role: 'user', content: 'Read this file' };
      const first = await send([prompt]);
      expect(first.statusCode).toBe(200);
      const call = first.json().output[0];
      expect(call.type).toBe('function_call');
      const result = { type: 'function_call_output', call_id: call.call_id, output: 'file content' };
      const injected = await send([prompt, call, { role: 'user', content: 'Ask another question' }, result]);
      expect(injected.statusCode).toBe(429);
      const continuation = await send([prompt, call, result]);
      expect(continuation.statusCode).toBe(200);
      expect(continuation.json().output[0].type).toBe('message');
    } finally { await isolated.close(); }
  });
  it('enforces account 2/min and device 1/min independently while allowing configurable continuation limits', async () => {
    const isolated = await createMockServer({ accountRpm: 2, deviceRpm: 1 });
    await isolated.ready();
    try {
      const login = async () => LoginResponseSchema.parse((await isolated.inject({ method: 'POST', url: '/api/v1/auth/login',
        payload: { email: 'desktop@example.test', password: 'MockDesktop123!', device: { deviceId: randomUUID(), deviceName: 'PC', platform: 'windows' } } })).json());
      const first = await login(); const second = await login(); const third = await login();
      const ask = (session: typeof first) => isolated.inject({ method: 'POST', url: '/v1/responses',
        headers: { authorization: `Bearer ${session.accessToken}`, 'x-device-id': session.device.deviceId, 'x-client-thread-id': randomUUID() },
        payload: { model: 'mock/mock-chat', input: 'Hello' } });
      expect((await ask(first)).statusCode).toBe(200);
      expect((await ask(first)).json().error.code).toBe('RATE_LIMITED');
      expect((await ask(second)).statusCode).toBe(200);
      expect((await ask(third)).json().error.code).toBe('RATE_LIMITED');
    } finally { await isolated.close(); }
    const adjustable = await createMockServer({ accountRpm: 3, deviceRpm: 2 });
    await adjustable.ready();
    try {
      const session = LoginResponseSchema.parse((await adjustable.inject({ method: 'POST', url: '/api/v1/auth/login',
        payload: { email: 'desktop@example.test', password: 'MockDesktop123!', device: { deviceId: randomUUID(), deviceName: 'PC', platform: 'windows' } } })).json());
      const ask = () => adjustable.inject({ method: 'POST', url: '/v1/responses',
        headers: { authorization: `Bearer ${session.accessToken}`, 'x-device-id': session.device.deviceId, 'x-client-thread-id': randomUUID() },
        payload: { model: 'mock/mock-chat', input: 'Hello' } });
      expect((await ask()).statusCode).toBe(200);
      expect((await ask()).statusCode).toBe(200);
      expect((await ask()).statusCode).toBe(429);
    } finally { await adjustable.close(); }
  });
  it('enforces public IP and sensitive auth IP limits in the mock', async () => {
    const isolated = await createMockServer({ publicIpRpm: 2, authIpRpm: 1 });
    await isolated.ready();
    try {
      expect((await isolated.inject({ method: 'GET', url: '/api/v1/plans' })).statusCode).toBe(200);
      expect((await isolated.inject({ method: 'GET', url: '/api/v1/plans' })).statusCode).toBe(200);
      expect((await isolated.inject({ method: 'GET', url: '/api/v1/plans' })).statusCode).toBe(429);
    } finally { await isolated.close(); }
    const auth = await createMockServer({ publicIpRpm: 10, authIpRpm: 1 });
    await auth.ready();
    try {
      const login = () => auth.inject({ method: 'POST', url: '/api/v1/auth/login',
        payload: { email: 'desktop@example.test', password: 'MockDesktop123!',
          device: { deviceId: randomUUID(), deviceName: 'PC', platform: 'windows' } } });
      expect((await login()).statusCode).toBe(200);
      expect((await login()).statusCode).toBe(429);
    } finally { await auth.close(); }
  });
  it('rejects a stolen bearer without the device key, a replay, and a tampered request body', async () => {
    const stolen = await rawMockInject(app, { method: 'GET', url: '/api/v1/account', headers: { authorization: `Bearer ${accessToken}` } });
    expect(stolen.statusCode).toBe(401);
    expect(stolen.json().error.code).toBe('DEVICE_PROOF_INVALID');

    const valid = await app.inject({ method: 'GET', url: '/api/v1/account', headers: headers() });
    expect(valid.statusCode).toBe(200);
    const capturedProof = previousProofHeaders(app);
    const replay = await rawMockInject(app, { method: 'GET', url: '/api/v1/account', headers: capturedProof });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('DEVICE_PROOF_REPLAYED');
    const redirected = await rawMockInject(app, { method: 'GET', url: '/v1/models', headers: capturedProof });
    expect(redirected.statusCode).toBe(401);
    expect(redirected.json().error.code).toBe('DEVICE_PROOF_INVALID');

    const payload = { model: 'mock/mock-chat', input: 'Original' };
    const signed = await app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload });
    expect(signed.statusCode).toBe(200);
    const tampered = await rawMockInject(app, { method: 'POST', url: '/v1/responses', headers: previousProofHeaders(app), payload: { ...payload, input: 'Changed' } });
    expect(tampered.statusCode).toBe(401);
    expect(tampered.json().error.code).toBe('DEVICE_PROOF_INVALID');
  });
  it('does not allow a second key to take over an enrolled device ID', async () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const payload = { email: 'desktop@example.test', password: 'MockDesktop123!',
      device: { deviceId, deviceName: 'Impostor PC', platform: 'windows', publicKeyJwk: publicKey.export({ format: 'jwk' }) } };
    const attempt = await rawMockInject(app, { method: 'POST', url: '/api/v1/auth/login', payload });
    expect(attempt.statusCode).toBe(401);
    expect(attempt.json().error.code).toBe('DEVICE_PROOF_INVALID');
  });
  it('uses the shared exact-body hash vector and excludes the query from htu', async () => {
    const payload = { model: 'mock/mock-chat', input: 'Hi' };
    const response = await app.inject({ method: 'POST', url: '/v1/responses?trace=1', headers: headers(), payload });
    expect(response.statusCode).toBe(200);
    const [, body] = previousProofHeaders(app).dpop.split('.');
    const proof = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { htu: string; bth: string; ath: string };
    expect(proof.htu).toBe('http://localhost:3001/v1/responses');
    expect(proof.bth).toBe('OLciEt12i9omEznk-GfwPKda8mX6tCeCxZcJTxbKbWc');
    expect(proof.ath).toBe(createHash('sha256').update(accessToken).digest('base64url'));
  });
  it('enforces device slots and revoked device tokens', async () => {
    const isolated = await createMockServer();
    await isolated.ready();
    try {
      const logins = [];
      for (let index = 0; index < 4; index++) {
        const result = await isolated.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desktop@example.test', password: 'MockDesktop123!', device: { deviceId: randomUUID(), deviceName: `PC ${index}`, platform: 'windows', osVersion: '11', appVersion: '0.1.0' } } });
        if (index < 3) { expect(result.statusCode).toBe(200); logins.push(result.json()); }
        else { expect(result.statusCode).toBe(409); expect(result.json().error.code).toBe('DEVICE_LIMIT_REACHED'); }
      }
      const first = logins[0];
      const revoked = await isolated.inject({ method: 'DELETE', url: `/api/v1/devices/${first.device.id}`, headers: { authorization: `Bearer ${first.accessToken}` } });
      expect(revoked.statusCode).toBe(200);
      const denied = await isolated.inject({ method: 'GET', url: '/api/v1/account', headers: { authorization: `Bearer ${first.accessToken}` } });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('DEVICE_REVOKED');
    } finally { await isolated.close(); }
  });
  it('keeps tool progress separate for two devices using the same thread ID', async () => {
    const isolated = await createMockServer();
    await isolated.ready();
    try {
      const login = async () => LoginResponseSchema.parse((await isolated.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desktop@example.test', password: 'MockDesktop123!', device: { deviceId: randomUUID(), deviceName: 'PC', platform: 'windows', osVersion: '11', appVersion: '0.1.0' } } })).json());
      const first = await login(); const second = await login();
      const tools = [{ name: 'read', parameters: {} }, { name: 'write', parameters: {} }];
      const headers = (session: typeof first) => ({ authorization: `Bearer ${session.accessToken}`, 'x-device-id': session.device.deviceId, 'x-client-thread-id': 'shared-thread-id' });
      const ask = (session: typeof first, input: string | Array<Record<string, string>>) => isolated.inject({ method: 'POST', url: '/v1/responses', headers: headers(session), payload: { model: 'mock/mock-chat', input, tools } });
      const call1 = await ask(first, 'Use tools');
      expect(ResponseSchema.parse(call1.json()).output[0]).toMatchObject({ type: 'function_call', name: 'read' });
      const call2 = await ask(first, [{ type: 'function_call_output', call_id: 'call_1', output: 'first device result' }]);
      expect(ResponseSchema.parse(call2.json()).output[0]).toMatchObject({ type: 'function_call', name: 'write' });
      const other = await ask(second, 'Use tools');
      expect(ResponseSchema.parse(other.json()).output[0]).toMatchObject({ type: 'function_call', name: 'read' });
      expect(other.body).not.toContain('first device result');
    } finally { await isolated.close(); }
  });
  it('returns contract-valid account and entitled models', async () => {
    const account = await app.inject({ method: 'GET', url: '/api/v1/account', headers: headers() });
    expect(AccountSchema.parse(account.json()).plan?.code).toBe('PRO');
    const models = await app.inject({ method: 'GET', url: '/v1/models', headers: headers() });
    expect(ModelListSchema.parse(models.json()).data[0].id).toBe('mock/mock-chat');
  });
  it('implements the latest release contract', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/releases/latest' });
    expect(response.statusCode).toBe(200);
    expect(LatestReleaseResponseSchema.parse(response.json()).release?.version).toBe('0.1.0');
  });
  it('returns text and SSE completion', async () => {
    const json = await app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: { model: 'mock/mock-chat', input: 'Hello' } });
    expect(ResponseSchema.parse(json.json()).output[0].type).toBe('message');
    const sse = await app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: { model: 'mock/mock-chat', input: 'Hello stream', stream: true } });
    expect(sse.headers['content-type']).toContain('text/event-stream');
    expect(sse.body).toContain('event: response.completed');
    expect(sse.body).toContain('data: [DONE]');
  });
  it('consumes tool output while continuing sequential calls in the same thread', async () => {
    const tools = [{ name: 'read', parameters: {} }, { name: 'write', parameters: {} }, { name: 'shell', parameters: {} }];
    const first = await app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: { model: 'mock/mock-chat', input: 'Use the requested local tools', tools } });
    expect(ResponseSchema.parse(first.json()).output[0]).toMatchObject({ type: 'function_call', name: 'read' });
    expect(first.body).not.toContain('CLOUD-TOOL-731');
    const outputs = [{ type: 'function_call_output' as const, call_id: 'call_1', output: 'file contents: CLOUD-TOOL-731' }];
    const second = await app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: { model: 'mock/mock-chat', input: outputs, tools } });
    expect(ResponseSchema.parse(second.json()).output[0]).toMatchObject({ type: 'function_call', name: 'write' });
    outputs.push({ type: 'function_call_output', call_id: 'call_2', output: 'write completed' });
    const third = await app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: { model: 'mock/mock-chat', input: outputs, tools } });
    expect(ResponseSchema.parse(third.json()).output[0]).toMatchObject({ type: 'function_call', name: 'shell' });
    outputs.push({ type: 'function_call_output', call_id: 'call_3', output: 'shell completed' });
    const final = await app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: { model: 'mock/mock-chat', input: outputs, tools } });
    const response = ResponseSchema.parse(final.json());
    expect(response.output[0].type).toBe('message');
    expect(JSON.stringify(response.output)).toContain('CLOUD-TOOL-731');
  });
  it('preserves the two-tool same-thread scenario', async () => {
    const tools = [{ name: 'read', parameters: {} }, { name: 'write', parameters: {} }];
    const localHeaders = { ...headers(), 'x-client-thread-id': 'desktop-thread-two-tools' };
    const first = await app.inject({ method: 'POST', url: '/v1/responses', headers: localHeaders, payload: { model: 'mock/mock-chat', input: 'Use tools', tools } });
    expect(ResponseSchema.parse(first.json()).output[0]).toMatchObject({ type: 'function_call', name: 'read' });
    const second = await app.inject({ method: 'POST', url: '/v1/responses', headers: localHeaders, payload: { model: 'mock/mock-chat', input: [{ type: 'function_call_output', call_id: 'call_1', output: 'read done' }], tools } });
    expect(ResponseSchema.parse(second.json()).output[0]).toMatchObject({ type: 'function_call', name: 'write' });
    const final = await app.inject({ method: 'POST', url: '/v1/responses', headers: localHeaders, payload: { model: 'mock/mock-chat', input: [{ type: 'function_call_output', call_id: 'call_1', output: 'read done' }, { type: 'function_call_output', call_id: 'call_2', output: 'write done' }], tools } });
    expect(ResponseSchema.parse(final.json()).output[0].type).toBe('message');
  });
  it.each([
    ['SUBSCRIPTION_EXPIRED', 403],
    ['MONTHLY_QUOTA_EXCEEDED', 429],
  ])('exposes loopback-only %s control', async (code, status) => {
    const controlledHeaders = { ...headers(), 'x-mock-error-code': code };
    const account = await app.inject({ method: 'GET', url: '/api/v1/account', headers: controlledHeaders });
    expect(account.statusCode).toBe(status);
    expect(ErrorResponseSchema.parse(account.json()).error.code).toBe(code);
    const response = await app.inject({ method: 'POST', url: '/v1/responses', headers: controlledHeaders, payload: { model: 'mock/mock-chat', input: 'Hello' } });
    expect(response.statusCode).toBe(status);
    expect(ErrorResponseSchema.parse(response.json()).error.code).toBe(code);
  });
  it('rotates refresh token and rejects reuse', async () => {
    const captured = await rawMockInject(app, { method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
    expect(captured.statusCode).toBe(401);
    expect(captured.json().error.code).toBe('DEVICE_PROOF_INVALID');
    const rotated = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().refreshToken).not.toBe(refreshToken);
    const reused = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
    expect(reused.statusCode).toBe(401);
  });
  it('rejects mismatched device header', async () => {
    const result = await app.inject({ method: 'GET', url: '/v1/models', headers: { ...headers(), 'x-device-id': '55555555-5555-4555-8555-555555555555' } });
    expect(result.statusCode).toBe(403);
    expect(result.json().error.code).toBe('DEVICE_NOT_REGISTERED');
  });
});
