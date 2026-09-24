import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const enabled = Boolean(process.env.V2_TEST_DATABASE_URL);
describe.skipIf(!enabled)('V2 PostgreSQL invariants', () => {
  let dbModule: typeof import('@bridge/db');
  let walletModule: typeof import('./wallet.js');
  let meterModule: typeof import('./metering.js');
  let referralModule: typeof import('./referral.js');
  let sql: typeof import('drizzle-orm').sql;
  let ids: { user: string; secondUser: string; device: string; secondDevice: string; provider: string; model: string; plan: string; rateVersion: string };

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
    const [device] = await db.insert(devices).values({ userId: user.id, deviceId: randomUUID(), deviceName: 'test', platform: 'test' }).returning();
    const [secondDevice] = await db.insert(devices).values({ userId: secondUser.id, deviceId: randomUUID(), deviceName: 'test', platform: 'test' }).returning();
    const [provider] = await db.insert(providers).values({ code: 'V2_TEST', name: 'V2 Test', enabled: true }).returning();
    const [model] = await db.insert(models).values({ providerId: provider.id, providerModelId: 'test', publicId: 'v2/test', displayName: 'Test', enabled: true }).returning();
    const [plan] = await db.insert(plans).values({ code: 'V2_TEST', name: 'V2 Test', monthlyPrice: '1', maxDevices: 3,
      monthlyTokenLimit: 1000000, monthlyUsageCreditLimit: '1000000', maxConcurrentRequests: 10, requestsPerMinute: 100, monthlyPoints: 100, rolloverPolicy: 'UNLIMITED' }).returning();
    const [card] = await db.insert(rateCards).values({ providerId: provider.id, modelId: model.id, billingPolicy: 'MANAGED_USAGE' }).returning();
    const [rateVersion] = await db.insert(rateCardVersions).values({ rateCardId: card.id, version: 1, status: 'ACTIVE', inputRate: '10', outputRate: '20',
      cachedInputRate: '2', reasoningRate: '30', imageInputRate: '3', imageOutputRate: '4', toolRate: '1' }).returning();
    ids = { user: user.id, secondUser: secondUser.id, device: device.id, secondDevice: secondDevice.id, provider: provider.id, model: model.id, plan: plan.id, rateVersion: rateVersion.id };
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
});
