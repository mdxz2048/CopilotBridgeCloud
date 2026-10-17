import { NewPasswordSchema, replacePassword } from './passwords.js';
import type { FastifyInstance } from 'fastify';
import { db, auditLogs, billingOrders, devices, models, modelInstances, planModelAccess, plans, providerCredentials, providers, refreshTokens, releases, subscriptions, systemSettings, usageRecords, usageEvents, userModelAccess, users, webSessions, rateCards, rateCardVersions } from '@bridge/db';
import { and, desc, eq, ilike, sql, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { admin, allowedModels, ApiError, audit, changeDeviceStatus, currentDeviceLimit, currentSubscription, currentUsage } from './core.js';
import { nextPeriod } from './logic.js';
import { providerFor, DeepSeekProvider, isDeepSeekProvider, OpenAIProvider, isOpenAIProvider } from './provider.js';
import { probeOpenAIResponses } from './native-provider-probe.js';
import { declaredOpenAICapabilities, openAIModelPresets } from './openai-catalog.js';
import { currentRatePolicy, UserLimitsSchema } from './rate-policy.js';
import { currentBillingMode } from './billing-mode.js';
import { encryptSecret, decryptSecret, hashPassword } from './security.js';
import { walletSummary, grantSubscriptionPoints } from './wallet.js';
import { qualifyReferralFromPaidOrder } from './referral.js';
import { publicWebsiteSettings, saveWebsiteSettings, websiteSettingsInput } from './website-settings.js';
import { currentDeepSeekModel, ensureLegacyInstance } from './instance-router.js';
import { unresolvedBillingReview, registerBillingReview } from './billing-review.js';
import { retainLatestPublishedRelease } from './release-lifecycle.js';

const planData = z.object({ name: z.string().min(1), description: z.string(), monthlyPrice: z.number().nonnegative(), currency: z.string().length(3), maxDevices: z.number().int().positive(), monthlyTokenLimit: z.number().int().positive(), monthlyUsageCreditLimit: z.number().positive(), maxConcurrentRequests: z.number().int().positive(), requestsPerMinute: z.number().int().positive(), enabled: z.boolean(), monthlyPoints: z.number().int().min(0).optional(), rolloverPolicy: z.enum(['NONE', 'UNLIMITED']).optional() });
const modelData = z.object({ providerId: z.uuid(), providerModelId: z.string().min(1), publicId: z.string().min(1), displayName: z.string().min(1), enabled: z.boolean(), supportsTools: z.boolean(), supportsVision: z.boolean(), supportsReasoning: z.boolean(), supportsStreaming: z.boolean(), contextWindow: z.number().int().positive().nullable(), maxOutputTokens: z.number().int().positive().nullable(), usageWeight: z.number().positive(), sortOrder: z.number().int() });
const idParam = (params: unknown) => z.uuid().parse((params as { id: string }).id);

function archivedModelIds(value:unknown):string[]{const ids=(value as {ids?:unknown}|undefined)?.ids;return Array.isArray(ids)?ids.filter((id):id is string=>typeof id==='string'):[];}
export function openAIEndpoint(value:string) {
  let parsed:URL;try{parsed=new URL(value);}catch{throw new ApiError(400,'VALIDATION_ERROR','请输入有效 HTTPS API 地址。');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[|0\.)/i.test(parsed.hostname))throw new ApiError(400,'VALIDATION_ERROR','API 地址必须为公开 HTTPS 地址，不能包含凭据或查询参数。');
  return parsed.href.replace(/\/$/,'')+(parsed.pathname==='/'?'/v1':'');
}

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
    if (!model || !provider || !(isDeepSeekProvider(provider.code)||isOpenAIProvider(provider.code)) || model.publicId.split('/')[0] !== (isOpenAIProvider(provider.code)?'openai':'deepseek')) throw new ApiError(400,'MODEL_PROVIDER_MISMATCH');
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
    if (!provider || !(isDeepSeekProvider(provider.code)||isOpenAIProvider(provider.code)) || (isDeepSeekProvider(provider.code)&&!currentDeepSeekModel(instance.providerModelId))) throw new ApiError(422,'UNSUPPORTED_CAPABILITY','此型号尚无原生 Responses 兼容证据。');
    const adapter = await providerFor(provider.id,provider.code);
    if (!adapter.executeNative) throw new ApiError(422,'UNSUPPORTED_PROTOCOL');
    try {
      if(isOpenAIProvider(provider.code)) {
        const checked=await probeOpenAIResponses(adapter as OpenAIProvider,instance.providerModelId,instance.capabilities.reasoning===true);
        const declaration=declaredOpenAICapabilities(instance.providerModelId,instance.capabilities.reasoning===true);
        const [updated]=await db.update(modelInstances).set({healthStatus:'READY',healthCheckedAt:new Date(),cooldownUntil:null,nativeProtocols:['responses'],capabilities:{...checked.capabilities,reasoningModes:declaration.reasoningModes,generationVerified:true}}).where(eq(modelInstances.id,id)).returning();
        await audit(a.user.id,'MODEL_INSTANCE_CHECKED','MODEL_INSTANCE',id,{ready:true,inputTokens:checked.inputTokens,outputTokens:checked.outputTokens});return updated;
      }
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
    return { user, wallet:await walletSummary(id), plan:active?{code:active.plan.code,name:active.plan.name}:null, devices: await db.select().from(devices).where(eq(devices.userId, id)), subscriptions: await db.select().from(subscriptions).where(eq(subscriptions.userId, id)).orderBy(desc(subscriptions.createdAt)),
      usage: active ? await currentUsage(id, active.subscription, active.plan) : null,
      billingRisks: (await db.select({ pendingReview: sql<number>`count(*) filter (where ${usageEvents.billingStatus} in ('METERING_ERROR','UNRATED') and ${unresolvedBillingReview})`, unpaidRequests: sql<number>`count(*) filter (where ${usageEvents.billingStatus} = 'UNPAID')`, unpaidPoints: sql<number>`coalesce(sum(${usageEvents.pointsRated} - ${usageEvents.pointsCharged}) filter (where ${usageEvents.billingStatus} = 'UNPAID'),0)` }).from(usageEvents).where(eq(usageEvents.userId,id)))[0],
      recentUsage: await db.select().from(usageRecords).where(eq(usageRecords.userId, id)).orderBy(desc(usageRecords.createdAt)).limit(50),
      limits: { accountRpm: limits.accountRpm, deviceRpm: limits.deviceRpm, planRpm: 0, maxDevices: await currentDeviceLimit(id,active?.plan.maxDevices ?? 3), maxConcurrentRequests: null } };
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
  app.put('/api/v1/admin/users/:id/devices-limit', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = z.object({maxDevices:z.number().int().min(1).max(100)}).strict().parse(req.body);
    return db.transaction(async tx => {
      const [user] = await tx.select({id:users.id}).from(users).where(and(eq(users.id,id),ne(users.status,'DELETED'))).for('update').limit(1);
      if (!user) throw new ApiError(404,'NOT_FOUND');
      await tx.insert(systemSettings).values({key:`user_devices:${id}`,value:data}).onConflictDoUpdate({target:systemSettings.key,set:{value:data,updatedAt:new Date()}});
      await tx.insert(auditLogs).values({actorId:a.user.id,action:'USER_DEVICE_LIMIT_UPDATED',targetType:'USER',targetId:id,metadata:data});
      return data;
    });
  });
  app.post('/api/v1/admin/users/:id/reset-password', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const data = z.object({ password: NewPasswordSchema }).parse(req.body);
    const passwordHash = await hashPassword(data.password);
    await db.transaction(async tx=>{
      const [user] = await tx.select({id:users.id}).from(users).where(eq(users.id,id)).for('update').limit(1);
      if (!user) throw new ApiError(404, 'NOT_FOUND');
      await replacePassword(tx,id,passwordHash,a.user.id,'PASSWORD_RESET');
    });
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
    const { name,kind } = z.object({ name: z.string().trim().min(1).max(120),kind:z.enum(['DEEPSEEK','OPENAI']).default('DEEPSEEK') }).parse(req.body);
    const code = `${kind}_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    const [provider] = await db.insert(providers).values({ code, name, baseUrl: kind==='OPENAI'?'https://api.openai.com/v1':'https://api.deepseek.com', enabled: false }).returning();
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
  app.post('/api/v1/admin/providers/:id/sync-openai',async req=>{
    const a=await admin(req),id=idParam(req.params);
    const data=z.object({baseUrl:z.url(),apiKey:z.string().trim().min(10).max(512).optional(),emptyToolsWorkaround:z.boolean().default(false)}).strict().parse(req.body);
    const endpoint=openAIEndpoint(data.baseUrl);
    const [provider]=await db.select().from(providers).where(eq(providers.id,id)).limit(1);
    if(!provider||!isOpenAIProvider(provider.code))throw new ApiError(400,'MODEL_PROVIDER_MISMATCH');
    const [saved]=await db.select().from(providerCredentials).where(eq(providerCredentials.providerId,id)).limit(1);
    if(!data.apiKey&&!saved)throw new ApiError(400,'PROVIDER_AUTH_REQUIRED','请输入 API Key。');
    const catalog=await new OpenAIProvider(endpoint,data.apiKey??decryptSecret(saved),30000).listModels();
    const imported=await db.transaction(async tx=>{
      await tx.select().from(providers).where(eq(providers.id,id)).for('update');
      if(data.apiKey){const secret=encryptSecret(data.apiKey);await tx.insert(providerCredentials).values({providerId:id,...secret}).onConflictDoUpdate({target:providerCredentials.providerId,set:{...secret,updatedAt:new Date()}});}
      await tx.update(providers).set({baseUrl:endpoint,enabled:true,config:{...provider.config,catalogConfigured:true,emptyToolsWorkaround:data.emptyToolsWorkaround}}).where(eq(providers.id,id));
      if(data.apiKey||endpoint!==provider.baseUrl||data.emptyToolsWorkaround!==provider.config.emptyToolsWorkaround)await tx.update(modelInstances).set({enabled:false,healthStatus:'UNKNOWN',healthCheckedAt:null}).where(eq(modelInstances.providerId,id));
      const rows:Array<typeof models.$inferSelect>=[];
      for(const modelId of catalog){
        if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(modelId))continue;
        const publicId=`openai/${modelId}`,declaration=declaredOpenAICapabilities(modelId,false);
        await tx.insert(models).values({providerId:id,providerModelId:modelId,publicId,displayName:modelId.replace(/^gpt-/,'GPT-').replace(/-sol$/,' Sol').replace(/-terra$/,' Terra'),enabled:false,supportsTools:true,supportsStreaming:true,supportsReasoning:declaration.reasoning,usageWeight:'1',sortOrder:50}).onConflictDoNothing();
        const [model]=await tx.select().from(models).where(eq(models.publicId,publicId)).limit(1);
        await tx.insert(modelInstances).values({modelId:model.id,providerId:id,providerModelId:modelId,enabled:false,nativeProtocols:['responses'],healthStatus:'UNKNOWN',capabilities:declaration}).onConflictDoNothing();rows.push(model);
      }
      // Re-importing a retired model intentionally restores it to management only.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('archived_models',0))`);
      const [setting]=await tx.select().from(systemSettings).where(eq(systemSettings.key,'archived_models')).limit(1);
      if(setting){const ids=(archivedModelIds(setting.value)).filter(id=>!rows.some(m=>m.id===id));await tx.update(systemSettings).set({value:{ids},updatedAt:new Date()}).where(eq(systemSettings.key,'archived_models'));}
      await tx.insert(auditLogs).values({actorId:a.user.id,action:'OPENAI_CATALOG_SYNCED',targetType:'PROVIDER',targetId:id,metadata:{models:rows.map(m=>m.publicId),endpoint,credentialChanged:!!data.apiKey}});return rows;
    });return {catalog,models:imported,generationVerified:false};
  });
  app.post('/api/v1/admin/providers/:id/connect-openai', async req => {
    const a=await admin(req),id=idParam(req.params);
    const {apiKey,modelId,reasoning,verifyGeneration,baseUrl,emptyToolsWorkaround}=z.object({baseUrl:z.url().optional(),emptyToolsWorkaround:z.boolean().optional(),apiKey:z.string().trim().min(10).max(512).optional(),modelId:z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/),reasoning:z.boolean().default(false),verifyGeneration:z.boolean().default(false)}).parse(req.body);
    const [provider]=await db.select().from(providers).where(eq(providers.id,id)).limit(1);
    if(!provider||!isOpenAIProvider(provider.code))throw new ApiError(400,'MODEL_PROVIDER_MISMATCH');
    const endpoint=openAIEndpoint(baseUrl??provider.baseUrl??'https://api.openai.com/v1');
    const workaround=emptyToolsWorkaround??provider.config.emptyToolsWorkaround===true;
    const declaration=declaredOpenAICapabilities(modelId,reasoning);
    const canThink=declaration.reasoning;
    let catalog:string[]=openAIModelPresets.map(model=>model.id);
    let checked:Awaited<ReturnType<typeof probeOpenAIResponses>>|undefined;
    if(verifyGeneration){
      const [saved]=apiKey?[]:await db.select().from(providerCredentials).where(eq(providerCredentials.providerId,id)).limit(1);
      if(!apiKey&&!saved)throw new ApiError(400,'PROVIDER_AUTH_REQUIRED','请先添加 OpenAI API Key，再执行生成检查。');
      const adapter=new OpenAIProvider(endpoint,apiKey??decryptSecret(saved),60000,canThink?[modelId]:[],workaround);
      catalog=await adapter.listModels();
      if(!catalog.includes(modelId))throw new ApiError(400,'MODEL_NOT_AVAILABLE','该 API Key 的模型目录中没有所选模型。');
      checked=await probeOpenAIResponses(adapter,modelId,canThink);
    }
    const model=await db.transaction(async tx=>{
      await tx.select().from(providers).where(eq(providers.id,id)).for('update');
      const [locked]=await tx.select().from(providers).where(eq(providers.id,id)).limit(1);
      if(apiKey){const secret=encryptSecret(apiKey);await tx.insert(providerCredentials).values({providerId:id,...secret}).onConflictDoUpdate({target:providerCredentials.providerId,set:{...secret,updatedAt:new Date()}});}
      const previous=Array.isArray(locked.config.nativeReasoningModels)?locked.config.nativeReasoningModels.filter(value=>typeof value==='string'&&value!==modelId):[];
      await tx.update(providers).set({...(checked?{enabled:true}:{}),baseUrl:endpoint,config:{...locked.config,emptyToolsWorkaround:workaround,catalogConfigured:true,nativeReasoningModels:[...previous,...(canThink?[modelId]:[])]}}).where(eq(providers.id,id));
      const publicId=`openai/${modelId}`;
      await tx.insert(models).values({providerId:id,providerModelId:modelId,publicId,displayName:openAIModelPresets.find(model=>model.id===modelId)?.name??modelId.replace(/^gpt-/,'GPT-').replace(/-sol$/,' Sol').replace(/-terra$/,' Terra'),enabled:true,supportsTools:true,supportsStreaming:true,supportsReasoning:canThink,supportsVision:declaration.vision,usageWeight:'1',sortOrder:50}).onConflictDoNothing();
      const [logical]=await tx.select().from(models).where(eq(models.publicId,publicId)).limit(1);
      const insert=tx.insert(modelInstances).values({modelId:logical.id,providerId:id,providerModelId:modelId,enabled:false,nativeProtocols:['responses'],healthStatus:checked?'READY':'UNKNOWN',healthCheckedAt:checked?new Date():null,capabilities:checked?{...checked.capabilities,reasoningModes:declaration.reasoningModes,generationVerified:true}:declaration});
      if(checked)await insert.onConflictDoUpdate({target:[modelInstances.modelId,modelInstances.providerId,modelInstances.providerModelId],set:{nativeProtocols:['responses'],healthStatus:'READY',healthCheckedAt:new Date(),cooldownUntil:null,capabilities:{...checked.capabilities,reasoningModes:declaration.reasoningModes,generationVerified:true}}});
      else await insert.onConflictDoNothing();
      await tx.insert(auditLogs).values({actorId:a.user.id,action:checked?'OPENAI_CONNECTED':'OPENAI_CONFIGURED',targetType:'PROVIDER',targetId:id,metadata:{modelId:logical.id,inputTokens:checked?.inputTokens??0,outputTokens:checked?.outputTokens??0,reasoning:canThink,verifyGeneration}});
      return logical;
    });
    return {ready:!!checked,configured:true,generationVerified:!!checked,model,models:[model],catalog,billingMode:currentBillingMode(),requiresUserAccess:true,requiresRateCard:true};
  });
  app.post('/api/v1/admin/providers/:id/connect-deepseek', async req => {
    const a = await admin(req); const id = idParam(req.params);
    const { apiKey, modelId } = z.object({ apiKey: z.string().trim().min(10).max(512), modelId: z.string().trim().min(3).max(120).optional() }).parse(req.body);
    const [provider] = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
    if (!provider || !isDeepSeekProvider(provider.code)) throw new ApiError(400, 'MODEL_PROVIDER_MISMATCH');
    // Connect only to the official endpoint; never send this credential to an admin-supplied URL.
    const adapter = new DeepSeekProvider('https://api.deepseek.com', apiKey, 15000);
    let catalog: string[];
    try { catalog = (await adapter.listModels()).filter(currentDeepSeekModel); }
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
      const selectedModels=modelId?[modelId]:[selected];
      for (const selected of selectedModels) {
      const publicId = `deepseek/${selected}`;
      await tx.insert(models).values({ providerId: id, providerModelId: selected, publicId,
        displayName: `DeepSeek · ${selected}`, enabled: false, supportsTools: true, supportsStreaming: true, supportsReasoning: false,
        supportsVision: selected === 'deepseek-flash', usageWeight: '1' }).onConflictDoNothing();
      const [model]=await tx.select().from(models).where(eq(models.publicId,publicId)).limit(1);
      await tx.insert(modelInstances).values({modelId:model.id,providerId:id,providerModelId:selected,enabled:false,healthStatus:'UNKNOWN',nativeProtocols:[],capabilities:{responsesProfile:'deepseek'}}).onConflictDoNothing();
      // Only SHADOW may use an explicit zero-rate test card. Never invent a commercial price.
      if (shadow) {
        await tx.insert(rateCards).values({ providerId: id, modelId: model.id, billingPolicy: 'MANAGED_USAGE' }).onConflictDoNothing();
        const [card] = await tx.select().from(rateCards).where(and(eq(rateCards.providerId,id),eq(rateCards.modelId, model.id), eq(rateCards.billingPolicy, 'MANAGED_USAGE'))).limit(1);
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
  app.get('/api/v1/admin/models', async req => {
    await admin(req);const [setting]=await db.select().from(systemSettings).where(eq(systemSettings.key,'archived_models')).limit(1);
    const archived=archivedModelIds(setting?.value);
    const rows=await db.select().from(models).orderBy(models.sortOrder);
    return {data:rows.filter(model=>!archived.includes(model.id))};
  });
  app.delete('/api/v1/admin/models/:id',async req=>{
    const a=await admin(req),id=idParam(req.params);
    await db.transaction(async tx=>{
      const [model]=await tx.select().from(models).where(eq(models.id,id)).limit(1);if(!model)throw new ApiError(404,'NOT_FOUND');
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('archived_models',0))`);
      const [setting]=await tx.select().from(systemSettings).where(eq(systemSettings.key,'archived_models')).limit(1);
      const ids=[...new Set([...(archivedModelIds(setting?.value)),id])];
      await tx.update(models).set({enabled:false}).where(eq(models.id,id));await tx.update(modelInstances).set({enabled:false}).where(eq(modelInstances.modelId,id));
      await tx.insert(systemSettings).values({key:'archived_models',value:{ids}}).onConflictDoUpdate({target:systemSettings.key,set:{value:{ids},updatedAt:new Date()}});
      await tx.insert(auditLogs).values({actorId:a.user.id,action:'MODEL_ARCHIVED',targetType:'MODEL',targetId:id,metadata:{publicId:model.publicId}});
    });return {archived:true};
  });
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
      if (data.enabled ?? previous.enabled) {
        const resources=await db.select({instance:modelInstances,provider:providers}).from(modelInstances).innerJoin(providers,eq(modelInstances.providerId,providers.id)).where(eq(modelInstances.modelId,id));
        if(!resources.some(({instance:i,provider:p})=>p.enabled&&i.enabled&&i.healthStatus==='READY'))throw new ApiError(409,'PROVIDER_NOT_READY','请先检查并启用模型连接。');
      }
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
  app.get('/api/v1/admin/audit', async req => { await admin(req); return { data: await db.select({id:auditLogs.id,actorId:auditLogs.actorId,actorEmail:users.email,action:auditLogs.action,targetType:auditLogs.targetType,targetId:auditLogs.targetId,metadata:auditLogs.metadata,createdAt:auditLogs.createdAt}).from(auditLogs).leftJoin(users,eq(users.id,auditLogs.actorId)).where(ne(auditLogs.action,'USER_ONLINE')).orderBy(desc(auditLogs.createdAt)).limit(200) }; });
  app.get('/api/v1/admin/system', async req => { await admin(req); await db.execute(sql`select 1`); return { database: 'ok', gateway: 'ok', settings: await db.select({ key: systemSettings.key, updatedAt: systemSettings.updatedAt }).from(systemSettings) }; });
}
