import type { FastifyInstance } from 'fastify';
import { db, auditLogs, billingOrders, devices, models, modelInstances, planModelAccess, plans, providerCredentials, providers, refreshTokens, releases, subscriptions, systemSettings, usageRecords, userModelAccess, users, webSessions, rateCards, rateCardVersions } from '@bridge/db';
import { and, desc, eq, ilike, sql, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { admin, allowedModels, ApiError, audit, changeDeviceStatus, currentSubscription, currentUsage } from './core.js';
import { nextPeriod } from './logic.js';
import { providerFor, DeepSeekProvider, isDeepSeekProvider } from './provider.js';
import { currentRatePolicy, UserLimitsSchema } from './rate-policy.js';
import { currentBillingMode } from './billing-mode.js';
import { encryptSecret, hashPassword } from './security.js';
import { grantSubscriptionPoints } from './wallet.js';
import { qualifyReferralFromPaidOrder } from './referral.js';
import { publicWebsiteSettings, saveWebsiteSettings, websiteSettingsInput } from './website-settings.js';
import { currentDeepSeekModel, ensureLegacyInstance } from './instance-router.js';
import { registerBillingReview } from './billing-review.js';
import { retainLatestPublishedRelease } from './release-lifecycle.js';

const planData = z.object({ name: z.string().min(1), description: z.string(), monthlyPrice: z.number().nonnegative(), currency: z.string().length(3), maxDevices: z.number().int().positive(), monthlyTokenLimit: z.number().int().positive(), monthlyUsageCreditLimit: z.number().positive(), maxConcurrentRequests: z.number().int().positive(), requestsPerMinute: z.number().int().positive(), enabled: z.boolean(), monthlyPoints: z.number().int().min(0).optional(), rolloverPolicy: z.enum(['NONE', 'UNLIMITED']).optional() });
const modelData = z.object({ providerId: z.uuid(), providerModelId: z.string().min(1), publicId: z.string().min(1), displayName: z.string().min(1), enabled: z.boolean(), supportsTools: z.boolean(), supportsVision: z.boolean(), supportsReasoning: z.boolean(), supportsStreaming: z.boolean(), contextWindow: z.number().int().positive().nullable(), maxOutputTokens: z.number().int().positive().nullable(), usageWeight: z.number().positive(), sortOrder: z.number().int() });
const idParam = (params: unknown) => z.uuid().parse((params as { id: string }).id);

export function assertProviderPatchAllowed(code: string, patch: { enabled?: boolean; apiKey?: string }) {
  if (code !== 'COPILOT') return;
  if (patch.enabled) throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Copilot adapter requires a reviewed GitHub integration');
  if (patch.apiKey !== undefined) throw new ApiError(409, 'PROVIDER_CONNECTION_UNAVAILABLE', 'Copilot credentials require reviewed authentication');
}

async function requireModelProviderReady(providerId: string) {
  const [provider] = await db.select().from(providers).where(eq(providers.id, providerId)).limit(1);
  if (!provider) throw new ApiError(404, 'PROVIDER_NOT_FOUND');
  if (provider.code === 'COPILOT' || !provider.enabled) throw new ApiError(409, 'PROVIDER_NOT_READY');
  const health = await (await providerFor(provider.id, provider.code)).health();
  if (!health.ready) throw new ApiError(409, 'PROVIDER_NOT_READY');
}

async function grant(userId: string, planId: string, days?: number) {
  const now = new Date();
  const [latest] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt)).limit(1);
  const periodStart = latest?.currentPeriodEnd && latest.currentPeriodEnd > now && latest.planId === planId ? latest.currentPeriodStart : now;
  const periodEnd = latest?.currentPeriodEnd && latest.currentPeriodEnd > now && latest.planId === planId ? new Date(latest.currentPeriodEnd.getTime() + (days ?? 30) * 86400000) : days ? new Date(now.getTime() + days * 86400000) : nextPeriod(now);
  return db.transaction(async tx => {
    const [sub] = await tx.insert(subscriptions).values({ userId, planId, status: 'ACTIVE', startedAt: now, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd }).returning();
    await grantSubscriptionPoints(tx, sub.id);
    const [assignedPlan]=await tx.select().from(plans).where(eq(plans.id,planId)).limit(1);
    if(assignedPlan?.code==='QUARTER') await tx.insert(systemSettings).values({key:'user_quota:'+userId,value:{rmbLimit:assignedPlan.monthlyPoints/10000}}).onConflictDoUpdate({target:systemSettings.key,set:{value:{rmbLimit:assignedPlan.monthlyPoints/10000},updatedAt:new Date()}});
    return sub;
  });
}
export async function registerAdmin(app: FastifyInstance) {
  await registerBillingReview(app);
  app.get('/api/v1/admin/model-instances', async req => { await admin(req); return {data:await db.select().from(modelInstances).orderBy(modelInstances.createdAt)}; });
  app.post('/api/v1/admin/model-instances', async (req,reply) => {
    const a = await admin(req);
    const data = z.object({modelId:z.uuid(),providerId:z.uuid(),providerModelId:z.string().min(1).max(120),priority:z.number().int().min(-100000).max(100000).default(0),weight:z.number().int().min(0).max(100000).default(1)}).parse(req.body);
    const [model] = await db.select().from(models).where(eq(models.id,data.modelId)).limit(1);
    const [provider] = await db.select().from(providers).where(eq(providers.id,data.providerId)).limit(1);
    if (!model || !provider || !isDeepSeekProvider(provider.code)) throw new ApiError(400,'MODEL_PROVIDER_MISMATCH');
    // The existing rate-card identity is provider/logical model; prohibit ambiguous upstream costs.
    if (model.providerModelId !== data.providerModelId) throw new ApiError(409,'RATE_CARD_IDENTITY_MISMATCH','同一逻辑模型仅绑定相同上游型号，避免费率混用。');
    const [instance] = await db.insert(modelInstances).values({...data,enabled:false,healthStatus:'UNKNOWN'}).onConflictDoNothing().returning();
    if (!instance) throw new ApiError(409,'INSTANCE_ALREADY_EXISTS');
    await audit(a.user.id,'MODEL_INSTANCE_CREATED','MODEL_INSTANCE',instance.id,{modelId:data.modelId,providerId:data.providerId});
    return reply.code(201).send(instance);
  });
  app.patch('/api/v1/admin/model-instances/:id', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = z.object({enabled:z.boolean().optional(),priority:z.number().int().min(-100000).max(100000).optional(),weight:z.number().int().min(0).max(100000).optional()}).strict().parse(req.body);
    const [instance] = await db.select().from(modelInstances).where(eq(modelInstances.id,id)).limit(1);
    if (!instance) throw new ApiError(404,'NOT_FOUND');
    if (data.enabled && instance.healthStatus !== 'READY') throw new ApiError(409,'PROVIDER_NOT_READY','请先检查资源连接，再启用。');
    const [updated] = await db.update(modelInstances).set(data).where(eq(modelInstances.id,id)).returning();
    await audit(a.user.id,'MODEL_INSTANCE_UPDATED','MODEL_INSTANCE',id,data); return updated;
  });
  app.post('/api/v1/admin/model-instances/:id/check', async req => {
    const a = await admin(req); const id=idParam(req.params);
    const [instance] = await db.select().from(modelInstances).where(eq(modelInstances.id,id)).limit(1);
    if (!instance) throw new ApiError(404,'NOT_FOUND');
    const [provider] = await db.select().from(providers).where(eq(providers.id,instance.providerId)).limit(1);
    if (!provider || !isDeepSeekProvider(provider.code) || !currentDeepSeekModel(instance.providerModelId)) throw new ApiError(422,'UNSUPPORTED_CAPABILITY','此型号尚无原生 Responses 兼容证据。');
    const adapter = await providerFor(provider.id,provider.code);
    if (!adapter.executeNative) throw new ApiError(422,'UNSUPPORTED_PROTOCOL');
    try {
      const normal = await adapter.executeNative({model:instance.providerModelId,input:'Reply OK.',stream:false,reasoning:{mode:'normal'},maxOutputTokens:32},instance.providerModelId,AbortSignal.timeout(20000));
      if (!normal.output.length) throw new ApiError(502,'PROTOCOL_INVALID');
      let sawTerminal = false;
      const thinking = await adapter.executeNative({model:instance.providerModelId,input:'Call bridge_probe with value 1.',stream:true,reasoning:{mode:'thinking',effort:'low'},tools:[{type:'function',name:'bridge_probe',parameters:{type:'object',properties:{value:{type:'integer'}},required:['value']}}],maxOutputTokens:512},instance.providerModelId,AbortSignal.timeout(45000),async()=>{sawTerminal=true;});
      if (!sawTerminal || !thinking.output.some(i=>i.type==='function_call') || !thinking.output.some(i=>i.type==='reasoning')) throw new ApiError(502,'PROTOCOL_INVALID','思考工具兼容探测未通过。');
      const [updated] = await db.update(modelInstances).set({healthStatus:'READY',healthCheckedAt:new Date(),cooldownUntil:null,nativeProtocols:['responses','chat_completions'],capabilities:{tools:true,vision:instance.providerModelId==='deepseek-flash',reasoning:true,streaming:true,reasoningModes:['normal','thinking','auto'],defaultReasoningMode:'auto',evidence:'deepseek-responses-probe'}}).where(eq(modelInstances.id,id)).returning();
      await audit(a.user.id,'MODEL_INSTANCE_CHECKED','MODEL_INSTANCE',id,{ready:true,inputTokens:normal.inputTokens+thinking.inputTokens,outputTokens:normal.outputTokens+thinking.outputTokens}); return updated;
    } catch (error) {
      await db.update(modelInstances).set({healthStatus:'UNAVAILABLE',healthCheckedAt:new Date()}).where(eq(modelInstances.id,id));
      throw error;
    }
  });
  app.get('/api/v1/admin/website-settings', async req => {
    await admin(req);
    return publicWebsiteSettings();
  });
  app.put('/api/v1/admin/website-settings', async req => {
    const a = await admin(req);
    const body = websiteSettingsInput.parse(req.body);
    const result = await saveWebsiteSettings(body);
    await audit(a.user.id, 'WEBSITE_SETTINGS_UPDATED', 'SYSTEM', 'website_verification');
    return result;
  });
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
    return { data: await db.select({ id: users.id, email: users.email, role: users.role, status: users.status, createdAt: users.createdAt }).from(users).where(and(ne(users.status, 'DELETED'), q.search ? ilike(users.email, `%${q.search}%`) : undefined)).orderBy(desc(users.createdAt)).limit(100) };
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
    const active = await currentSubscription(id);
    const limits = await currentRatePolicy(id);
    return { user, devices: await db.select().from(devices).where(eq(devices.userId, id)), subscriptions: await db.select().from(subscriptions).where(eq(subscriptions.userId, id)).orderBy(desc(subscriptions.createdAt)),
      usage: active ? await currentUsage(id, active.subscription, active.plan) : null,
      recentUsage: await db.select().from(usageRecords).where(eq(usageRecords.userId, id)).orderBy(desc(usageRecords.createdAt)).limit(50),
      limits: { accountRpm: limits.accountRpm, deviceRpm: limits.deviceRpm, planRpm: active?.plan.requestsPerMinute ?? null, maxDevices: active?.plan.maxDevices ?? null, maxConcurrentRequests: active?.plan.maxConcurrentRequests ?? null } };
  });
  app.patch('/api/v1/admin/users/:id', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = z.object({ status: z.enum(['ACTIVE', 'DISABLED', 'EXPIRED']) }).parse(req.body);
    if (id === a.user.id && data.status !== 'ACTIVE') throw new ApiError(400, 'CANNOT_DISABLE_SELF');
    const [user] = await db.update(users).set(data).where(and(eq(users.id, id), ne(users.status, 'DELETED'))).returning({ id: users.id, email: users.email, status: users.status });
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
  app.delete('/api/v1/admin/users/:id', async req => {
    const a = await admin(req); const id = idParam(req.params);
    if (id === a.user.id) throw new ApiError(400, 'CANNOT_DISABLE_SELF');
    await db.transaction(async tx => {
      const [user] = await tx.select().from(users).where(eq(users.id, id)).for('update').limit(1);
      if (!user || user.status === 'DELETED') throw new ApiError(404, 'NOT_FOUND');
      if (user.role === 'ADMIN') throw new ApiError(409, 'FORBIDDEN', '管理员账号不可在用户管理中删除。');
      await tx.update(users).set({ status: 'DELETED' }).where(eq(users.id, id));
      await tx.update(devices).set({ status: 'BLOCKED', authVersion: sql`${devices.authVersion} + 1`, updatedAt: new Date() }).where(eq(devices.userId, id));
      await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.userId, id));
      await tx.update(webSessions).set({ revokedAt: new Date() }).where(eq(webSessions.userId, id));
      await tx.insert(auditLogs).values({ actorId: a.user.id, action: 'USER_DELETED', targetType: 'USER', targetId: id });
    });
    return { deleted: true, historyRetained: true };
  });
  app.put('/api/v1/admin/users/:id/quota', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = z.union([z.object({ rmbLimit: z.number().min(0).max(100000).refine(n=>Number.isSafeInteger(Math.round(n*10000))) }).strict(),z.object({ tokenLimit: z.number().int().min(1).max(1_000_000_000), creditLimit: z.number().int().min(1).max(1_000_000_000) }).strict()]).parse(req.body);
    const [user] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), ne(users.status, 'DELETED'))).limit(1);
    if (!user) throw new ApiError(404, 'NOT_FOUND');
    await db.transaction(async tx => {
      await tx.insert(systemSettings).values({ key: 'user_quota:' + id, value: data }).onConflictDoUpdate({ target: systemSettings.key, set: { value: data, updatedAt: new Date() } });
      await tx.insert(auditLogs).values({ actorId: a.user.id, action: 'USER_QUOTA_UPDATED', targetType: 'USER', targetId: id, metadata: data });
    });
    return data;
  });
  app.put('/api/v1/admin/users/:id/limits', async req => {
    const a = await admin(req); const id = idParam(req.params); const data = UserLimitsSchema.parse(req.body);
    const [user] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), ne(users.status, 'DELETED'))).limit(1);
    if (!user) throw new ApiError(404, 'NOT_FOUND');
    await db.transaction(async tx => {
      await tx.insert(systemSettings).values({ key: `user_limits:${id}`, value: data }).onConflictDoUpdate({ target: systemSettings.key, set: { value: data, updatedAt: new Date() } });
      await tx.insert(auditLogs).values({ actorId: a.user.id, action: 'USER_LIMITS_UPDATED', targetType: 'USER', targetId: id, metadata: data });
    });
    return data;
  });
  app.put('/api/v1/admin/users/:id/models', async req => {
    const a = await admin(req); const id = idParam(req.params); const { modelIds } = z.object({ modelIds: z.array(z.uuid()).max(200) }).parse(req.body);
    await db.transaction(async tx => {
      const [user] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, id), ne(users.status, 'DELETED'))).for('update').limit(1);
      if (!user) throw new ApiError(404, 'NOT_FOUND');
      const all = await tx.select({ id: models.id }).from(models);
      const known = new Set(all.map(m => m.id)); if (modelIds.some(id => !known.has(id))) throw new ApiError(400, 'MODEL_NOT_AVAILABLE');
      const selected = new Set(modelIds);
      if (all.length) await tx.insert(userModelAccess).values(all.map(m => ({ userId: id, modelId: m.id, access: selected.has(m.id) ? 'ALLOW' : 'DENY' }))).onConflictDoUpdate({ target: [userModelAccess.userId, userModelAccess.modelId], set: { access: sql`excluded.access` } });
      await tx.insert(auditLogs).values({ actorId: a.user.id, action: 'USER_MODELS_UPDATED', targetType: 'USER', targetId: id, metadata: { modelIds: [...selected] } });
    });
    return { modelIds };
  });
  app.get('/api/v1/admin/devices', async req => { await admin(req); return { data: await db.select().from(devices).orderBy(desc(devices.activatedAt)).limit(200) }; });
  app.patch('/api/v1/admin/devices/:id', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = z.object({ status: z.enum(['ACTIVE', 'REVOKED', 'BLOCKED']) }).parse(req.body);
    const device = await changeDeviceStatus(id, data.status);
    await audit(a.user.id, 'DEVICE_STATUS_CHANGED', 'DEVICE', id, data);
    return device;
  });
  app.get('/api/v1/admin/plans', async req => { await admin(req); return { data: await db.select().from(plans) }; });
  app.patch('/api/v1/admin/plans/:id', async req => {
    const a = await admin(req); const id = idParam(req.params); const data = planData.parse(req.body);
    const [current] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
    if (!current) throw new ApiError(404, 'NOT_FOUND');
    const [plan] = await db.update(plans).set({ ...data, monthlyPrice: String(data.monthlyPrice), monthlyUsageCreditLimit: String(data.monthlyUsageCreditLimit) }).where(eq(plans.id, id)).returning();
    if (!plan) throw new ApiError(404, 'NOT_FOUND');
    await audit(a.user.id, 'PLAN_UPDATED', 'PLAN', id);
    return plan;
  });
  app.get('/api/v1/admin/subscriptions', async req => { await admin(req); return { data: await db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt)).limit(200) }; });
  app.post('/api/v1/admin/subscriptions/grant', async req => {
    const a = await admin(req);
    const data = z.object({ userId: z.uuid(), planCode: z.enum(['STANDARD', 'PRO', 'PAYG', 'QUARTER']), days: z.number().int().min(1).max(365).default(30) }).parse(req.body);
    const [plan] = await db.select().from(plans).where(eq(plans.code, data.planCode)).limit(1);
    if (!plan) throw new ApiError(404, 'PLAN_NOT_FOUND');
    if (!plan.enabled) {
      if (plan.code !== 'PRO' || currentBillingMode() !== 'SHADOW') throw new ApiError(409, 'PLAN_REQUIRED', '此服务套餐未启用。');
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('internal_test_user_ids', 0))`);
        const [setting] = await tx.select().from(systemSettings).where(eq(systemSettings.key, 'internal_test_user_ids')).limit(1);
        const ids = Array.isArray(setting?.value) ? setting.value.filter((id): id is string => typeof id === 'string') : [];
        await tx.insert(systemSettings).values({ key: 'internal_test_user_ids', value: [...new Set([...ids, data.userId])] }).onConflictDoUpdate({ target: systemSettings.key, set: { value: [...new Set([...ids, data.userId])], updatedAt: new Date() } });
      });
    }
    const subscription = await grant(data.userId, plan.id, data.planCode === "QUARTER" ? 90 : data.days);

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
      await grantSubscriptionPoints(tx, sub.id);
      await qualifyReferralFromPaidOrder(tx, order.userId, Number(order.amount));
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
  app.post('/api/v1/admin/providers', async (req, reply) => {
    const a = await admin(req);
    const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(req.body);
    const code = `DEEPSEEK_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    const [provider] = await db.insert(providers).values({ code, name, baseUrl: 'https://api.deepseek.com', enabled: false }).returning();
    await audit(a.user.id, 'PROVIDER_CREATED', 'PROVIDER', provider.id, { name, code });
    return reply.code(201).send(provider);
  });
  app.patch('/api/v1/admin/providers/:id', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = z.object({ enabled: z.boolean().optional(), baseUrl: z.url().optional(), timeoutMs: z.number().int().min(1000).max(120000).optional(), apiKey: z.string().min(1).optional() }).parse(req.body);
    const [provider] = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
    if (!provider) throw new ApiError(404, 'NOT_FOUND');
    assertProviderPatchAllowed(provider.code, data);
    const updated = await db.transaction(async tx => {
      if (data.apiKey) {
        const secret = encryptSecret(data.apiKey);
        await tx.insert(providerCredentials).values({ providerId: id, ...secret }).onConflictDoUpdate({ target: providerCredentials.providerId, set: { ...secret, updatedAt: new Date() } });
      }
      const [row] = data.enabled === undefined && data.baseUrl === undefined && data.timeoutMs === undefined
        ? [provider]
        : await tx.update(providers).set({ enabled: data.enabled, baseUrl: data.baseUrl, timeoutMs: data.timeoutMs }).where(eq(providers.id, id)).returning();
      await tx.insert(auditLogs).values({ actorId: a.user.id, action: 'PROVIDER_UPDATED', targetType: 'PROVIDER', targetId: id,
        metadata: { enabled: data.enabled, credentialChanged: Boolean(data.apiKey) } });
      return row;
    });
    return { ...updated, credential: 'MASKED' };
  });
  app.get('/api/v1/admin/providers/:id/health', async req => {
    await admin(req); const id = idParam(req.params);
    const [p] = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
    if (!p) throw new ApiError(404, 'NOT_FOUND');
    if (!p.enabled) return { ready: false, reason: 'DISABLED' };
    try { return await (await providerFor(p.id, p.code)).health(); } catch { return { ready: false, reason: 'NOT_CONFIGURED' }; }
  });
  app.post('/api/v1/admin/providers/:id/connect-deepseek', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const { apiKey, modelId } = z.object({ apiKey: z.string().trim().min(10).max(512), modelId: z.string().trim().min(3).max(120).optional() }).parse(req.body);
    const [provider] = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
    if (!provider || !isDeepSeekProvider(provider.code)) throw new ApiError(400, 'MODEL_PROVIDER_MISMATCH');
    // Connect only to the official endpoint; never send this credential to an admin-supplied URL.
    const adapter = new DeepSeekProvider('https://api.deepseek.com', apiKey, 15000);
    let catalog: string[];
    try { catalog = (await adapter.listModels()).filter(model => /^deepseek-[a-z0-9-]+$/.test(model)); }
    catch (error) { throw new ApiError(400, 'PROVIDER_AUTH_REQUIRED', `DeepSeek 连接检查失败：${error instanceof Error ? error.message : 'UNREACHABLE'}`); }
    if (modelId && !catalog.includes(modelId)) throw new ApiError(400, 'MODEL_NOT_AVAILABLE', '此 API Key 的模型目录中没有该模型。');
    const selected = modelId ?? (catalog.includes('deepseek-flash') ? 'deepseek-flash' : catalog.includes('deepseek-chat') ? 'deepseek-chat' : catalog.find(model => !model.includes('reasoner')));
    if (!selected) throw new ApiError(409, 'MODEL_UNAVAILABLE', '当前模型目录没有可接入的通用模型。');
    const shadow = currentBillingMode() === 'SHADOW';
    const connected = await db.transaction(async tx => {
      await tx.select().from(providers).where(eq(providers.id, id)).for('update');
      const secret = encryptSecret(apiKey);
      await tx.insert(providerCredentials).values({ providerId: id, ...secret }).onConflictDoUpdate({ target: providerCredentials.providerId, set: { ...secret, updatedAt: new Date() } });
      await tx.update(providers).set({ enabled: true, baseUrl: 'https://api.deepseek.com' }).where(eq(providers.id, id));
      const connectedModels: typeof models.$inferSelect[] = [];
      for (const selected of (modelId ? [modelId] : catalog)) {
      const publicId = provider.code === 'DEEPSEEK' ? `deepseek/${selected}` : `deepseek/${provider.code.slice(9).toLowerCase()}/${selected}`;
      const [model] = await tx.insert(models).values({ providerId: id, providerModelId: selected, publicId,
        displayName: `${provider.name} · ${selected}`, enabled: true, supportsTools: true, supportsStreaming: true, supportsReasoning: false,
        supportsVision: selected === 'deepseek-flash', usageWeight: '1' }).onConflictDoUpdate({ target: models.publicId,
        set: { displayName: `${provider.name} · ${selected}`, enabled: true, supportsTools: true, supportsStreaming: true, supportsReasoning: false, supportsVision: selected === 'deepseek-flash' } }).returning();
      // Only SHADOW may use an explicit zero-rate test card. Never invent a commercial price.
      if (shadow) {
        await tx.insert(rateCards).values({ providerId: id, modelId: model.id, billingPolicy: 'MANAGED_USAGE' }).onConflictDoNothing();
        const [card] = await tx.select().from(rateCards).where(and(eq(rateCards.modelId, model.id), eq(rateCards.billingPolicy, 'MANAGED_USAGE'))).limit(1);
        const [version] = await tx.select().from(rateCardVersions).where(eq(rateCardVersions.rateCardId, card.id)).limit(1);
        if (!version) await tx.insert(rateCardVersions).values({ rateCardId: card.id, version: 1, status: 'ACTIVE', effectiveFrom: new Date(), createdBy: a.user.id,
          inputRate: '0', outputRate: '0', cachedInputRate: '0', reasoningRate: '0', imageInputRate: '0', imageOutputRate: '0', toolRate: '0', minimumCharge: 0 });
      }
        connectedModels.push(model);
      }
      await tx.insert(auditLogs).values({ actorId: a.user.id, action: 'DEEPSEEK_CONNECTED', targetType: 'PROVIDER', targetId: id,
        metadata: { modelIds: connectedModels.map(model=>model.id), catalog, shadowTestRate: shadow } });
      return connectedModels;
    });
    return { ready: true, model: connected.find(model=>model.providerModelId===selected)??connected[0], models: connected, catalog, billingMode: currentBillingMode(), requiresUserAccess: true };
  });
  app.get('/api/v1/admin/models', async req => { await admin(req); return { data: await db.select().from(models).orderBy(models.sortOrder) }; });
  app.get('/api/v1/admin/model-access', async req => {
    await admin(req);
    const { userId } = z.object({ userId: z.uuid().optional() }).parse(req.query);
    const planAccess = await db.select({ planId: planModelAccess.planId, modelId: planModelAccess.modelId }).from(planModelAccess);
    if (!userId) return { planAccess, overrides: [], subscription: null, effectiveModelIds: [] };
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new ApiError(404, 'NOT_FOUND');
    const subscription = await currentSubscription(userId);
    const [overrides, effective] = await Promise.all([
      db.select({ modelId: userModelAccess.modelId, access: userModelAccess.access }).from(userModelAccess).where(eq(userModelAccess.userId, userId)),
      subscription ? allowedModels(userId, subscription.plan.id) : Promise.resolve([]),
    ]);
    return { planAccess, overrides, subscription: subscription
      ? { planId: subscription.plan.id, planCode: subscription.plan.code, status: subscription.subscription.status } : null,
      effectiveModelIds: effective.map(({ model }) => model.id) };
  });
  app.post('/api/v1/admin/models', async (req, reply) => {
    const a = await admin(req); const data = modelData.parse(req.body);
    if (data.enabled) await requireModelProviderReady(data.providerId);
    const [model] = await db.insert(models).values({ ...data, usageWeight: String(data.usageWeight) }).returning();
    await audit(a.user.id, 'MODEL_CREATED', 'MODEL', model.id);
    return reply.code(201).send(model);
  });
  app.patch('/api/v1/admin/models/:id', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = modelData.partial().parse(req.body);
    if (data.enabled === true || data.providerId !== undefined) {
      const [previous] = await db.select({ providerId: models.providerId, enabled: models.enabled }).from(models).where(eq(models.id, id)).limit(1);
      if (!previous) throw new ApiError(404, 'NOT_FOUND');
      if (data.enabled ?? previous.enabled) await requireModelProviderReady(data.providerId ?? previous.providerId);
    }
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
    const data = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/), channel: z.enum(['stable', 'beta']), platform: z.string().min(1), arch: z.string().min(1), downloadUrl: z.url(), sha256: z.string().regex(/^[a-fA-F0-9]{64}$/), releaseNotes: z.string().default(''), published: z.boolean().default(false) }).parse(req.body);
    const [release] = await db.insert(releases).values(data).returning();
    await audit(a.user.id, 'RELEASE_CREATED', 'RELEASE', release.id);
    if(release.published)await retainLatestPublishedRelease(release.id,a.user.id);
    return reply.code(201).send(release);
  });
  app.patch('/api/v1/admin/releases/:id', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = z.object({ published: z.boolean(), releaseNotes: z.string().optional() }).parse(req.body);
    if(data.published){const [entry]=await db.select().from(releases).where(eq(releases.id,id)).limit(1);if(!entry)throw new ApiError(404,'NOT_FOUND');z.string().regex(/^\d+\.\d+\.\d+$/).parse(entry.version);}
    const [release] = await db.update(releases).set(data).where(eq(releases.id, id)).returning();
    if (!release) throw new ApiError(404, 'NOT_FOUND');
    await audit(a.user.id, 'RELEASE_UPDATED', 'RELEASE', id);
    if(release.published)await retainLatestPublishedRelease(release.id,a.user.id);
    return release;
  });
  app.get('/api/v1/admin/audit', async req => { await admin(req); return { data: await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(200) }; });
  app.get('/api/v1/admin/system', async req => { await admin(req); await db.execute(sql`select 1`); return { database: 'ok', gateway: 'ok', settings: await db.select({ key: systemSettings.key, updatedAt: systemSettings.updatedAt }).from(systemSettings) }; });
}
