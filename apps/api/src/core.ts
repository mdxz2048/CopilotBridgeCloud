import { db, auditLogs, devices, models, planModelAccess, plans, providers, refreshTokens, subscriptions, usageEvents, usageRecords, userModelAccess, users, webSessions, systemSettings } from '@bridge/db';
import { and, desc, eq, gte, inArray, isNull, lt, sql, sum } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { config } from './config.js';
import { integrationMockAllowed, internalTestAllowed, modelAllowed, subscriptionActive, usageState } from './logic.js';
import { currentBillingMode } from './billing-mode.js';
import { hashRefresh, readAccess } from './security.js';
import { claimDeviceProof, verifyDeviceProof } from './device-proof.js';
import { ApiError } from './errors.js';
import { moneyPolicy } from './money-policy.js';
import { walletSummary } from './wallet.js';
import { requestContext } from './request-log.js';
import { modelCandidates, eligible, ensureLegacyInstance, responsesProfile } from './instance-router.js';
import { latestClientRelease, requireCurrentClient } from './latest-release.js';

export { ApiError };
export type Actor = { user: typeof users.$inferSelect; device?: typeof devices.$inferSelect; web: boolean };

export async function actor(req: FastifyRequest, desktop = false): Promise<Actor> {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  let userId: string;
  let jwtDevice: string | undefined;
  let jwtDeviceVersion: number | undefined;
  if (bearer) {
    try { const token = await readAccess(bearer); userId = token.userId; jwtDevice = token.deviceId; jwtDeviceVersion = token.deviceVersion; }
    catch { throw new ApiError(401, 'TOKEN_EXPIRED'); }
  } else {
    if (desktop) throw new ApiError(401, 'UNAUTHORIZED');
    const sessionToken = req.cookies?.bridge_session;
    if (!sessionToken) throw new ApiError(401, 'UNAUTHORIZED');
    const [session] = await db.select().from(webSessions).where(and(eq(webSessions.tokenHash, hashRefresh(sessionToken)), sql`${webSessions.revokedAt} is null`, gte(webSessions.expiresAt, new Date()))).limit(1);
    if (!session) throw new ApiError(401, 'UNAUTHORIZED');
    userId = session.userId;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.PUBLIC_BASE_URL) throw new ApiError(403, 'CSRF_REJECTED');
  }
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_DISABLED');
  let device: typeof devices.$inferSelect | undefined;
  if (jwtDevice) {
    const [found] = await db.select().from(devices).where(and(eq(devices.id, jwtDevice), eq(devices.userId, userId))).limit(1);
    if (!found) throw new ApiError(403, 'DEVICE_NOT_REGISTERED');
    if (found.status !== 'ACTIVE' || (jwtDeviceVersion ?? 0) !== found.authVersion) throw new ApiError(403, 'DEVICE_REVOKED');
    device = found;
  }
  if (bearer) {
    if (!device) throw new ApiError(401, 'DEVICE_PROOF_INVALID');
    await claimDeviceProof(device.id, await verifyDeviceProof(req, device.publicKeyJwk, bearer));
  }
  if (desktop) {
    const deviceUuid = req.headers['x-device-id'];
    if (!device || typeof deviceUuid !== 'string' || device.deviceId !== deviceUuid) throw new ApiError(403, 'DEVICE_NOT_REGISTERED');
    requireCurrentClient(device.appVersion,(await latestClientRelease())?.version);
  }
  requestContext(req, { userId: user.id, deviceId: device?.id });
  return { user, device, web: !bearer };
}
export async function admin(req: FastifyRequest) {
  const a = await actor(req);
  if (a.user.role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN');
  return a;
}
export async function changeDeviceStatus(id: string, status: 'ACTIVE' | 'REVOKED' | 'BLOCKED', userId?: string) {
  return db.transaction(async tx => {
    const [current] = await tx.select({ status: devices.status }).from(devices)
      .where(userId ? and(eq(devices.id, id), eq(devices.userId, userId)) : eq(devices.id, id)).for('update').limit(1);
    if (!current) throw new ApiError(404, 'NOT_FOUND');
    const changed = current.status !== status;
    const [device] = await tx.update(devices).set({ status, updatedAt: new Date(),
      authVersion: changed ? sql`${devices.authVersion} + 1` : undefined }).where(eq(devices.id, id)).returning();
    if (changed || status !== 'ACTIVE') await tx.update(refreshTokens).set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.deviceId, id), isNull(refreshTokens.revokedAt)));
    return device;
  });
}
export async function audit(actorId: string | null, action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  await db.insert(auditLogs).values({ actorId, action, targetType, targetId, metadata });
}
export async function currentSubscription(userId: string) {
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt)).limit(1);
  if (!subscription || !subscriptionActive(subscription.status, subscription.currentPeriodEnd)) return null;
  const [plan] = await db.select().from(plans).where(eq(plans.id, subscription.planId)).limit(1);
  if (!plan) return null;
  if (plan.enabled) return { subscription, plan };
  const [testAccess] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, 'internal_test_user_ids')).limit(1);
  if (plan.code === 'PRO' && internalTestAllowed(currentBillingMode(), userId, testAccess?.value)) return { subscription, plan };
  const [account] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return plan.code === 'PRO' && account && process.env.INTEGRATION_MOCK_ENABLED === 'true' && account.email.toLowerCase() === process.env.INTEGRATION_MOCK_TEST_EMAIL?.toLowerCase()
    ? { subscription, plan } : null;
}
export async function subscriptionError(userId: string): Promise<ApiError> {
  const [latest] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt)).limit(1);
  return latest && (latest.currentPeriodEnd <= new Date() || latest.status === 'EXPIRED')
    ? new ApiError(403, 'SUBSCRIPTION_EXPIRED') : new ApiError(403, 'SUBSCRIPTION_REQUIRED');
}
export async function currentUsage(userId: string, subscription: typeof subscriptions.$inferSelect, plan: typeof plans.$inferSelect) {
  const [row] = await db.select({ tokens: sum(usageRecords.totalTokens), credit: sum(usageRecords.usageCredit), requests: sql<number>`count(*)` }).from(usageRecords)
    .where(and(eq(usageRecords.userId, userId), gte(usageRecords.createdAt, subscription.currentPeriodStart), lt(usageRecords.createdAt, subscription.currentPeriodEnd), inArray(usageRecords.status, ['RUNNING', 'COMPLETED'])));
  const tokens = Number(row?.tokens ?? 0);
  const credit = Number(row?.credit ?? 0);
  const [setting] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, 'user_quota:' + userId)).limit(1);
  const override = setting?.value as { tokenLimit?: number; creditLimit?: number; rmbLimit?: number } | undefined;
  const tokenLimit = Number.isSafeInteger(override?.tokenLimit) && override!.tokenLimit! > 0 ? override!.tokenLimit! : plan.monthlyTokenLimit;
  const creditLimit = Number.isSafeInteger(override?.creditLimit) && override!.creditLimit! > 0 ? override!.creditLimit! : Number(plan.monthlyUsageCreditLimit);
  const moneyEnabled = typeof override?.rmbLimit === 'number' || ['PAYG','QUARTER'].includes(plan.code) || (await moneyPolicy()).enforceManaged;
  const [moneyRow] = moneyEnabled ? await db.select({ points: sql<number>`coalesce(sum(${usageEvents.pointsRated}),0)` }).from(usageEvents).where(and(eq(usageEvents.userId,userId),gte(usageEvents.createdAt,subscription.currentPeriodStart),lt(usageEvents.createdAt,subscription.currentPeriodEnd),sql`${usageEvents.billingStatus} <> 'SHADOW'`)) : [];
  const [reserved] = moneyEnabled ? await db.select({points:sql<number>`coalesce(sum(${usageRecords.usageCredit}),0)`}).from(usageRecords).where(and(eq(usageRecords.userId,userId),eq(usageRecords.status,"RUNNING"))) : [];
  const reservedPoints=Number(reserved?.points??0);
  const wallet = moneyEnabled ? await walletSummary(userId) : null;
  const pointsUsed = Number(moneyRow?.points??0);
  const rmbLimit = override?.rmbLimit ?? (plan.code === 'QUARTER' ? plan.monthlyPoints / 10000 : moneyEnabled ? (pointsUsed + (wallet?.balance??0))/10000 : null);
  const remainingPoints = moneyEnabled ? Math.max(0,Math.min(wallet?.balance??0,Math.round((rmbLimit??0)*10000)-pointsUsed)-reservedPoints) : 0;
  const moneyLimitPoints = Math.round((rmbLimit??0)*10000);
  const moneyState = {percent: moneyLimitPoints>0?Math.round(pointsUsed*100/moneyLimitPoints):100,threshold:moneyLimitPoints<=0||pointsUsed>=moneyLimitPoints?100:pointsUsed>=moneyLimitPoints*.9?90:pointsUsed>=moneyLimitPoints*.7?70:0};
  const tokenState = moneyEnabled ? moneyState : usageState(tokens, tokenLimit);
  const creditState = moneyEnabled ? moneyState : usageState(credit, creditLimit);
  return { moneyEnabled, rmbLimit, rmbUsed: pointsUsed/10000, remainingRmb: remainingPoints/10000, remainingPoints, balanceRmb: (wallet?.balance??0)/10000, pointsUsed, pointsPerRmb: 10000, tokens, credit, requests: Number(row?.requests ?? 0), tokenLimit, creditLimit, percent: Math.max(tokenState.percent, creditState.percent), threshold: Math.max(tokenState.threshold, creditState.threshold) };
}
export async function allowedModels(userId: string, planId: string, includeUnavailable = false) {
  const [account] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!account) return [];
  const all = await db.select({ model: models, provider: providers }).from(models).innerJoin(providers, eq(models.providerId, providers.id)).where(eq(models.enabled, true)).orderBy(models.sortOrder);
  const planRows = await db.select().from(planModelAccess).where(eq(planModelAccess.planId, planId));
  const overrides = await db.select().from(userModelAccess).where(eq(userModelAccess.userId, userId));
  const planSet = new Set(planRows.map(row => row.modelId));
  const overrideMap = new Map(overrides.map(row => [row.modelId, row.access]));
  const permitted = all.filter(({ model, provider }) => integrationMockAllowed(provider.code, account.email, process.env.INTEGRATION_MOCK_ENABLED === 'true', process.env.INTEGRATION_MOCK_TEST_EMAIL)
    && modelAllowed(model.enabled, planSet.has(model.id), overrideMap.get(model.id)));
  const resolved = await Promise.all(permitted.map(async row => {
    let resources = await modelCandidates(row.model.id);
    if (!resources.length) { await ensureLegacyInstance(row.model); resources = await modelCandidates(row.model.id); }
    const candidates = resources.filter(c => eligible(c));
    if(!includeUnavailable && new Set(candidates.map(c=>responsesProfile(c.provider.code)).filter(Boolean)).size>1)return null;
    // Keep old provider/model identity solely as an additive rollback default.
    return candidates.length || includeUnavailable ? { ...row, provider: candidates[0]?.provider ?? row.provider, candidates:includeUnavailable?resources:candidates } : null;
  }));
  return resolved.filter((row): row is NonNullable<typeof row> => row !== null);
}
export async function requireEntitlement(userId: string, deviceId: string, publicModelId: string) {
  const active = await currentSubscription(userId);
  if (!active) throw await subscriptionError(userId);
  const { subscription, plan } = active;
  const allowed = await allowedModels(userId, plan.id, true);
  const found = allowed.find(({ model }) => model.publicId === publicModelId);
  if (!found) throw new ApiError(403, 'MODEL_NOT_ALLOWED');
  const usage = await currentUsage(userId, subscription, plan);
  if (usage.threshold >= 100) throw new ApiError(429, 'MONTHLY_QUOTA_EXCEEDED', usage.moneyEnabled ? '本周期人民币消费限额已用完，请管理员调整额度。' : '本周期 Token 限额已用完，请管理员调整额度。');
  return { ...active, ...found, usage };
}
