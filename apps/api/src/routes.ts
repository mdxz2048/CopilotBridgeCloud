import type { FastifyInstance } from 'fastify';
import { db, auditLogs, billingOrders, devices, models, plans, refreshTokens, releases, subscriptions, usageRecords, users, webSessions } from '@bridge/db';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DeviceInfoSchema, LoginRequestSchema, RefreshRequestSchema, RegisterRequestV2Schema } from '@bridge/contract';
import { actor, admin, ApiError, audit, currentSubscription, currentUsage, allowedModels, subscriptionError } from './core.js';
import { config } from './config.js';
import { hashPassword, hashRefresh, issueAccess, newRefresh, verifyPassword } from './security.js';
import { registerReferralInTransaction, validateReferralCode } from './referral.js';

const deviceSchema = DeviceInfoSchema;
const loginSchema = LoginRequestSchema.extend({ device: DeviceInfoSchema.optional() });
const secure = config.PUBLIC_BASE_URL.startsWith('https:');
const cookieOptions = { httpOnly: true, secure, sameSite: 'strict' as const, path: '/', maxAge: 60 * 60 * 24 * 7 };

async function registerDevice(userId: string, info: z.infer<typeof deviceSchema>) {
  return db.transaction(async tx => {
    await tx.execute(sql`select id from users where id = ${userId} for update`);
    const [existing] = await tx.select().from(devices).where(and(eq(devices.userId, userId), eq(devices.deviceId, info.deviceId))).limit(1);
    if (existing) {
      if (existing.status !== 'ACTIVE') throw new ApiError(403, 'DEVICE_REVOKED');
      const [updated] = await tx.update(devices).set({ deviceName: info.deviceName, platform: info.platform, osVersion: info.osVersion, appVersion: info.appVersion, lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(devices.id, existing.id)).returning();
      return updated;
    }
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt)).limit(1);
    if (!sub) throw new ApiError(403, 'SUBSCRIPTION_REQUIRED');
    if (sub.currentPeriodEnd <= new Date() || sub.status === 'EXPIRED') throw new ApiError(403, 'SUBSCRIPTION_EXPIRED');
    if (!['ACTIVE', 'TRIAL', 'CANCELED'].includes(sub.status)) throw new ApiError(403, 'SUBSCRIPTION_REQUIRED');
    const [plan] = await tx.select().from(plans).where(eq(plans.id, sub.planId)).limit(1);
    const [{ count }] = await tx.select({ count: sql<number>`count(*)` }).from(devices).where(and(eq(devices.userId, userId), eq(devices.status, 'ACTIVE')));
    if (!plan || Number(count) >= plan.maxDevices) throw new ApiError(409, 'DEVICE_LIMIT_REACHED');
    const [newDevice] = await tx.insert(devices).values({ userId, ...info, lastSeenAt: new Date() }).returning();
    return newDevice;
  });
}
async function issueRefresh(userId: string, deviceId: string) {
  const token = newRefresh();
  await db.insert(refreshTokens).values({ userId, deviceId, tokenHash: hashRefresh(token), expiresAt: new Date(Date.now() + 30 * 86400000) });
  return token;
}
function publicUser(user: typeof users.$inferSelect) { return { id: user.id, email: user.email, role: user.role, status: user.status }; }
function publicV1Device(device: typeof devices.$inferSelect) { return { ...device, status: device.status === 'BLOCKED' ? 'REVOKED' : device.status }; }

export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok', version: '0.1.0' }));
  app.post('/api/v1/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const data = RegisterRequestV2Schema.parse(req.body);
    const passwordHash = await hashPassword(data.password);
    const user = await db.transaction(async tx => {
      if (data.referralCode) await validateReferralCode(tx, data.referralCode);
      const [created] = await tx.insert(users).values({ email: data.email.toLowerCase(), passwordHash }).onConflictDoNothing().returning();
      if (!created) throw new ApiError(409, 'EMAIL_IN_USE');
      if (data.referralCode) await registerReferralInTransaction(tx, created.id, data.referralCode, undefined, req.ip);
      await tx.insert(auditLogs).values({ actorId: created.id, action: 'USER_REGISTERED', targetType: 'USER', targetId: created.id });
      return created;
    });
    return reply.code(201).send({ user: publicUser(user) });
  });
  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const data = loginSchema.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.email, data.email.toLowerCase())).limit(1);
    if (!user || !(await verifyPassword(user.passwordHash, data.password))) throw new ApiError(401, 'INVALID_CREDENTIALS');
    if (user.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_DISABLED');
    if (data.device) {
      const device = await registerDevice(user.id, data.device);
      return { accessToken: await issueAccess(user.id, device.id, user.role), refreshToken: await issueRefresh(user.id, device.id), expiresIn: 1800, user: publicUser(user), device: publicV1Device(device) };
    }
    if (req.headers.origin !== config.PUBLIC_BASE_URL) throw new ApiError(403, 'CSRF_REJECTED');
    const session = newRefresh();
    await db.insert(webSessions).values({ userId: user.id, tokenHash: hashRefresh(session), expiresAt: new Date(Date.now() + 7 * 86400000) });
    reply.setCookie('bridge_session', session, cookieOptions);
    return { user: publicUser(user) };
  });
  app.post('/api/v1/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } }, async req => {
    const { refreshToken } = RefreshRequestSchema.parse(req.body);
    const tokenHash = hashRefresh(refreshToken);
    return db.transaction(async tx => {
      const [old] = await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.tokenHash, tokenHash), sql`${refreshTokens.revokedAt} is null`, gte(refreshTokens.expiresAt, new Date()))).returning();
      if (!old) throw new ApiError(401, 'UNAUTHORIZED');
      const [user] = await tx.select().from(users).where(eq(users.id, old.userId)).limit(1);
      const [device] = await tx.select().from(devices).where(eq(devices.id, old.deviceId)).limit(1);
      if (!user || user.status !== 'ACTIVE' || !device || device.status !== 'ACTIVE') throw new ApiError(403, 'DEVICE_REVOKED');
      const next = newRefresh();
      await tx.insert(refreshTokens).values({ userId: user.id, deviceId: device.id, tokenHash: hashRefresh(next), expiresAt: new Date(Date.now() + 30 * 86400000) });
      return { accessToken: await issueAccess(user.id, device.id, user.role), refreshToken: next, expiresIn: 1800 };
    });
  });
  app.post('/api/v1/auth/logout', async (req, reply) => {
    const a = await actor(req);
    if (a.web) {
      const token = req.cookies.bridge_session;
      if (token) await db.update(webSessions).set({ revokedAt: new Date() }).where(eq(webSessions.tokenHash, hashRefresh(token)));
      reply.clearCookie('bridge_session', { path: '/' });
    } else {
      const token = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
      if (token) await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, a.user.id), eq(refreshTokens.tokenHash, hashRefresh(token))));
    }
    return { ok: true };
  });
  app.get('/api/v1/auth/me', async req => ({ user: publicUser((await actor(req)).user) }));

  app.post('/api/v1/devices/register', async req => {
    const a = await actor(req);
    const info = deviceSchema.parse(req.body);
    return { device: publicV1Device(await registerDevice(a.user.id, info)) };
  });
  app.get('/api/v1/devices', async req => ({ data: (await db.select().from(devices).where(eq(devices.userId, (await actor(req)).user.id)).orderBy(desc(devices.activatedAt))).map(publicV1Device) }));
  app.delete('/api/v1/devices/:id', async req => {
    const a = await actor(req);
    const id = z.uuid().parse((req.params as { id: string }).id);
    const [device] = await db.update(devices).set({ status: 'REVOKED', updatedAt: new Date() }).where(and(eq(devices.id, id), eq(devices.userId, a.user.id))).returning();
    if (!device) throw new ApiError(404, 'NOT_FOUND');
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.deviceId, device.id));
    await audit(a.user.id, 'DEVICE_REVOKED', 'DEVICE', device.id);
    return { device: publicV1Device(device) };
  });
  app.get('/api/v1/plans', async () => ({ data: await db.select().from(plans).where(eq(plans.enabled, true)) }));
  app.get('/api/v1/models', async req => {
    const a = await actor(req);
    const active = await currentSubscription(a.user.id);
    return { data: active ? (await allowedModels(a.user.id, active.plan.id)).map(({ model }) => ({ id: model.id, publicId: model.publicId, displayName: model.displayName, supportsTools: model.supportsTools, supportsVision: model.supportsVision, supportsReasoning: model.supportsReasoning })) : [] };
  });
  app.get('/api/v1/subscription', async req => {
    const a = await actor(req);
    return await currentSubscription(a.user.id) ?? { subscription: null, plan: null };
  });
  app.post('/api/v1/subscription/cancel', async req => {
    const a = await actor(req);
    const active = await currentSubscription(a.user.id);
    if (!active) throw await subscriptionError(a.user.id);
    const [subscription] = await db.update(subscriptions).set({ cancelAtPeriodEnd: true }).where(eq(subscriptions.id, active.subscription.id)).returning();
    await audit(a.user.id, 'SUBSCRIPTION_CANCEL_SCHEDULED', 'SUBSCRIPTION', subscription.id);
    return { subscription };
  });
  app.get('/api/v1/account', async req => {
    const a = await actor(req);
    const active = await currentSubscription(a.user.id);
    const deviceRows = await db.select().from(devices).where(eq(devices.userId, a.user.id));
    return { user: publicUser(a.user), subscription: active?.subscription ?? null, plan: active?.plan ?? null, devices: deviceRows.map(publicV1Device), usage: active ? await currentUsage(a.user.id, active.subscription, active.plan) : null };
  });
  app.get('/api/v1/usage/current', async req => {
    const a = await actor(req);
    const active = await currentSubscription(a.user.id);
    return active ? await currentUsage(a.user.id, active.subscription, active.plan) : { tokens: 0, credit: 0, requests: 0, tokenLimit: 0, creditLimit: 0, percent: 0, threshold: 0 };
  });
  app.get('/api/v1/usage/history', async req => ({ data: await db.select({ id: usageRecords.id, status: usageRecords.status, inputTokens: usageRecords.inputTokens, outputTokens: usageRecords.outputTokens, totalTokens: usageRecords.totalTokens, usageCredit: usageRecords.usageCredit, createdAt: usageRecords.createdAt }).from(usageRecords).where(eq(usageRecords.userId, (await actor(req)).user.id)).orderBy(desc(usageRecords.createdAt)).limit(100) }));
  app.get('/api/v1/client/config', async () => ({ minimumVersion: '0.1.0', latestVersion: '0.1.0', maintenance: false, features: { cloudGateway: true } }));
  app.get('/api/v1/releases', async () => ({ data: await db.select().from(releases).where(eq(releases.published, true)).orderBy(desc(releases.createdAt)) }));
  app.get('/api/v1/releases/latest', async () => {
    const [release] = await db.select().from(releases).where(eq(releases.published, true)).orderBy(desc(releases.createdAt)).limit(1);
    return { release: release ?? null };
  });
  app.get('/api/v1/billing/orders/:id', async req => {
    const a = await actor(req);
    const id = z.uuid().parse((req.params as { id: string }).id);
    const [order] = await db.select().from(billingOrders).where(and(eq(billingOrders.id, id), eq(billingOrders.userId, a.user.id))).limit(1);
    if (!order) throw new ApiError(404, 'NOT_FOUND');
    return order;
  });
  app.post('/api/v1/billing/orders', async (req, reply) => {
    const a = await actor(req);
    const { plan: planCode, paymentProvider } = z.object({ plan: z.enum(['STANDARD', 'PRO']), paymentProvider: z.enum(['MANUAL', 'WECHAT_PAY', 'ALIPAY']) }).parse(req.body);
    const [plan] = await db.select().from(plans).where(and(eq(plans.code, planCode), eq(plans.enabled, true))).limit(1);
    if (!plan) throw new ApiError(404, 'PLAN_NOT_FOUND');
    if (paymentProvider !== 'MANUAL') throw new ApiError(503, 'PAYMENT_PROVIDER_NOT_CONNECTED', '扫码支付暂未开通');
    const [order] = await db.insert(billingOrders).values({ orderNo: `CB${Date.now()}${randomUUID().slice(0, 8)}`, userId: a.user.id, planId: plan.id, amount: plan.monthlyPrice, currency: plan.currency, provider: paymentProvider, expiresAt: new Date(Date.now() + 24 * 3600000) }).returning();
    return reply.code(201).send({ orderId: order.id, status: order.status, amount: Number(order.amount), currency: order.currency, payment: { type: 'MANUAL', qrCodePayload: null } });
  });
}
