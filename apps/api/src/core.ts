import { db, auditLogs, devices, models, planModelAccess, plans, providers, refreshTokens, subscriptions, usageRecords, userModelAccess, users, webSessions } from '@bridge/db';
import { and, desc, eq, gte, inArray, isNull, lt, sql, sum } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { config } from './config.js';
import { integrationMockAllowed, modelAllowed, subscriptionActive, usageState } from './logic.js';
import { hashRefresh, readAccess } from './security.js';
import { claimDeviceProof, verifyDeviceProof } from './device-proof.js';
import { ApiError } from './errors.js';

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
  }
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
  const tokenState = usageState(tokens, plan.monthlyTokenLimit);
  const creditState = usageState(credit, Number(plan.monthlyUsageCreditLimit));
  return { tokens, credit, requests: Number(row?.requests ?? 0), tokenLimit: plan.monthlyTokenLimit, creditLimit: Number(plan.monthlyUsageCreditLimit), percent: Math.max(tokenState.percent, creditState.percent), threshold: Math.max(tokenState.threshold, creditState.threshold) };
}
export async function allowedModels(userId: string, planId: string) {
  const [account] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!account) return [];
  const all = await db.select({ model: models, provider: providers }).from(models).innerJoin(providers, eq(models.providerId, providers.id)).where(and(eq(models.enabled, true), eq(providers.enabled, true))).orderBy(models.sortOrder);
  const planRows = await db.select().from(planModelAccess).where(eq(planModelAccess.planId, planId));
  const overrides = await db.select().from(userModelAccess).where(eq(userModelAccess.userId, userId));
  const planSet = new Set(planRows.map(row => row.modelId));
  const overrideMap = new Map(overrides.map(row => [row.modelId, row.access]));
  return all.filter(({ model, provider }) => integrationMockAllowed(provider.code, account.email, process.env.INTEGRATION_MOCK_ENABLED === 'true', process.env.INTEGRATION_MOCK_TEST_EMAIL)
    && modelAllowed(model.enabled, planSet.has(model.id), overrideMap.get(model.id)));
}
export async function requireEntitlement(userId: string, deviceId: string, publicModelId: string) {
  const active = await currentSubscription(userId);
  if (!active) throw await subscriptionError(userId);
  const { subscription, plan } = active;
  const allowed = await allowedModels(userId, plan.id);
  const found = allowed.find(({ model }) => model.publicId === publicModelId);
  if (!found) throw new ApiError(403, 'MODEL_NOT_ALLOWED');
  const usage = await currentUsage(userId, subscription, plan);
  if (usage.threshold >= 100) throw new ApiError(429, 'MONTHLY_QUOTA_EXCEEDED');
  return { ...active, ...found, usage };
}
