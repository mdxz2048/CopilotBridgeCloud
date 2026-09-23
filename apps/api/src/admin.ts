import type { FastifyInstance } from 'fastify';
import { db, auditLogs, billingOrders, devices, models, planModelAccess, plans, providerCredentials, providers, refreshTokens, releases, subscriptions, systemSettings, usageRecords, userModelAccess, users, webSessions } from '@bridge/db';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { admin, ApiError, audit } from './core.js';
import { nextPeriod } from './logic.js';
import { providerFor } from './provider.js';
import { encryptSecret, hashPassword } from './security.js';

const planData = z.object({ name: z.string().min(1), description: z.string(), monthlyPrice: z.number().nonnegative(), currency: z.string().length(3), maxDevices: z.number().int().positive(), monthlyTokenLimit: z.number().int().positive(), monthlyUsageCreditLimit: z.number().positive(), maxConcurrentRequests: z.number().int().positive(), requestsPerMinute: z.number().int().positive(), enabled: z.boolean() });
const modelData = z.object({ providerId: z.uuid(), providerModelId: z.string().min(1), publicId: z.string().min(1), displayName: z.string().min(1), enabled: z.boolean(), supportsTools: z.boolean(), supportsVision: z.boolean(), supportsReasoning: z.boolean(), supportsStreaming: z.boolean(), contextWindow: z.number().int().positive().nullable(), maxOutputTokens: z.number().int().positive().nullable(), usageWeight: z.number().positive(), sortOrder: z.number().int() });
const idParam = (params: unknown) => z.uuid().parse((params as { id: string }).id);

async function grant(userId: string, planId: string, days?: number) {
  const now = new Date();
  const [latest] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt)).limit(1);
  const periodStart = latest?.currentPeriodEnd && latest.currentPeriodEnd > now && latest.planId === planId ? latest.currentPeriodStart : now;
  const periodEnd = latest?.currentPeriodEnd && latest.currentPeriodEnd > now && latest.planId === planId ? new Date(latest.currentPeriodEnd.getTime() + (days ?? 30) * 86400000) : days ? new Date(now.getTime() + days * 86400000) : nextPeriod(now);
  const [sub] = await db.insert(subscriptions).values({ userId, planId, status: 'ACTIVE', startedAt: now, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd }).returning();
  return sub;
}
export async function registerAdmin(app: FastifyInstance) {
  app.get('/api/v1/admin/dashboard', async req => {
    await admin(req);
    const [[userCount], [deviceCount], [orderCount], [usageCount]] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(users), db.select({ count: sql<number>`count(*)` }).from(devices),
      db.select({ count: sql<number>`count(*)` }).from(billingOrders), db.select({ count: sql<number>`count(*)` }).from(usageRecords),
    ]);
    return { users: Number(userCount.count), devices: Number(deviceCount.count), orders: Number(orderCount.count), requests: Number(usageCount.count) };
  });
  app.get('/api/v1/admin/users', async req => {
    await admin(req);
    const q = z.object({ search: z.string().optional() }).parse(req.query);
    return { data: await db.select({ id: users.id, email: users.email, role: users.role, status: users.status, createdAt: users.createdAt }).from(users).where(q.search ? ilike(users.email, `%${q.search}%`) : undefined).orderBy(desc(users.createdAt)).limit(100) };
  });
  app.post('/api/v1/admin/users', async (req, reply) => {
    const a = await admin(req);
    const data = z.object({ email: z.email(), password: z.string().min(12), role: z.enum(['USER', 'ADMIN']).default('USER') }).parse(req.body);
    const [user] = await db.insert(users).values({ email: data.email.toLowerCase(), passwordHash: await hashPassword(data.password), role: data.role }).onConflictDoNothing().returning();
    if (!user) throw new ApiError(409, 'EMAIL_IN_USE');
    await audit(a.user.id, 'USER_CREATED', 'USER', user.id);
    return reply.code(201).send({ id: user.id, email: user.email, role: user.role, status: user.status });
  });
  app.get('/api/v1/admin/users/:id', async req => {
    await admin(req);
    const id = idParam(req.params);
    const [user] = await db.select({ id: users.id, email: users.email, role: users.role, status: users.status, createdAt: users.createdAt }).from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new ApiError(404, 'NOT_FOUND');
    return { user, devices: await db.select().from(devices).where(eq(devices.userId, id)), subscriptions: await db.select().from(subscriptions).where(eq(subscriptions.userId, id)).orderBy(desc(subscriptions.createdAt)) };
  });
  app.patch('/api/v1/admin/users/:id', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = z.object({ status: z.enum(['ACTIVE', 'DISABLED', 'EXPIRED']) }).parse(req.body);
    if (id === a.user.id && data.status !== 'ACTIVE') throw new ApiError(400, 'CANNOT_DISABLE_SELF');
    const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning({ id: users.id, email: users.email, status: users.status });
    if (!user) throw new ApiError(404, 'NOT_FOUND');
    await audit(a.user.id, 'USER_STATUS_CHANGED', 'USER', id, data);
    return user;
  });
  app.post('/api/v1/admin/users/:id/reset-password', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = z.object({ password: z.string().min(12) }).parse(req.body);
    const [user] = await db.update(users).set({ passwordHash: await hashPassword(data.password) }).where(eq(users.id, id)).returning({ id: users.id });
    if (!user) throw new ApiError(404, 'NOT_FOUND');
    await Promise.all([
      db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.userId, id)),
      db.update(webSessions).set({ revokedAt: new Date() }).where(eq(webSessions.userId, id)),
    ]);
    await audit(a.user.id, 'PASSWORD_RESET', 'USER', id);
    return { ok: true };
  });
  app.get('/api/v1/admin/devices', async req => { await admin(req); return { data: await db.select().from(devices).orderBy(desc(devices.activatedAt)).limit(200) }; });
  app.patch('/api/v1/admin/devices/:id', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = z.object({ status: z.enum(['ACTIVE', 'REVOKED']) }).parse(req.body);
    const [device] = await db.update(devices).set(data).where(eq(devices.id, id)).returning();
    if (!device) throw new ApiError(404, 'NOT_FOUND');
    await audit(a.user.id, 'DEVICE_STATUS_CHANGED', 'DEVICE', id, data);
    return device;
  });
  app.get('/api/v1/admin/plans', async req => { await admin(req); return { data: await db.select().from(plans) }; });
  app.patch('/api/v1/admin/plans/:id', async req => {
    const a = await admin(req); const id = idParam(req.params); const data = planData.parse(req.body);
    const [plan] = await db.update(plans).set({ ...data, monthlyPrice: String(data.monthlyPrice), monthlyUsageCreditLimit: String(data.monthlyUsageCreditLimit) }).where(eq(plans.id, id)).returning();
    if (!plan) throw new ApiError(404, 'NOT_FOUND');
    await audit(a.user.id, 'PLAN_UPDATED', 'PLAN', id);
    return plan;
  });
  app.get('/api/v1/admin/subscriptions', async req => { await admin(req); return { data: await db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt)).limit(200) }; });
  app.post('/api/v1/admin/subscriptions/grant', async req => {
    const a = await admin(req);
    const data = z.object({ userId: z.uuid(), planCode: z.enum(['STANDARD', 'PRO']), days: z.number().int().min(1).max(365).default(30) }).parse(req.body);
    const [plan] = await db.select().from(plans).where(eq(plans.code, data.planCode)).limit(1);
    if (!plan) throw new ApiError(404, 'PLAN_NOT_FOUND');
    const subscription = await grant(data.userId, plan.id, data.days);
    await audit(a.user.id, 'SUBSCRIPTION_GRANTED', 'SUBSCRIPTION', subscription.id, { userId: data.userId, planCode: data.planCode, days: data.days });
    return subscription;
  });
  app.patch('/api/v1/admin/subscriptions/:id', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = z.object({ action: z.enum(['SUSPEND', 'CANCEL', 'EXTEND', 'UPGRADE', 'DOWNGRADE']), planCode: z.enum(['STANDARD', 'PRO']).optional(), days: z.number().int().min(1).max(365).optional() }).parse(req.body);
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
    if (!sub) throw new ApiError(404, 'NOT_FOUND');
    let patch: Partial<typeof subscriptions.$inferInsert> = {};
    if (data.action === 'SUSPEND') patch.status = 'SUSPENDED';
    if (data.action === 'CANCEL') patch.cancelAtPeriodEnd = true;
    if (data.action === 'EXTEND') patch.currentPeriodEnd = new Date(sub.currentPeriodEnd.getTime() + (data.days ?? 30) * 86400000);
    if (data.action === 'UPGRADE' || data.action === 'DOWNGRADE') {
      if (!data.planCode) throw new ApiError(400, 'PLAN_REQUIRED');
      const [plan] = await db.select().from(plans).where(eq(plans.code, data.planCode)).limit(1);
      if (!plan) throw new ApiError(404, 'PLAN_NOT_FOUND');
      patch = data.action === 'UPGRADE' ? { planId: plan.id } : { pendingPlanId: plan.id };
    }
    const [updated] = await db.update(subscriptions).set(patch).where(eq(subscriptions.id, id)).returning();
    await audit(a.user.id, `SUBSCRIPTION_${data.action}`, 'SUBSCRIPTION', id, data);
    return updated;
  });
  app.get('/api/v1/admin/usage', async req => { await admin(req); return { data: await db.select().from(usageRecords).orderBy(desc(usageRecords.createdAt)).limit(200) }; });
  app.get('/api/v1/admin/orders', async req => { await admin(req); return { data: await db.select().from(billingOrders).orderBy(desc(billingOrders.createdAt)).limit(200) }; });
  app.post('/api/v1/admin/orders/:id/mark-paid', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const result = await db.transaction(async tx => {
      const [order] = await tx.update(billingOrders).set({ status: 'PAID', paidAt: new Date() }).where(and(eq(billingOrders.id, id), eq(billingOrders.status, 'PENDING'), eq(billingOrders.provider, 'MANUAL'))).returning();
      if (!order) throw new ApiError(409, 'ORDER_NOT_PAYABLE');
      const now = new Date();
      const [sub] = await tx.insert(subscriptions).values({ userId: order.userId, planId: order.planId, status: 'ACTIVE', startedAt: now, currentPeriodStart: now, currentPeriodEnd: nextPeriod(now) }).returning();
      await tx.insert(auditLogs).values({ actorId: a.user.id, action: 'MANUAL_ORDER_PAID', targetType: 'ORDER', targetId: order.id, metadata: { subscriptionId: sub.id } });
      return { order, subscription: sub };
    });
    return result;
  });
  app.get('/api/v1/admin/providers', async req => {
    await admin(req);
    const rows = await db.select().from(providers);
    return { data: rows.map(p => ({ ...p, config: p.config, credential: 'MASKED' })) };
  });
  app.patch('/api/v1/admin/providers/:id', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = z.object({ enabled: z.boolean().optional(), baseUrl: z.url().optional(), timeoutMs: z.number().int().min(1000).max(120000).optional(), apiKey: z.string().min(1).optional() }).parse(req.body);
    const [provider] = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
    if (!provider) throw new ApiError(404, 'NOT_FOUND');
    if (provider.code === 'COPILOT' && data.enabled) throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Copilot adapter requires a reviewed GitHub integration');
    if (data.apiKey) {
      const secret = encryptSecret(data.apiKey);
      await db.insert(providerCredentials).values({ providerId: id, ...secret }).onConflictDoUpdate({ target: providerCredentials.providerId, set: { ...secret, updatedAt: new Date() } });
    }
    const [updated] = await db.update(providers).set({ enabled: data.enabled, baseUrl: data.baseUrl, timeoutMs: data.timeoutMs }).where(eq(providers.id, id)).returning();
    await audit(a.user.id, 'PROVIDER_UPDATED', 'PROVIDER', id, { enabled: data.enabled, credentialChanged: Boolean(data.apiKey) });
    return { ...updated, credential: 'MASKED' };
  });
  app.get('/api/v1/admin/providers/:id/health', async req => {
    await admin(req); const id = idParam(req.params);
    const [p] = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
    if (!p) throw new ApiError(404, 'NOT_FOUND');
    if (!p.enabled) return { ready: false, reason: 'DISABLED' };
    try { return await (await providerFor(p.id, p.code)).health(); } catch { return { ready: false, reason: 'NOT_CONFIGURED' }; }
  });
  app.get('/api/v1/admin/models', async req => { await admin(req); return { data: await db.select().from(models).orderBy(models.sortOrder) }; });
  app.post('/api/v1/admin/models', async (req, reply) => {
    const a = await admin(req); const data = modelData.parse(req.body);
    const [model] = await db.insert(models).values({ ...data, usageWeight: String(data.usageWeight) }).returning();
    await audit(a.user.id, 'MODEL_CREATED', 'MODEL', model.id);
    return reply.code(201).send(model);
  });
  app.patch('/api/v1/admin/models/:id', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = modelData.partial().parse(req.body);
    const [model] = await db.update(models).set({ ...data, usageWeight: data.usageWeight === undefined ? undefined : String(data.usageWeight) }).where(eq(models.id, id)).returning();
    if (!model) throw new ApiError(404, 'NOT_FOUND');
    await audit(a.user.id, 'MODEL_UPDATED', 'MODEL', id);
    return model;
  });
  app.put('/api/v1/admin/models/:id/plans/:planId', async req => {
    const a = await admin(req); const modelId = idParam(req.params); const planId = z.uuid().parse((req.params as { planId: string }).planId);
    const { allowed } = z.object({ allowed: z.boolean() }).parse(req.body);
    if (allowed) await db.insert(planModelAccess).values({ modelId, planId }).onConflictDoNothing();
    else await db.delete(planModelAccess).where(and(eq(planModelAccess.modelId, modelId), eq(planModelAccess.planId, planId)));
    await audit(a.user.id, 'PLAN_MODEL_ACCESS_CHANGED', 'MODEL', modelId, { planId, allowed });
    return { allowed };
  });
  app.put('/api/v1/admin/users/:id/models/:modelId', async req => {
    const a = await admin(req); const userId = idParam(req.params); const modelId = z.uuid().parse((req.params as { modelId: string }).modelId);
    const { access } = z.object({ access: z.enum(['ALLOW', 'DENY', 'DEFAULT']) }).parse(req.body);
    if (access === 'DEFAULT') await db.delete(userModelAccess).where(and(eq(userModelAccess.userId, userId), eq(userModelAccess.modelId, modelId)));
    else await db.insert(userModelAccess).values({ userId, modelId, access }).onConflictDoUpdate({ target: [userModelAccess.userId, userModelAccess.modelId], set: { access } });
    await audit(a.user.id, 'USER_MODEL_ACCESS_CHANGED', 'USER', userId, { modelId, access });
    return { access };
  });
  app.get('/api/v1/admin/releases', async req => { await admin(req); return { data: await db.select().from(releases).orderBy(desc(releases.createdAt)) }; });
  app.post('/api/v1/admin/releases', async (req, reply) => {
    const a = await admin(req);
    const data = z.object({ version: z.string().min(1), channel: z.enum(['stable', 'beta']), platform: z.string().min(1), arch: z.string().min(1), downloadUrl: z.url(), sha256: z.string().regex(/^[a-fA-F0-9]{64}$/), releaseNotes: z.string().default(''), published: z.boolean().default(false) }).parse(req.body);
    const [release] = await db.insert(releases).values(data).returning();
    await audit(a.user.id, 'RELEASE_CREATED', 'RELEASE', release.id);
    return reply.code(201).send(release);
  });
  app.patch('/api/v1/admin/releases/:id', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = z.object({ published: z.boolean(), releaseNotes: z.string().optional() }).parse(req.body);
    const [release] = await db.update(releases).set(data).where(eq(releases.id, id)).returning();
    if (!release) throw new ApiError(404, 'NOT_FOUND');
    await audit(a.user.id, 'RELEASE_UPDATED', 'RELEASE', id);
    return release;
  });
  app.get('/api/v1/admin/audit', async req => { await admin(req); return { data: await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(200) }; });
  app.get('/api/v1/admin/system', async req => { await admin(req); await db.execute(sql`select 1`); return { database: 'ok', gateway: 'ok', settings: await db.select().from(systemSettings) }; });
}
