import Fastify from 'fastify';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import { DeviceInfoV23Schema, ErrorCodeV2Schema, LatestReleaseResponseSchema, LoginRequestSchema, RefreshRequestSchema, ResponseRequestSchema } from '@bridge/contract';
import { MockProvider } from './mock-provider.js';
import { captureDeviceBody, verifyDeviceProof } from './device-proof.js';
import type { FastifyRequest } from 'fastify';
import { nextContinuationState, pendingContinuation } from './tool-continuation.js';

const provider = new MockProvider();
const accountId = '11111111-1111-4111-8111-111111111111';
const planId = '22222222-2222-4222-8222-222222222222';
const subId = '33333333-3333-4333-8333-333333333333';
const releaseId = '66666666-6666-4666-8666-666666666666';
const user = { id: accountId, email: 'desktop@example.test', role: 'USER', status: 'ACTIVE' };
const plan = { id: planId, code: 'PRO', name: 'Pro (Mock)', description: 'Local integration only', monthlyPrice: '0.00', currency: 'CNY', maxDevices: 3, monthlyTokenLimit: 100000, monthlyUsageCreditLimit: '100000', maxConcurrentRequests: 4, requestsPerMinute: 60, enabled: true };
const latestRelease = LatestReleaseResponseSchema.parse({ release: { id: releaseId, version: '0.1.0', channel: 'stable', platform: 'windows', arch: 'x64', downloadUrl: 'http://127.0.0.1:3001/mock/desktop.exe', sha256: '0'.repeat(64), releaseNotes: 'Loopback Mock release.', published: true, createdAt: '2026-09-23T00:00:00.000Z' } });
type Device = z.infer<typeof DeviceInfoV23Schema> & { id: string; userId: string; status: 'ACTIVE' | 'REVOKED'; activatedAt: string; lastSeenAt: string | null; updatedAt: string };
type Access = { deviceDbId: string; expires: number };
export async function createMockServer(limits: { accountRpm?: number; deviceRpm?: number; publicIpRpm?: number; authIpRpm?: number } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  captureDeviceBody(app);
  const rpm = { account: limits.accountRpm ?? 2, device: limits.deviceRpm ?? 1, publicIp: limits.publicIpRpm ?? 60, authIp: limits.authIpRpm ?? 10 };
  const publicHits = new Map<string, number[]>();
  const aiHits: Array<{ time: number; deviceId: string }> = [];
  const devices = new Map<string, Device>();
  const access = new Map<string, Access>();
  const refresh = new Map<string, string>();
  const sessions = new Map<string, { step: number; state: Record<string, unknown> }>();
  const proofs = new Set<string>();
  let tokens = 0;
  let credit = 0;
  let requests = 0;
  const start = new Date().toISOString();
  const end = new Date(Date.now() + 30 * 86400000).toISOString();
  const subscription = { id: subId, userId: accountId, planId, status: 'ACTIVE', startedAt: start, currentPeriodStart: start, currentPeriodEnd: end, cancelAtPeriodEnd: false, pendingPlanId: null };
  const error = (code: string, status = 403) => Object.assign(new Error(code), { code, status });
  app.addHook('onRequest', async req => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!/^\/api\/v1\/auth\/(login|register|refresh)$/.test(pathname)
      && !(req.method === 'GET' && /^\/api\/v1\/(plans|client\/config|releases\/latest)$/.test(pathname))) return;
    const now = Date.now();
    for (const [scope, limit] of [[`public:${req.ip}`, rpm.publicIp], ...(/^\/api\/v1\/auth\//.test(pathname) ? [[`auth:${req.ip}`, rpm.authIp] as [string, number]] : [])] as Array<[string, number]>) {
      const recent = (publicHits.get(scope) ?? []).filter(time => time > now - 60000);
      if (recent.length >= limit) throw error('RATE_LIMITED', 429);
      recent.push(now);
      publicHits.set(scope, recent);
    }
  });
  async function signed(req: FastifyRequest, device: Device, token: string) {
    const jti = await verifyDeviceProof(req, device.publicKeyJwk, token);
    if (proofs.has(jti)) throw error('DEVICE_PROOF_REPLAYED', 401);
    proofs.add(jti);
  }
  async function principal(req: FastifyRequest, requireDevice = false) {
    const match = String(req.headers.authorization ?? '').match(/^Bearer (.+)$/);
    const grant = match && access.get(match[1]);
    if (!grant || grant.expires < Date.now()) throw error('TOKEN_EXPIRED', 401);
    const device = [...devices.values()].find(d => d.id === grant.deviceDbId);
    if (!device) throw error('DEVICE_NOT_REGISTERED');
    if (device.status !== 'ACTIVE') throw error('DEVICE_REVOKED');
    await signed(req, device, match![1]);
    if (requireDevice && req.headers['x-device-id'] !== device.deviceId) throw error('DEVICE_NOT_REGISTERED');
    const controlledError = req.headers['x-mock-error-code'];
    if (controlledError === 'SUBSCRIPTION_EXPIRED') throw error(controlledError, 403);
    if (controlledError === 'MONTHLY_QUOTA_EXCEEDED') throw error(controlledError, 429);
    return device;
  }
  const newToken = () => randomBytes(32).toString('base64url');
  function tokensFor(device: Device) {
    const accessToken = newToken(); const refreshToken = newToken();
    access.set(accessToken, { deviceDbId: device.id, expires: Date.now() + 1800000 });
    refresh.set(refreshToken, device.id);
    return { accessToken, refreshToken, expiresIn: 1800 };
  }
  app.setErrorHandler((err, req, reply) => {
    const typed = err as Error & { code?: string; status?: number };
    const code = err instanceof ZodError ? 'VALIDATION_ERROR' : typed.code && ErrorCodeV2Schema.safeParse(typed.code).success ? typed.code : 'INTERNAL_ERROR';
    return reply.code(err instanceof ZodError ? 400 : typed.status ?? 500).send({ error: { code, message: code, requestId: req.id } });
  });
  app.get('/health', async () => ({ status: 'ok', version: 'mock-v1' }));
  app.post('/api/v1/auth/login', async req => {
    const data = LoginRequestSchema.extend({ device: DeviceInfoV23Schema }).parse(req.body);
    const expected = process.env.MOCK_DESKTOP_PASSWORD ?? 'MockDesktop123!';
    const actual = Buffer.from(data.password); const target = Buffer.from(expected);
    if (data.email !== user.email || actual.length !== target.length || !timingSafeEqual(actual, target)) throw error('UNAUTHORIZED', 401);
    let device = devices.get(data.device.deviceId);
    if (device?.status === 'REVOKED') throw error('DEVICE_REVOKED');
    if (device && (device.publicKeyJwk.x !== data.device.publicKeyJwk.x || device.publicKeyJwk.y !== data.device.publicKeyJwk.y)) throw error('DEVICE_PROOF_INVALID', 401);
    if (!device) {
      if ([...devices.values()].filter(d => d.status === 'ACTIVE').length >= plan.maxDevices) throw error('DEVICE_LIMIT_REACHED', 409);
      device = { ...data.device, id: randomUUID(), userId: user.id, status: 'ACTIVE', activatedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      devices.set(device.deviceId, device);
    }
    return { ...tokensFor(device), user, device };
  });
  app.post('/api/v1/auth/refresh', async req => {
    const { refreshToken } = RefreshRequestSchema.parse(req.body);
    const id = refresh.get(refreshToken);
    if (!id) throw error('UNAUTHORIZED', 401);
    const device = [...devices.values()].find(d => d.id === id);
    if (!device || device.status !== 'ACTIVE') throw error('DEVICE_REVOKED');
    await signed(req, device, refreshToken);
    refresh.delete(refreshToken);
    return tokensFor(device);
  });
  app.post('/api/v1/auth/logout', async req => {
    await principal(req);
    const body = RefreshRequestSchema.parse(req.body);
    refresh.delete(body.refreshToken);
    return { ok: true };
  });
  app.get('/api/v1/auth/me', async req => { await principal(req); return { user }; });
  app.post('/api/v1/devices/register', async req => {
    const current = await principal(req);
    const info = DeviceInfoV23Schema.parse(req.body);
    if (current.deviceId !== info.deviceId || current.publicKeyJwk.x !== info.publicKeyJwk.x || current.publicKeyJwk.y !== info.publicKeyJwk.y) throw error('DEVICE_PROOF_INVALID', 401);
    let device = devices.get(info.deviceId);
    if (!device) {
      if ([...devices.values()].filter(d => d.status === 'ACTIVE').length >= plan.maxDevices) throw error('DEVICE_LIMIT_REACHED', 409);
      device = { ...info, id: randomUUID(), userId: user.id, status: 'ACTIVE', activatedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      devices.set(info.deviceId, device);
    }
    return { device };
  });
  app.get('/api/v1/devices', async req => { await principal(req); return { data: [...devices.values()] }; });
  app.delete('/api/v1/devices/:id', async req => {
    await principal(req);
    const id = z.uuid().parse((req.params as { id: string }).id);
    const device = [...devices.values()].find(d => d.id === id);
    if (!device) throw error('DEVICE_NOT_REGISTERED', 404);
    device.status = 'REVOKED';
    device.updatedAt = new Date().toISOString();
    return { device };
  });
  app.get('/api/v1/account', async req => { await principal(req); return { user, subscription, plan, devices: [...devices.values()], usage: { tokens, credit, requests, tokenLimit: plan.monthlyTokenLimit, creditLimit: Number(plan.monthlyUsageCreditLimit), percent: Math.round(100 * credit / Number(plan.monthlyUsageCreditLimit)), threshold: 0 } }; });
  app.get('/api/v1/subscription', async req => { await principal(req); return { subscription, plan }; });
  app.get('/api/v1/usage/current', async req => { await principal(req); return { tokens, credit, requests, tokenLimit: plan.monthlyTokenLimit, creditLimit: Number(plan.monthlyUsageCreditLimit), percent: Math.round(100 * credit / Number(plan.monthlyUsageCreditLimit)), threshold: 0 }; });
  app.get('/api/v1/plans', async () => ({ data: [plan] }));
  app.get('/api/v1/client/config', async () => ({ minimumVersion: '0.1.0', latestVersion: '0.1.0', maintenance: false, features: { cloudGateway: true } }));
  app.get('/api/v1/releases/latest', async () => latestRelease);
  app.get('/v1/models', async req => {
    await principal(req, true);
    return { object: 'list', data: [{ id: 'mock/mock-chat', object: 'model', owned_by: 'mock', capabilities: { tools: true, vision: false, reasoning: false, streaming: true } }] };
  });
  app.post('/v1/responses', async (req, reply) => {
    const device = await principal(req, true);
    const thread = req.headers['x-client-thread-id'];
    if (typeof thread !== 'string' || !thread.trim()) throw error('CLIENT_THREAD_ID_REQUIRED', 400);
    const body = ResponseRequestSchema.parse(req.body);
    if (body.model !== 'mock/mock-chat') throw error('MODEL_NOT_ALLOWED');
    const now = Date.now();
    const key = `${user.id}:${device.id}:${thread}`;
    const session = sessions.get(key);
    const continuation = session ? pendingContinuation(session.state, body, now) : null;
    const recent = aiHits.filter(hit => hit.time > now - 60000);
    if (!continuation && (recent.length >= rpm.account || recent.filter(hit => hit.deviceId === device.id).length >= rpm.device)) throw error('RATE_LIMITED', 429);
    aiHits.length = 0;
    aiHits.push(...recent, ...(!continuation ? [{ time: now, deviceId: device.id }] : []));
    const oldStep = session?.step ?? 0;
    if (session) session.state = {};
    const toolOutputs = Array.isArray(body.input) ? body.input.flatMap(item => item.type === 'function_call_output' ? [item.output] : []) : [];
    const toolResults = toolOutputs.length;
    const result = await provider.createResponse(body, 'mock-chat', new AbortController().signal);
    if (body.tools?.length && toolResults < body.tools.length && oldStep <= toolResults) {
      const tool = body.tools[toolResults];
      result.output = [{ type: 'function_call', call_id: `call_${toolResults + 1}`, name: tool.name, arguments: '{}' }];
      sessions.set(key, { step: toolResults + 1, state: nextContinuationState(body, result, continuation, Date.now()) });
    } else if (toolResults) {
      const received = toolOutputs.map((output, index) => `Tool ${index + 1} output:\n${output}`).join('\n');
      result.output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Completed ${toolResults} local tool result(s).\n${received}` }] }];
      sessions.delete(key);
    } else {
      sessions.delete(key);
    }
    tokens += result.inputTokens + result.outputTokens;
    credit += result.inputTokens + result.outputTokens;
    requests += 1;
    const id = `resp_${randomUUID().replaceAll('-', '')}`;
    const response = { id, object: 'response', status: 'completed', model: body.model, output: result.output, usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens, total_tokens: result.inputTokens + result.outputTokens } };
    if (!body.stream) return response;
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    const send = (type: string, data: unknown) => reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    send('response.created', { response: { id, status: 'in_progress', model: body.model } });
    for (const [index, item] of result.output.entries()) {
      send('response.output_item.added', { response_id: id, output_index: index, item });
      if (item.type === 'message') {
        const content = item.content as Array<{ text: string }>;
        for (const chunk of content[0]?.text.match(/.{1,12}/g) ?? []) { send('response.output_text.delta', { response_id: id, output_index: index, delta: chunk }); await new Promise(resolve => setTimeout(resolve, 10)); }
      }
      send('response.output_item.done', { response_id: id, output_index: index, item });
    }
    send('response.completed', { response });
    reply.raw.end('data: [DONE]\n\n');
  });
  return app;
}
