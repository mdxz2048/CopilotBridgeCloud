import type { FastifyInstance } from 'fastify';
import { aiRequests, db, devices, providerAccountCredentials, providerAccounts, providers, referralRewards, referrals, refreshTokens, usageEvents, walletTransactions, wallets } from '@bridge/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { actor, allowedModels, ApiError, audit, changeDeviceStatus, currentSubscription, currentUsage } from './core.js';
import { referralCodeFor, registerReferral } from './referral.js';
import { walletSummary } from './wallet.js';
import { encryptSecret } from './security.js';
import { DeepSeekProvider } from './provider.js';

const uuidParam = (params: unknown) => z.uuid().parse((params as { id: string }).id);
async function usageSummary(req: Parameters<typeof actor>[0]) {
  const a = await actor(req); const active = await currentSubscription(a.user.id);
  const [totals] = await db.select({ requests: sql<number>`count(*)`, pointsRated: sql<number>`coalesce(sum(${usageEvents.pointsRated}), 0)`, pointsCharged: sql<number>`coalesce(sum(${usageEvents.pointsCharged}), 0)` })
    .from(usageEvents).where(eq(usageEvents.userId, a.user.id));
  return { requests: Number(totals.requests), pointsRated: Number(totals.pointsRated), pointsCharged: Number(totals.pointsCharged),
    legacy: active ? await currentUsage(a.user.id, active.subscription, active.plan) : null };
}
async function referralSummary(req: Parameters<typeof actor>[0]) {
  const a = await actor(req);
  const [counts] = await db.select({ total: sql<number>`count(*)`, rewarded: sql<number>`count(*) filter (where ${referrals.status} = 'REWARDED')` }).from(referrals).where(eq(referrals.referrerUserId, a.user.id));
  const [points] = await db.select({ earned: sql<number>`coalesce(sum(${referralRewards.points}), 0)` }).from(referralRewards).where(eq(referralRewards.beneficiaryUserId, a.user.id));
  return { code: (await referralCodeFor(a.user.id)).code, registered: Number(counts.total), rewarded: Number(counts.rewarded), pointsEarned: Number(points.earned) };
}
export async function registerV2Routes(app: FastifyInstance) {
  app.get('/api/v1/me', async req => {
    const a = await actor(req);
    const active = await currentSubscription(a.user.id);
    const [deviceCount] = await db.select({ count: sql<number>`count(*)` }).from(devices).where(and(eq(devices.userId, a.user.id), eq(devices.status, 'ACTIVE')));
    return { account: { id: a.user.id, email: a.user.email, status: a.user.status },
      subscription: active ? { id: active.subscription.id, status: active.subscription.status, planCode: active.plan.code, periodStart: active.subscription.currentPeriodStart, periodEnd: active.subscription.currentPeriodEnd, monthlyPoints: active.plan.monthlyPoints, maxDevices: active.plan.maxDevices, rolloverPolicy: active.plan.rolloverPolicy } : null,
      wallet: await walletSummary(a.user.id), activeDevices: Number(deviceCount.count) };
  });
  app.get('/api/v1/me/subscription', async req => {
    const active = await currentSubscription((await actor(req)).user.id);
    return { subscription: active?.subscription ?? null, plan: active?.plan ?? null };
  });
  app.get('/api/v1/me/wallet', async req => walletSummary((await actor(req)).user.id));
  app.get('/api/v1/me/devices', async req => ({ data: await db.select().from(devices).where(eq(devices.userId, (await actor(req)).user.id)).orderBy(desc(devices.activatedAt)) }));
  app.get('/api/v1/me/wallet/transactions', async req => {
    const a = await actor(req);
    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, a.user.id)).limit(1);
    return { data: wallet ? await db.select({ id: walletTransactions.id, type: walletTransactions.type, points: walletTransactions.points,
      balanceAfter: walletTransactions.balanceAfter, referenceType: walletTransactions.referenceType, referenceId: walletTransactions.referenceId, createdAt: walletTransactions.createdAt })
      .from(walletTransactions).where(eq(walletTransactions.walletId, wallet.id)).orderBy(desc(walletTransactions.createdAt)).limit(100) : [] };
  });
  app.get('/api/v1/me/usage', usageSummary);
  app.get('/api/v1/usage', usageSummary);
  app.get('/api/v1/providers', async req => {
    const a = await actor(req); const active = await currentSubscription(a.user.id);
    if (!active) return { data: [] };
    const allowed = await allowedModels(a.user.id, active.plan.id);
    return { data: [...new Map(allowed.map(({ provider }) => [provider.id, { id: provider.id, code: provider.code, name: provider.name, ownership: 'MANAGED', status: provider.enabled ? 'ACTIVE' : 'DISABLED' }])).values()] };
  });
  app.get('/api/v1/providers/:id', async req => {
    const a = await actor(req); const id = uuidParam(req.params); const active = await currentSubscription(a.user.id);
    const allowed = active ? await allowedModels(a.user.id, active.plan.id) : [];
    const p = allowed.find(({ provider }) => provider.id === id)?.provider;
    if (!p) throw new ApiError(404, 'NOT_FOUND');
    return { id: p.id, code: p.code, name: p.name, ownership: 'MANAGED', status: 'ACTIVE' };
  });
  app.get('/api/v1/providers/:id/models', async req => {
    const a = await actor(req); const id = uuidParam(req.params); const active = await currentSubscription(a.user.id);
    const allowed = active ? await allowedModels(a.user.id, active.plan.id) : [];
    return { data: allowed.filter(({ provider }) => provider.id === id).map(({ model }) => ({ id: model.id, publicId: model.publicId, displayName: model.displayName,
      capabilities: { tools: model.supportsTools, vision: model.supportsVision, reasoning: model.supportsReasoning, streaming: model.supportsStreaming } })) };
  });
  app.get('/api/v1/me/provider-connections', async req => {
    const a = await actor(req);
    return { data: await db.select({ id: providerAccounts.id, providerId: providerAccounts.providerId, ownership: providerAccounts.ownership,
      status: providerAccounts.status, label: providerAccounts.label, createdAt: providerAccounts.createdAt, updatedAt: providerAccounts.updatedAt })
      .from(providerAccounts).where(eq(providerAccounts.userId, a.user.id)).orderBy(desc(providerAccounts.createdAt)) };
  });
  app.post('/api/v1/me/provider-connections', async (req, reply) => {
    const a = await actor(req);
    const data = z.object({ providerId: z.uuid(), label: z.string().trim().min(1).max(120), apiKey: z.string().min(8).max(4096) }).parse(req.body);
    const [provider] = await db.select().from(providers).where(and(eq(providers.id, data.providerId), eq(providers.enabled, true))).limit(1);
    if (!provider || provider.code !== 'DEEPSEEK') throw new ApiError(409, 'PROVIDER_CONNECTION_UNAVAILABLE');
    const adapter = new DeepSeekProvider(provider.baseUrl ?? 'https://api.deepseek.com', data.apiKey, Math.min(provider.timeoutMs, 10000));
    const validation = await adapter.validateCredential();
    if (!validation.valid) throw new ApiError(403, 'PROVIDER_AUTH_REQUIRED');
    const connection = await db.transaction(async tx => {
      const [account] = await tx.insert(providerAccounts).values({ providerId: provider.id, userId: a.user.id, ownership: 'BYOS', status: 'ACTIVE', label: data.label }).returning();
      await tx.insert(providerAccountCredentials).values({ accountId: account.id, ...encryptSecret(data.apiKey) });
      return account;
    });
    await audit(a.user.id, 'PROVIDER_CONNECTION_CREATED', 'PROVIDER_ACCOUNT', connection.id, { providerId: provider.id });
    return reply.code(201).send({ id: connection.id, providerId: connection.providerId, ownership: connection.ownership, status: connection.status, label: connection.label });
  });
  app.delete('/api/v1/me/provider-connections/:id', async req => {
    const a = await actor(req); const id = uuidParam(req.params);
    const [account] = await db.select().from(providerAccounts).where(and(eq(providerAccounts.id, id), eq(providerAccounts.userId, a.user.id))).limit(1);
    if (!account) throw new ApiError(404, 'NOT_FOUND');
    await db.transaction(async tx => {
      await tx.delete(providerAccountCredentials).where(eq(providerAccountCredentials.accountId, id));
      await tx.update(providerAccounts).set({ status: 'DISABLED', updatedAt: new Date() }).where(eq(providerAccounts.id, id));
    });
    await audit(a.user.id, 'PROVIDER_CONNECTION_DISABLED', 'PROVIDER_ACCOUNT', id);
    return { id, status: 'DISABLED' };
  });
  app.post('/api/v1/devices/:id/revoke', async req => {
    const a = await actor(req); const id = uuidParam(req.params);
    const device = await changeDeviceStatus(id, 'REVOKED', a.user.id);
    await audit(a.user.id, 'DEVICE_REVOKED', 'DEVICE', id);
    return { device };
  });
  app.patch('/api/v1/devices/:id', async req => {
    const a = await actor(req); const id = uuidParam(req.params);
    const { deviceName } = z.object({ deviceName: z.string().trim().min(1).max(120) }).parse(req.body);
    const [device] = await db.update(devices).set({ deviceName, updatedAt: new Date() }).where(and(eq(devices.id, id), eq(devices.userId, a.user.id))).returning();
    if (!device) throw new ApiError(404, 'NOT_FOUND');
    await audit(a.user.id, 'DEVICE_RENAMED', 'DEVICE', id);
    return { device };
  });
  app.get('/api/v1/referral/code', async req => {
    const code = await referralCodeFor((await actor(req)).user.id);
    return { code: code.code, status: code.status };
  });
  app.post('/api/v1/referral/apply', async req => {
    const a = await actor(req);
    const { code } = z.object({ code: z.string().trim().min(8).max(24) }).parse(req.body);
    const referral = await registerReferral(a.user.id, code, a.device?.id, req.ip);
    return { id: referral.id, status: referral.status, riskReviewRequired: referral.riskFlags.length > 0 };
  });
  app.get('/api/v1/referral/stats', referralSummary);
  app.get('/api/v1/referral', referralSummary);
  app.get('/api/v1/referral/history', async req => {
    const a = await actor(req);
    return { data: await db.select({ id: referrals.id, status: referrals.status, registeredAt: referrals.registeredAt, qualifiedAt: referrals.qualifiedAt })
      .from(referrals).where(eq(referrals.referrerUserId, a.user.id)).orderBy(desc(referrals.registeredAt)).limit(100) };
  });
  app.get('/api/v1/usage/requests/:id', async req => {
    const a = await actor(req); const id = uuidParam(req.params);
    const [request] = await db.select({ id: aiRequests.id, responseId: aiRequests.responseId, status: aiRequests.status, billingPolicy: aiRequests.billingPolicy,
      createdAt: aiRequests.createdAt, completedAt: aiRequests.completedAt }).from(aiRequests).where(and(eq(aiRequests.id, id), eq(aiRequests.userId, a.user.id))).limit(1);
    if (!request) throw new ApiError(404, 'NOT_FOUND');
    const [event] = await db.select({ inputTokens: usageEvents.inputTokens, outputTokens: usageEvents.outputTokens, cachedInputTokens: usageEvents.cachedInputTokens,
      reasoningTokens: usageEvents.reasoningTokens, pointsRated: usageEvents.pointsRated, pointsCharged: usageEvents.pointsCharged,
      billingStatus: usageEvents.billingStatus, rateCardVersionId: usageEvents.rateCardVersionId }).from(usageEvents).where(eq(usageEvents.requestId, id)).limit(1);
    return { request, usage: event ?? null, wallet: await walletSummary(a.user.id) };
  });
  app.get('/api/v1/usage/responses/:id', async req => {
    const a = await actor(req);
    const responseId = z.string().regex(/^resp_[a-f0-9]{32}$/).parse((req.params as { id: string }).id);
    const [request] = await db.select({ id: aiRequests.id, responseId: aiRequests.responseId, status: aiRequests.status, billingPolicy: aiRequests.billingPolicy,
      createdAt: aiRequests.createdAt, completedAt: aiRequests.completedAt }).from(aiRequests).where(and(eq(aiRequests.responseId, responseId), eq(aiRequests.userId, a.user.id))).limit(1);
    if (!request) throw new ApiError(404, 'NOT_FOUND');
    const [event] = await db.select({ inputTokens: usageEvents.inputTokens, outputTokens: usageEvents.outputTokens, cachedInputTokens: usageEvents.cachedInputTokens,
      reasoningTokens: usageEvents.reasoningTokens, pointsRated: usageEvents.pointsRated, pointsCharged: usageEvents.pointsCharged,
      billingStatus: usageEvents.billingStatus, rateCardVersionId: usageEvents.rateCardVersionId }).from(usageEvents).where(eq(usageEvents.requestId, request.id)).limit(1);
    return { request, usage: event ?? null, wallet: await walletSummary(a.user.id) };
  });
}
