import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const enabled = Boolean(process.env.V2_TEST_DATABASE_URL);
describe.skipIf(!enabled)('V2 PostgreSQL invariants', () => {
  let dbModule: typeof import('@bridge/db');
  let walletModule: typeof import('./wallet.js');
  let meterModule: typeof import('./metering.js');
  let referralModule: typeof import('./referral.js');
  let sql: typeof import('drizzle-orm').sql;
  let ids: { user: string; secondUser: string; admin: string; device: string; secondDevice: string; provider: string; model: string; plan: string; rateCard: string; rateVersion: string };

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.V2_TEST_DATABASE_URL;
    process.env.ACCESS_SECRET ??= 'a'.repeat(64);
    process.env.REFRESH_TOKEN_PEPPER ??= 'b'.repeat(64);
    process.env.PROVIDER_MASTER_KEY ??= 'c'.repeat(64);
    process.env.PUBLIC_BASE_URL ??= 'http://localhost:3001';
    dbModule = await import('@bridge/db');
    walletModule = await import('./wallet.js');
    meterModule = await import('./metering.js');
    referralModule = await import('./referral.js');
    sql = (await import('drizzle-orm')).sql;
    const { db, users, devices, providers, models, plans, rateCards, rateCardVersions } = dbModule;
    // This test is permitted only against a dedicated disposable database.
    if (!new URL(process.env.DATABASE_URL!).pathname.startsWith('/bridge_v2_test_')) throw new Error('REFUSE_NON_TEST_DATABASE');
    await db.execute(sql`truncate table users, plans, providers, system_settings restart identity cascade`);
    const [user] = await db.insert(users).values({ email: `v2-${randomUUID()}@example.test`, passwordHash: 'test' }).returning();
    const [secondUser] = await db.insert(users).values({ email: `v2-${randomUUID()}@example.test`, passwordHash: await (await import('./security.js')).hashPassword('testpassword123') }).returning();
    const [admin] = await db.insert(users).values({ email: `v2-admin-${randomUUID()}@example.test`, passwordHash: 'test', role: 'ADMIN' }).returning();
    const [device] = await db.insert(devices).values({ userId: user.id, deviceId: randomUUID(), deviceName: 'test', platform: 'test' }).returning();
    const [secondDevice] = await db.insert(devices).values({ userId: secondUser.id, deviceId: randomUUID(), deviceName: 'test', platform: 'test' }).returning();
    const [provider] = await db.insert(providers).values({ code: 'V2_TEST', name: 'V2 Test', enabled: true }).returning();
    const [model] = await db.insert(models).values({ providerId: provider.id, providerModelId: 'test', publicId: 'v2/test', displayName: 'Test', enabled: true }).returning();
    const [plan] = await db.insert(plans).values({ code: 'V2_TEST', name: 'V2 Test', monthlyPrice: '1', maxDevices: 3,
      monthlyTokenLimit: 1000000, monthlyUsageCreditLimit: '1000000', maxConcurrentRequests: 10, requestsPerMinute: 100, monthlyPoints: 100, rolloverPolicy: 'UNLIMITED' }).returning();
    const [card] = await db.insert(rateCards).values({ providerId: provider.id, modelId: model.id, billingPolicy: 'MANAGED_USAGE' }).returning();
    const [rateVersion] = await db.insert(rateCardVersions).values({ rateCardId: card.id, version: 1, status: 'ACTIVE', inputRate: '10', outputRate: '20',
      cachedInputRate: '2', reasoningRate: '30', imageInputRate: '3', imageOutputRate: '4', toolRate: '1' }).returning();
    ids = { user: user.id, secondUser: secondUser.id, admin: admin.id, device: device.id, secondDevice: secondDevice.id, provider: provider.id, model: model.id, plan: plan.id, rateCard: card.id, rateVersion: rateVersion.id };
  });
  afterAll(async () => { await dbModule?.pool.end(); });

  it('serializes concurrent debit, prevents overdraft, and deduplicates retries', async () => {
    const { db, walletTransactions, wallets } = dbModule;
    await db.transaction(tx => walletModule.applyWalletChange(tx, { userId: ids.user, points: 10, type: 'PURCHASE', referenceType: 'TEST', referenceId: 'seed', idempotencyKey: 'seed-wallet' }));
    const debit = (key: string) => db.transaction(tx => walletModule.applyWalletChange(tx, { userId: ids.user, points: -8, type: 'USAGE', referenceType: 'TEST', referenceId: key, idempotencyKey: key }));
    const results = await Promise.allSettled([debit('debit-a'), debit('debit-b')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason.code)).toEqual(['INSUFFICIENT_POINTS']);
    const winner = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof debit>>>;
    const duplicate = await debit(winner.value.transaction.idempotencyKey);
    expect(duplicate.duplicate).toBe(true);
    const [wallet] = await db.select().from(wallets).where((await import('drizzle-orm')).eq(wallets.userId, ids.user));
    expect(wallet.balance).toBe(2);
    const entries = await db.select().from(walletTransactions);
    expect(entries.filter(entry => entry.type === 'USAGE')).toHaveLength(1);
  });

  it('grants a subscription period only once', async () => {
    const { db, subscriptions, wallets } = dbModule;
    const now = new Date();
    const [subscription] = await db.insert(subscriptions).values({ userId: ids.secondUser, planId: ids.plan, status: 'ACTIVE', startedAt: now, currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 86400000) }).returning();
    const first = await db.transaction(tx => walletModule.grantSubscriptionPoints(tx, subscription.id));
    const second = await db.transaction(tx => walletModule.grantSubscriptionPoints(tx, subscription.id));
    expect(first?.duplicate).toBe(false);
    expect(second?.duplicate).toBe(true);
    const [wallet] = await db.select().from(wallets).where((await import('drizzle-orm')).eq(wallets.userId, ids.secondUser));
    expect(wallet.balance).toBe(100);
  });

  it('expires only unspent non-rollover grants and preserves purchased points', async () => {
    const { db, plans, subscriptions, users, walletLots, walletTransactions } = dbModule;
    const [account] = await db.insert(users).values({ email: `v2-expiry-${randomUUID()}@example.test`, passwordHash: 'test' }).returning();
    const [plan] = await db.insert(plans).values({ code: 'NO_ROLLOVER', name: 'No rollover', monthlyPrice: '1', maxDevices: 1,
      monthlyTokenLimit: 10000, monthlyUsageCreditLimit: '10000', maxConcurrentRequests: 1, requestsPerMinute: 10, monthlyPoints: 50,
      rolloverPolicy: 'NONE' }).returning();
    const start = new Date(); const end = new Date(start.getTime() + 86400000);
    const [subscription] = await db.insert(subscriptions).values({ userId: account.id, planId: plan.id, status: 'ACTIVE', startedAt: start,
      currentPeriodStart: start, currentPeriodEnd: end }).returning();
    await db.transaction(tx => walletModule.grantSubscriptionPoints(tx, subscription.id));
    await db.transaction(tx => walletModule.applyWalletChange(tx, { userId: account.id, points: 20, type: 'PURCHASE', referenceType: 'TEST', referenceId: 'purchase', idempotencyKey: 'purchase-expiry' }));
    await db.transaction(tx => walletModule.applyWalletChange(tx, { userId: account.id, points: -30, type: 'USAGE', referenceType: 'TEST', referenceId: 'usage', idempotencyKey: 'usage-expiry' }));
    expect(await walletModule.expireDueWalletLots(account.id, new Date(end.getTime() + 1000))).toBe(20);
    expect(await walletModule.expireDueWalletLots(account.id, new Date(end.getTime() + 2000))).toBe(20);
    const lots = await db.select().from(walletLots);
    expect(lots.some(lot => lot.expiresAt && lot.remainingPoints === 0)).toBe(true);
    expect(lots.some(lot => !lot.expiresAt && lot.remainingPoints === 20)).toBe(true);
    expect((await db.select().from(walletTransactions)).filter(entry => entry.type === 'EXPIRATION' && entry.points === -20)).toHaveLength(1);
  });

  it('registers, limits, revokes and replaces a user-owned device', async () => {
    const { db, users } = dbModule;
    const [user] = await db.select().from(users).where((await import('drizzle-orm')).eq(users.id, ids.secondUser));
    const app = await (await import('./server.js')).createServer();
    try {
      const deviceInfo = () => ({ deviceId: randomUUID(), deviceName: 'test desktop', platform: 'Windows', osVersion: '11', appVersion: '2.0' });
      const login = async (device: ReturnType<typeof deviceInfo>) => app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password: 'testpassword123', device } });
      const first = await login(deviceInfo());
      const second = await login(deviceInfo());
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      const limited = await login(deviceInfo());
      expect(limited.statusCode).toBe(409);
      expect(limited.json().error.code).toBe('DEVICE_LIMIT_REACHED');
      const revokedId = first.json().device.id as string;
      const revoke = await app.inject({ method: 'POST', url: `/api/v1/devices/${revokedId}/revoke`, headers: { authorization: `Bearer ${second.json().accessToken}` } });
      expect(revoke.statusCode).toBe(200);
      expect((await login(deviceInfo())).statusCode).toBe(200);
    } finally { await app.close(); }
  });

  it('keeps old access and refresh tokens revoked after Admin and user device restoration', async () => {
    const { db, plans, subscriptions, users } = dbModule;
    const [user] = await db.insert(users).values({ email: `v2-device-auth-${randomUUID()}@example.test`,
      passwordHash: await (await import('./security.js')).hashPassword('testpassword123') }).returning();
    const [plan] = await db.insert(plans).values({ code: `DEVICE_${randomUUID().slice(0, 8)}`, name: 'Device Test', monthlyPrice: '1',
      maxDevices: 2, monthlyTokenLimit: 1000, monthlyUsageCreditLimit: '1000', maxConcurrentRequests: 1, requestsPerMinute: 10 }).returning();
    const now = new Date();
    await db.insert(subscriptions).values({ userId: user.id, planId: plan.id, status: 'ACTIVE', startedAt: now,
      currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 86400000) });
    const app = await (await import('./server.js')).createServer();
    try {
      const adminToken = await (await import('./security.js')).issueAccess(ids.admin, undefined, 'ADMIN');
      const device = { deviceId: randomUUID(), deviceName: 'Restored Desktop', platform: 'Windows', osVersion: '11', appVersion: '2.0' };
      const login = async () => {
        const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
          payload: { email: user.email, password: 'testpassword123', device } });
        expect(response.statusCode).toBe(200);
        return response.json() as { accessToken: string; refreshToken: string; device: { id: string } };
      };
      const first = await login();
      const deviceId = first.device.id;
      const adminStatus = async (status: 'ACTIVE' | 'REVOKED' | 'BLOCKED') => {
        const response = await app.inject({ method: 'PATCH', url: `/api/v1/admin/devices/${deviceId}`,
          headers: { authorization: `Bearer ${adminToken}` }, payload: { status } });
        expect(response.statusCode).toBe(200);
      };
      const assertStale = async (credentials: { accessToken: string; refreshToken: string }) => {
        const access = await app.inject({ method: 'GET', url: '/api/v1/auth/me',
          headers: { authorization: `Bearer ${credentials.accessToken}` } });
        expect(access.statusCode).toBe(403);
        expect(access.json().error.code).toBe('DEVICE_REVOKED');
        const refresh = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh',
          payload: { refreshToken: credentials.refreshToken } });
        expect(refresh.statusCode).toBe(401);
      };
      await adminStatus('REVOKED');
      await adminStatus('ACTIVE');
      await assertStale(first);
      const second = await login();
      expect(second.device.id).toBe(deviceId);
      await adminStatus('BLOCKED');
      await adminStatus('ACTIVE');
      await assertStale(second);
      const third = await login();
      for (const [method, path] of [['DELETE', `/api/v1/devices/${deviceId}`], ['POST', `/api/v1/devices/${deviceId}/revoke`]] as const) {
        const current = method === 'DELETE' ? third : await login();
        const revoke = await app.inject({ method, url: path, headers: { authorization: `Bearer ${current.accessToken}` } });
        expect(revoke.statusCode).toBe(200);
        await adminStatus('ACTIVE');
        await assertStale(current);
      }
      expect((await login()).device.id).toBe(deviceId);
    } finally { await app.close(); }
  });

  it('pins a rate version, bills observed disconnect usage once, and preserves failed requests', async () => {
    const { db, aiRequests, rateCardVersions, usageEvents, walletTransactions } = dbModule;
    const [request] = await db.insert(aiRequests).values({ responseId: `resp_${randomUUID().replaceAll('-', '')}`, userId: ids.secondUser,
      deviceId: ids.secondDevice, providerId: ids.provider, modelId: ids.model, billingPolicy: 'MANAGED_USAGE', rateCardVersionId: ids.rateVersion, status: 'STARTED' }).returning();
    const [pinned] = await db.select().from(rateCardVersions).where((await import('drizzle-orm')).eq(rateCardVersions.id, ids.rateVersion));
    await db.update(rateCardVersions).set({ status: 'RETIRED', effectiveTo: new Date() }).where((await import('drizzle-orm')).eq(rateCardVersions.id, ids.rateVersion));
    await db.insert(rateCardVersions).values({ rateCardId: pinned.rateCardId, version: 2, status: 'ACTIVE', inputRate: '100', outputRate: '100' });
    expect((await meterModule.activeRateVersion(ids.provider, ids.model, 'MANAGED_USAGE'))?.version).toBe(2);
    const event = await meterModule.settleAiRequest(request.id, 'CLIENT_DISCONNECTED', { usage: { inputTokens: 1000, outputTokens: 1000 }, providerReportedUsage: { input_tokens: 1000, output_tokens: 1000 } });
    expect(event.pointsRated).toBe(30);
    expect(event.pointsCharged).toBe(30);
    expect(event.rateCardVersionId).toBe(ids.rateVersion);
    const repeat = await meterModule.settleAiRequest(request.id, 'CLIENT_DISCONNECTED', { usage: { inputTokens: 1000 } });
    expect(repeat.id).toBe(event.id);
    expect((await db.select().from(walletTransactions)).filter(t => t.referenceId === request.id)).toHaveLength(1);
    await expect(db.update(usageEvents).set({ pointsCharged: 0 }).where((await import('drizzle-orm')).eq(usageEvents.id, event.id))).rejects.toThrow();
    const [failed] = await db.insert(aiRequests).values({ responseId: `resp_${randomUUID().replaceAll('-', '')}`, userId: ids.secondUser,
      deviceId: ids.secondDevice, providerId: ids.provider, modelId: ids.model, billingPolicy: 'MANAGED_USAGE', rateCardVersionId: ids.rateVersion, status: 'STARTED' }).returning();
    const failedEvent = await meterModule.settleAiRequest(failed.id, 'PROVIDER_ERROR', {});
    expect(failedEvent.billingStatus).toBe('NO_USAGE');
    expect(failedEvent.pointsCharged).toBe(0);
    const [partial] = await db.insert(aiRequests).values({ responseId: `resp_${randomUUID().replaceAll('-', '')}`, userId: ids.secondUser,
      deviceId: ids.secondDevice, providerId: ids.provider, modelId: ids.model, billingPolicy: 'MANAGED_USAGE', rateCardVersionId: ids.rateVersion, status: 'STARTED' }).returning();
    const partialEvent = await meterModule.settleAiRequest(partial.id, 'PROVIDER_ERROR', { usage: { inputTokens: 1000 } });
    expect(partialEvent.pointsCharged).toBe(10);
    const [overrun] = await db.insert(aiRequests).values({ responseId: `resp_${randomUUID().replaceAll('-', '')}`, userId: ids.secondUser,
      deviceId: ids.secondDevice, providerId: ids.provider, modelId: ids.model, billingPolicy: 'MANAGED_USAGE', rateCardVersionId: ids.rateVersion, status: 'STARTED' }).returning();
    const unpaid = await meterModule.settleAiRequest(overrun.id, 'COMPLETED', { usage: { inputTokens: 100000 } });
    expect(unpaid.billingStatus).toBe('UNPAID');
    expect(unpaid.pointsCharged).toBe(0);
    await expect(meterModule.preflightPoints(ids.secondUser, ids.provider, ids.model, 'MANAGED_USAGE')).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });
    const [invalid] = await db.insert(aiRequests).values({ responseId: `resp_${randomUUID().replaceAll('-', '')}`, userId: ids.user,
      deviceId: ids.device, providerId: ids.provider, modelId: ids.model, billingPolicy: 'MANAGED_USAGE', rateCardVersionId: ids.rateVersion, status: 'STARTED' }).returning();
    const invalidEvent = await meterModule.settleAiRequest(invalid.id, 'COMPLETED', { usage: { inputTokens: -1 }, providerReportedUsage: { input_tokens: -1 } });
    expect(invalidEvent.billingStatus).toBe('METERING_ERROR');
    expect(invalidEvent.pointsCharged).toBe(0);
    await expect(meterModule.preflightPoints(ids.user, ids.provider, ids.model, 'MANAGED_USAGE')).rejects.toMatchObject({ code: 'BILLING_REVIEW_REQUIRED' });
  });

  it('flags observed upstream text after disconnect without final usage for review without debiting points', async () => {
    const { db, aiRequests, devices, usageEvents, users, walletTransactions } = dbModule;
    const { eq } = await import('drizzle-orm');
    const [user] = await db.insert(users).values({ email: `v2-interrupted-${randomUUID()}@example.test`, passwordHash: 'test' }).returning();
    const [device] = await db.insert(devices).values({ userId: user.id, deviceId: randomUUID(), deviceName: 'test', platform: 'test' }).returning();
    await db.transaction(tx => walletModule.applyWalletChange(tx, { userId: user.id, points: 100, type: 'TEST_GRANT',
      referenceType: 'TEST', referenceId: user.id, idempotencyKey: `interrupted:${user.id}` }));
    const [request] = await db.insert(aiRequests).values({ responseId: `resp_${randomUUID().replaceAll('-', '')}`, userId: user.id,
      deviceId: device.id, providerId: ids.provider, modelId: ids.model, billingPolicy: 'MANAGED_USAGE',
      rateCardVersionId: ids.rateVersion, status: 'STARTED' }).returning();
    const event = await meterModule.settleAiRequest(request.id, 'CLIENT_DISCONNECTED', { usageUnavailable: true }, 'SHADOW');
    expect(event).toMatchObject({ billingStatus: 'METERING_ERROR', pointsRated: 0, pointsCharged: 0 });
    expect(await walletModule.walletSummary(user.id)).toMatchObject({ balance: 100 });
    expect(await db.select().from(walletTransactions).where(eq(walletTransactions.referenceId, request.id))).toHaveLength(0);
    const [updated] = await db.select().from(aiRequests).where(eq(aiRequests.id, request.id));
    expect(updated).toMatchObject({ status: 'CLIENT_DISCONNECTED', errorCode: 'COPILOT_USAGE_UNAVAILABLE' });
    const retry = await meterModule.settleAiRequest(request.id, 'PROVIDER_ERROR', {}, 'SHADOW');
    expect(retry.id).toBe(event.id);
    expect(await db.select().from(usageEvents).where(eq(usageEvents.requestId, request.id))).toHaveLength(1);
    await expect(meterModule.preflightPoints(user.id, ids.provider, ids.model, 'MANAGED_USAGE'))
      .rejects.toMatchObject({ code: 'BILLING_REVIEW_REQUIRED' });
  });

  it('persists only verified Copilot credentials and audit without enabling the provider', async () => {
    const { auditLogs, db, providerCredentials, providers, webSessions } = dbModule;
    const { eq } = await import('drizzle-orm');
    const [provider] = await db.insert(providers).values({ code: 'COPILOT', name: 'Copilot', enabled: false }).returning();
    const token = 'gho_local-test-user-token';
    const fetcher = vi.fn(async (url: string | URL | Request) => Response.json(String(url).endsWith('/device/code')
      ? { device_code: 'hidden-device-code', user_code: 'TEST-CODE', verification_uri: 'https://github.com/login/device',
        expires_in: 120, interval: 5 }
      : { access_token: token, token_type: 'bearer' })) as unknown as typeof fetch;
    const { createCopilotAuthService } = await import('./copilot-auth.js');
    const service = createCopilotAuthService({ clientId: 'Iv1.testclientid', fetcher, wait: async () => {},
      discover: async () => ({ authenticated: true, login: 'test-copilot-user', models: [{ id: 'gpt-5.4-mini' }] }) });
    expect((await service.start(ids.admin)).status).toBe('PENDING');
    await vi.waitFor(async () => expect(await service.status()).toEqual({ status: 'AUTHENTICATED', login: 'test-copilot-user' }));
    const [credential] = await db.select().from(providerCredentials).where(eq(providerCredentials.providerId, provider.id));
    expect(credential.ciphertext).not.toContain(token);
    expect((await import('./security.js')).decryptSecret(credential)).toBe(token);
    const [unchanged] = await db.select().from(providers).where(eq(providers.id, provider.id));
    expect(unchanged.enabled).toBe(false);
    const audit = (await db.select().from(auditLogs)).find(row => row.action === 'COPILOT_DEVICE_AUTHENTICATED');
    expect(audit?.actorId).toBe(ids.admin);
    expect(JSON.stringify(audit?.metadata)).not.toMatch(/gho_|hidden-device-code/);
    const restored = createCopilotAuthService({ clientId: undefined,
      discover: async () => ({ authenticated: true, login: 'test-copilot-user', models: [{ id: 'gpt-5.4-mini' }] }) });
    expect(await restored.status()).toEqual({ status: 'AUTHENTICATED', login: 'test-copilot-user' });
    const app = await (await import('./server.js')).createServer();
    try {
      const { decryptSecret, hashRefresh, issueAccess, newRefresh } = await import('./security.js');
      const nonAdminToken = await issueAccess(ids.secondUser, undefined, 'USER');
      for (const method of ['GET', 'POST'] as const) {
        const denied = await app.inject({ method, url: '/api/v1/admin/copilot/auth',
          headers: { authorization: `Bearer ${nonAdminToken}` } });
        expect(denied.statusCode).toBe(403);
        expect(denied.json().error.code).toBe('FORBIDDEN');
      }
      const patchUrl = `/api/v1/admin/providers/${provider.id}`;
      const forbidden = await app.inject({ method: 'PATCH', url: patchUrl,
        headers: { authorization: `Bearer ${nonAdminToken}` }, payload: { apiKey: 'replacement-key' } });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json().error.code).toBe('FORBIDDEN');
      const session = newRefresh();
      await db.insert(webSessions).values({ userId: ids.admin, tokenHash: hashRefresh(session),
        expiresAt: new Date(Date.now() + 60000) });
      const csrf = await app.inject({ method: 'PATCH', url: patchUrl,
        headers: { cookie: `bridge_session=${session}`, origin: 'https://not-the-admin-origin.example' },
        payload: { apiKey: 'replacement-key' } });
      expect(csrf.statusCode).toBe(403);
      expect(csrf.json().error.code).toBe('CSRF_REJECTED');
      const adminToken = await issueAccess(ids.admin, undefined, 'ADMIN');
      const headers = { authorization: `Bearer ${adminToken}` };
      for (const payload of [{ apiKey: 'replacement-key' }, { apiKey: 'replacement-key', enabled: false }]) {
        const rejected = await app.inject({ method: 'PATCH', url: patchUrl, headers, payload });
        expect(rejected.statusCode).toBe(409);
        expect(rejected.json().error.code).toBe('PROVIDER_CONNECTION_UNAVAILABLE');
      }
      const enable = await app.inject({ method: 'PATCH', url: patchUrl, headers, payload: { enabled: true } });
      expect(enable.statusCode).toBe(503);
      const [protectedCredential] = await db.select().from(providerCredentials).where(eq(providerCredentials.providerId, provider.id));
      expect(protectedCredential).toMatchObject({ ciphertext: credential.ciphertext, iv: credential.iv, tag: credential.tag });
      const [stillDisabled] = await db.select().from(providers).where(eq(providers.id, provider.id));
      expect(stillDisabled.enabled).toBe(false);
      const other = await app.inject({ method: 'PATCH', url: `/api/v1/admin/providers/${ids.provider}`, headers,
        payload: { apiKey: 'ordinary-provider-key' } });
      expect(other.statusCode).toBe(200);
      const [otherCredential] = await db.select().from(providerCredentials).where(eq(providerCredentials.providerId, ids.provider));
      expect(decryptSecret(otherCredential)).toBe('ordinary-provider-key');
    } finally { await app.close(); }
    service.cancel();
  });

  it('reads configured ACL and effective user models after admin assignment and revocation', async () => {
    const { db, subscriptions, users } = dbModule;
    const [user] = await db.insert(users).values({ email: `v2-access-${randomUUID()}@example.test`, passwordHash: 'test' }).returning();
    const now = new Date();
    await db.insert(subscriptions).values({ userId: user.id, planId: ids.plan, status: 'ACTIVE', startedAt: now,
      currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 86400000) });
    const app = await (await import('./server.js')).createServer();
    try {
      const issueAccess = (await import('./security.js')).issueAccess;
      const adminToken = await issueAccess(ids.admin, undefined, 'ADMIN');
      const userToken = await issueAccess(user.id, undefined, 'USER');
      const endpoint = `/api/v1/admin/model-access?userId=${user.id}`;
      const headers = { authorization: `Bearer ${adminToken}` };
      expect((await app.inject({ method: 'GET', url: endpoint, headers: { authorization: `Bearer ${userToken}` } })).statusCode).toBe(403);
      const read = async () => {
        const response = await app.inject({ method: 'GET', url: endpoint, headers });
        expect(response.statusCode).toBe(200);
        return response.json() as { planAccess: Array<{planId:string;modelId:string}>;
          overrides: Array<{modelId:string;access:string}>; effectiveModelIds: string[] };
      };
      expect((await read()).effectiveModelIds).not.toContain(ids.model);
      const allow = await app.inject({ method: 'PUT', url: `/api/v1/admin/models/${ids.model}/plans/${ids.plan}`, headers,
        payload: { allowed: true } });
      expect(allow.statusCode).toBe(200);
      expect((await read()).effectiveModelIds).toContain(ids.model);
      const deny = await app.inject({ method: 'PUT', url: `/api/v1/admin/users/${user.id}/models/${ids.model}`, headers,
        payload: { access: 'DENY' } });
      expect(deny.statusCode).toBe(200);
      const denied = await read();
      expect(denied.overrides).toContainEqual({ modelId: ids.model, access: 'DENY' });
      expect(denied.effectiveModelIds).not.toContain(ids.model);
      const reset = await app.inject({ method: 'PUT', url: `/api/v1/admin/users/${user.id}/models/${ids.model}`, headers,
        payload: { access: 'DEFAULT' } });
      expect(reset.statusCode).toBe(200);
      expect((await read()).effectiveModelIds).toContain(ids.model);
    } finally { await app.close(); }
  });

  it('records a referral and awards a qualified paid referral once', async () => {
    const { db, referralCodes, referrals, referralRewards, systemSettings } = dbModule;
    const [code] = await db.insert(referralCodes).values({ userId: ids.secondUser, code: 'V2TESTCODE' }).returning();
    const referral = await referralModule.registerReferral(ids.user, code.code, undefined, '192.0.2.1');
    expect(referral.status).toBe('REGISTERED');
    await db.insert(systemSettings).values({ key: 'referral_policy', value: { enabled: true, minPaidAmount: 1, referrerPoints: 5, referredPoints: 2 } });
    await db.transaction(tx => referralModule.qualifyReferralFromPaidOrder(tx, ids.user, 1));
    await db.transaction(tx => referralModule.qualifyReferralFromPaidOrder(tx, ids.user, 1));
    const [updated] = await db.select().from(referrals).where((await import('drizzle-orm')).eq(referrals.id, referral.id));
    expect(updated.status).toBe('REWARDED');
    expect(await db.select().from(referralRewards)).toHaveLength(2);
  });

  it('flags a shared installation and requires an audited Admin review', async () => {
    const { db, billingOrders, devices, referralRewards, referrals, users } = dbModule;
    const [ownerDevice] = await db.select().from(devices).where((await import('drizzle-orm')).eq(devices.id, ids.secondDevice));
    const [referred] = await db.insert(users).values({ email: `v2-risk-${randomUUID()}@example.test`, passwordHash: 'test' }).returning();
    const [sameInstallation] = await db.insert(devices).values({ userId: referred.id, deviceId: ownerDevice.deviceId, deviceName: 'duplicate', platform: 'test' }).returning();
    const flagged = await referralModule.registerReferral(referred.id, 'V2TESTCODE', sameInstallation.id, '192.0.2.2');
    expect(flagged.riskFlags).toContain('SAME_INSTALLATION');
    expect(flagged.status).toBe('PENDING');
    await db.insert(billingOrders).values({ orderNo: randomUUID(), userId: referred.id, planId: ids.plan, amount: '5', currency: 'CNY', provider: 'MANUAL', status: 'PAID', paidAt: new Date() });
    const app = await (await import('./server.js')).createServer();
    try {
      const token = await (await import('./security.js')).issueAccess(ids.admin, undefined, 'ADMIN');
      const review = await app.inject({ method: 'POST', url: `/api/v1/admin/referrals/${flagged.id}/review`, headers: { authorization: `Bearer ${token}` },
        payload: { decision: 'APPROVE', reason: 'Verified paid user and device ownership' } });
      expect(review.statusCode).toBe(200);
      const [updated] = await db.select().from(referrals).where((await import('drizzle-orm')).eq(referrals.id, flagged.id));
      expect(updated.status).toBe('REWARDED');
      expect((await db.select().from(referralRewards)).filter(reward => reward.referralId === flagged.id)).toHaveLength(2);
    } finally { await app.close(); }
  });

  it('audits Admin point adjustments and publishes new rate versions without rewriting history', async () => {
    const { db, auditLogs, rateCardVersions, usageEvents } = dbModule;
    const app = await (await import('./server.js')).createServer();
    try {
      const token = await (await import('./security.js')).issueAccess(ids.admin, undefined, 'ADMIN');
      const headers = { authorization: `Bearer ${token}` };
      const idempotencyKey = randomUUID();
      const payload = { points: 5, reason: 'Correct verified billing dispute', idempotencyKey };
      const first = await app.inject({ method: 'POST', url: `/api/v1/admin/users/${ids.user}/wallet/adjust`, headers, payload });
      const repeat = await app.inject({ method: 'POST', url: `/api/v1/admin/users/${ids.user}/wallet/adjust`, headers, payload });
      expect(first.statusCode).toBe(200);
      expect(repeat.json().duplicate).toBe(true);
      const create = await app.inject({ method: 'POST', url: `/api/v1/admin/rate-cards/${ids.rateCard}/versions`, headers,
        payload: { inputRate:'5', outputRate:'6', cachedInputRate:'1', reasoningRate:'8', imageInputRate:'0', imageOutputRate:'0', toolRate:'0', minimumCharge:0, effectiveFrom:null } });
      expect(create.statusCode).toBe(201);
      const publish = await app.inject({ method: 'POST', url: `/api/v1/admin/rate-card-versions/${create.json().id}/publish`, headers, payload: {} });
      expect(publish.statusCode).toBe(200);
      expect((await meterModule.activeRateVersion(ids.provider, ids.model, 'MANAGED_USAGE'))?.version).toBe(3);
      expect((await db.select().from(usageEvents)).some(event => event.rateCardVersionId === ids.rateVersion)).toBe(true);
      expect((await db.select().from(auditLogs)).some(log => log.action === 'WALLET_ADJUSTED')).toBe(true);
      expect((await db.select().from(rateCardVersions)).filter(version => version.status === 'ACTIVE')).toHaveLength(1);
    } finally { await app.close(); }
  });

  it('registers a referred account atomically and rejects invalid, duplicate and self referrals', async () => {
    const { db, users, referrals, referralRewards } = dbModule;
    const { eq } = await import('drizzle-orm');
    const codeText = 'V2TESTCODE';
    const app = await (await import('./server.js')).createServer();
    const email = `v2-onboard-${randomUUID()}@example.test`;
    const invalidEmail = `v2-invalid-${randomUUID()}@example.test`;
    const rollbackEmail = `v2-rollback-${randomUUID()}@example.test`;
    try {
      const register = (candidate: string, referralCode: string) => app.inject({ method: 'POST', url: '/api/v1/auth/register',
        payload: { email: candidate, password: 'testpassword123', referralCode } });
      const invalid = await register(invalidEmail, 'INVALIDCODE');
      expect(invalid.statusCode).toBe(404);
      expect(invalid.json().error.code).toBe('INVALID_REFERRAL_CODE');
      expect(await db.select().from(users).where(eq(users.email, invalidEmail))).toHaveLength(0);

      await db.execute(sql.raw("create function reject_v2_test_referral() returns trigger language plpgsql as $$ begin raise exception 'TEST_REFERRAL_INSERT_FAILED'; end $$"));
      await db.execute(sql.raw('create trigger reject_v2_test_referral before insert on referrals for each row execute function reject_v2_test_referral()'));
      try {
        const failed = await register(rollbackEmail, codeText);
        expect(failed.statusCode).toBe(500);
        expect(await db.select().from(users).where(eq(users.email, rollbackEmail))).toHaveLength(0);
      } finally {
        await db.execute(sql.raw('drop trigger reject_v2_test_referral on referrals'));
        await db.execute(sql.raw('drop function reject_v2_test_referral()'));
      }

      const created = await register(email, codeText);
      expect(created.statusCode).toBe(201);
      const [account] = await db.select().from(users).where(eq(users.email, email));
      const [referral] = await db.select().from(referrals).where(eq(referrals.referredUserId, account.id));
      expect(referral.referrerUserId).toBe(ids.secondUser);
      expect(referral.status).toBe('REGISTERED');
      expect(await db.select().from(referralRewards).where(eq(referralRewards.referralId, referral.id))).toHaveLength(0);
      const duplicate = await register(email, codeText);
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().error.code).toBe('EMAIL_IN_USE');
      await expect(referralModule.registerReferral(account.id, codeText)).rejects.toMatchObject({ code: 'REFERRAL_NOT_ELIGIBLE' });
      await expect(referralModule.registerReferral(ids.secondUser, codeText)).rejects.toMatchObject({ code: 'REFERRAL_NOT_ELIGIBLE' });
    } finally { await app.close(); }
  });

  it('rates SHADOW usage without changing the wallet or creating a usage debit', async () => {
    const { db, aiRequests, walletTransactions } = dbModule;
    const { eq } = await import('drizzle-orm');
    const before = await walletModule.walletSummary(ids.secondUser);
    const [request] = await db.insert(aiRequests).values({ responseId: `resp_${randomUUID().replaceAll('-', '')}`, userId: ids.secondUser,
      deviceId: ids.secondDevice, providerId: ids.provider, modelId: ids.model, billingPolicy: 'MANAGED_USAGE',
      rateCardVersionId: ids.rateVersion, status: 'STARTED' }).returning();
    const event = await meterModule.settleAiRequest(request.id, 'COMPLETED', {
      usage: { inputTokens: 1000, outputTokens: 1000 }, providerReportedUsage: { input_tokens: 1000, output_tokens: 1000 },
    }, 'SHADOW');
    expect(event.billingStatus).toBe('SHADOW');
    expect(event.pointsRated).toBe(30);
    expect(event.pointsCharged).toBe(0);
    expect(event.rateCardVersionId).toBe(ids.rateVersion);
    expect((await walletModule.walletSummary(ids.secondUser)).balance).toBe(before.balance);
    expect(await db.select().from(walletTransactions).where(eq(walletTransactions.referenceId, request.id))).toHaveLength(0);
    expect((await meterModule.settleAiRequest(request.id, 'COMPLETED', {}, 'SHADOW')).id).toBe(event.id);
  });
});
