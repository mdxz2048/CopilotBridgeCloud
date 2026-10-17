import {fulfillSignupReward} from './signup-rewards.js';
import type { FastifyInstance } from 'fastify';
import { aiRequests, auditLogs, billingOrders, db, devices, models, modelInstances, providers, rateCards, rateCardVersions, referralRewards, referrals, systemSettings, usageEvents, users, walletTransactions, wallets } from '@bridge/db';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { admin, ApiError } from './core.js';
import { applyWalletChange } from './wallet.js';
import { qualifyReferralFromPaidOrder } from './referral.js';
import { isDeepSeekProvider, isOpenAIProvider } from './provider.js';

const uuidParam = (params: unknown) => z.uuid().parse((params as { id: string }).id);
const decimal = z.string().regex(/^\d+(?:\.\d{1,6})?$/);
const rates = z.object({ inputRate: decimal, outputRate: decimal, cachedInputRate: decimal, reasoningRate: decimal,
  imageInputRate: decimal, imageOutputRate: decimal, toolRate: decimal, minimumCharge: z.number().int().min(0).max(1_000_000) });
const referralPolicy = z.object({ enabled: z.boolean(), minPaidAmount: z.number().nonnegative(), referrerPoints: z.number().int().min(0).max(1_000_000), referredPoints: z.number().int().min(0).max(1_000_000) });

export async function registerV2Admin(app: FastifyInstance) {
  app.get('/api/v1/admin/insights', async req => {
    await admin(req);
    const since = new Date(Date.now() - 30 * 86400000);
    const [requests, modelUsage] = await Promise.all([
      db.select({ status: aiRequests.status, count: sql<number>`count(*)` }).from(aiRequests)
        .where(gte(aiRequests.createdAt, since)).groupBy(aiRequests.status),
      db.select({
        model: models.displayName, publicId: models.publicId,
        requests: sql<number>`count(*)`,
        inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
        pointsRated: sql<number>`coalesce(sum(${usageEvents.pointsRated}), 0)`,
        pointsCharged: sql<number>`coalesce(sum(${usageEvents.pointsCharged}), 0)`,
      }).from(usageEvents).innerJoin(models, eq(usageEvents.modelId, models.id))
        .where(gte(usageEvents.createdAt, since)).groupBy(models.id, models.displayName, models.publicId)
        .orderBy(desc(sql`count(*)`)).limit(30),
    ]);
    return { periodDays: 30, requests: requests.map(row => ({ status: row.status, count: Number(row.count) })),
      models: modelUsage.map(row => ({ ...row, requests: Number(row.requests), inputTokens: Number(row.inputTokens),
        outputTokens: Number(row.outputTokens), pointsRated: Number(row.pointsRated), pointsCharged: Number(row.pointsCharged) })) };
  });
  app.get('/api/v1/admin/users/:id/activity', async req => {
    await admin(req);
    const userId = uuidParam(req.params);
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new ApiError(404, 'NOT_FOUND');
    const [invited, referredBy, orders, [inviteTotal]] = await Promise.all([
      db.select({ status: referrals.status, registeredAt: referrals.registeredAt, qualifiedAt: referrals.qualifiedAt })
        .from(referrals).where(eq(referrals.referrerUserId, userId)).orderBy(desc(referrals.registeredAt)).limit(100),
      db.select({ status: referrals.status, registeredAt: referrals.registeredAt })
        .from(referrals).where(eq(referrals.referredUserId, userId)).limit(1),
      db.select({ id: billingOrders.id, amount: billingOrders.amount, status: billingOrders.status, createdAt: billingOrders.createdAt })
        .from(billingOrders).where(eq(billingOrders.userId, userId)).orderBy(desc(billingOrders.createdAt)).limit(100),
      db.select({ count: sql<number>`count(*)` }).from(referrals).where(eq(referrals.referrerUserId, userId)),
    ]);
    return { invited, inviteCount: Number(inviteTotal.count), referredBy: referredBy[0] ?? null, orders };
  });
  app.get('/api/v1/admin/wallets', async req => {
    await admin(req);
    return { data: await db.select({ userId: users.id, email: users.email, balance: wallets.balance, updatedAt: wallets.updatedAt })
      .from(wallets).innerJoin(users, eq(wallets.userId, users.id)).orderBy(desc(wallets.updatedAt)).limit(200) };
  });
  app.get('/api/v1/admin/users/:id/finance', async req => {
    await admin(req); const userId = uuidParam(req.params);
    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
    const [deviceCount] = await db.select({ count: sql<number>`count(*)` }).from(devices).where(eq(devices.userId, userId));
    return { wallet: { balance: wallet?.balance ?? 0, unit: 'AI_POINT' }, devices: Number(deviceCount.count),
      transactions: wallet ? await db.select().from(walletTransactions).where(eq(walletTransactions.walletId, wallet.id)).orderBy(desc(walletTransactions.createdAt)).limit(100) : [],
      usage: await db.select().from(usageEvents).where(eq(usageEvents.userId, userId)).orderBy(desc(usageEvents.createdAt)).limit(100) };
  });
  app.post('/api/v1/admin/users/:id/wallet/adjust', async req => {
    const a = await admin(req); const userId = uuidParam(req.params);
    const data = z.object({ points: z.number().int().min(-1_000_000_000).max(1_000_000_000).refine(n => n !== 0), reason: z.string().trim().min(10).max(500), idempotencyKey: z.uuid() }).parse(req.body);
    return db.transaction(async tx => {
      await tx.select({id:referrals.id}).from(referrals).where(eq(referrals.referredUserId,userId)).for('update');
      const result = await applyWalletChange(tx, { userId, points: data.points, type: 'ADMIN_ADJUSTMENT', referenceType: 'ADMIN', referenceId: a.user.id,
        idempotencyKey: `admin:${data.idempotencyKey}`, metadata: { reason: data.reason } });
      if (!result.duplicate) await tx.insert(auditLogs).values({ actorId: a.user.id, action: 'WALLET_ADJUSTED', targetType: 'USER', targetId: userId,
        metadata: { points: data.points, reason: data.reason, transactionId: result.transaction.id } });
      return { transaction: result.transaction, duplicate: result.duplicate };
    });
  });
  app.get('/api/v1/admin/rate-cards', async req => {
    await admin(req); return { data: await db.select().from(rateCards), versions: await db.select().from(rateCardVersions).orderBy(desc(rateCardVersions.createdAt)).limit(300) };
  });
  app.post('/api/v1/admin/rate-cards', async (req, reply) => {
    const a = await admin(req);
    const data = z.object({ providerId: z.uuid(), modelId: z.uuid(), billingPolicy: z.enum(['MANAGED_USAGE', 'BYOS_USAGE', 'LOCAL_USAGE']) }).parse(req.body);
    const [model] = await db.select().from(models).where(eq(models.id, data.modelId)).limit(1);
    if (!model) throw new ApiError(400, 'MODEL_PROVIDER_MISMATCH');
    if (model.providerId !== data.providerId) {
      const [binding] = await db.select({ code: providers.code }).from(modelInstances)
        .innerJoin(providers, eq(providers.id, modelInstances.providerId))
        .where(and(eq(modelInstances.modelId, model.id), eq(modelInstances.providerId, data.providerId),
          eq(modelInstances.providerModelId, model.providerModelId))).limit(1);
      const family = binding && (isOpenAIProvider(binding.code) ? 'openai' : isDeepSeekProvider(binding.code) ? 'deepseek' : undefined);
      if (!family || model.publicId.split('/')[0] !== family) throw new ApiError(400, 'MODEL_PROVIDER_MISMATCH');
    }
    const [card] = await db.insert(rateCards).values(data).onConflictDoNothing().returning();
    if (!card) throw new ApiError(409, 'RATE_CARD_EXISTS');
    await db.insert(auditLogs).values({ actorId: a.user.id, action: 'RATE_CARD_CREATED', targetType: 'RATE_CARD', targetId: card.id });
    return reply.code(201).send(card);
  });
  app.post('/api/v1/admin/rate-cards/:id/versions', async (req, reply) => {
    const a = await admin(req); const cardId = uuidParam(req.params);
    const data = z.object({ ...rates.shape, effectiveFrom: z.coerce.date().nullable().default(null) }).parse(req.body);
    const version = await db.transaction(async tx => {
      const [card] = await tx.select().from(rateCards).where(eq(rateCards.id, cardId)).for('update').limit(1);
      if (!card) throw new ApiError(404, 'NOT_FOUND');
      const [latest] = await tx.select().from(rateCardVersions).where(eq(rateCardVersions.rateCardId, cardId)).orderBy(desc(rateCardVersions.version)).limit(1);
      const [created] = await tx.insert(rateCardVersions).values({ ...data, rateCardId: cardId, version: (latest?.version ?? 0) + 1, createdBy: a.user.id, status: 'DRAFT' }).returning();
      await tx.insert(auditLogs).values({ actorId: a.user.id, action: 'RATE_CARD_VERSION_CREATED', targetType: 'RATE_CARD_VERSION', targetId: created.id });
      return created;
    });
    return reply.code(201).send(version);
  });
  app.post('/api/v1/admin/rate-card-versions/:id/publish', async req => {
    const a = await admin(req); const id = uuidParam(req.params);
    return db.transaction(async tx => {
      const [candidate] = await tx.select().from(rateCardVersions).where(eq(rateCardVersions.id, id)).limit(1);
      if (!candidate || candidate.status !== 'DRAFT') throw new ApiError(409, 'RATE_CARD_NOT_DRAFT');
      if (candidate.effectiveFrom && candidate.effectiveFrom > new Date()) throw new ApiError(409, 'RATE_CARD_FUTURE_SCHEDULE_NOT_SUPPORTED');
      await tx.select().from(rateCards).where(eq(rateCards.id, candidate.rateCardId)).for('update').limit(1);
      await tx.update(rateCardVersions).set({ status: 'RETIRED', effectiveTo: new Date() }).where(and(eq(rateCardVersions.rateCardId, candidate.rateCardId), eq(rateCardVersions.status, 'ACTIVE')));
      const [published] = await tx.update(rateCardVersions).set({ status: 'ACTIVE', effectiveFrom: candidate.effectiveFrom ?? new Date() }).where(and(eq(rateCardVersions.id, id), eq(rateCardVersions.status, 'DRAFT'))).returning();
      await tx.insert(auditLogs).values({ actorId: a.user.id, action: 'RATE_CARD_VERSION_PUBLISHED', targetType: 'RATE_CARD_VERSION', targetId: id,
        metadata: { rateCardId: candidate.rateCardId, version: candidate.version } });
      return published;
    });
  });
  app.get('/api/v1/admin/referrals', async req => {
    await admin(req);const rows=await db.select().from(referrals).orderBy(desc(referrals.registeredAt)).limit(200);const ids=[...new Set(rows.flatMap(row=>[row.referrerUserId,row.referredUserId]))];const people=ids.length?await db.select({id:users.id,email:users.email}).from(users).where(inArray(users.id,ids)):[];return {data:rows.map(row=>({...row,referrerEmail:people.find(u=>u.id===row.referrerUserId)?.email,referredEmail:people.find(u=>u.id===row.referredUserId)?.email}))};
  });
  app.get('/api/v1/admin/referral-policy', async req => {
    await admin(req);
    const [setting] = await db.select().from(systemSettings).where(eq(systemSettings.key, 'referral_policy')).limit(1);
    return { policy: setting?.value ?? { enabled: false, minPaidAmount: 0, referrerPoints: 0, referredPoints: 0 } };
  });
  app.put('/api/v1/admin/referral-policy', async req => {
    const a = await admin(req); const value = referralPolicy.parse(req.body);
    return db.transaction(async tx => {
      await tx.insert(systemSettings).values({ key: 'referral_policy', value }).onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date() } });
      await tx.insert(auditLogs).values({ actorId: a.user.id, action: 'REFERRAL_POLICY_UPDATED', targetType: 'SETTING', targetId: 'referral_policy', metadata: value });
      return value;
    });
  });
  app.post('/api/v1/admin/referrals/:id/review', async req => {
    const a = await admin(req); const id = uuidParam(req.params);
    const { decision, reason } = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().min(5).max(500) }).parse(req.body);
    return db.transaction(async tx => {
      const [referral] = await tx.select().from(referrals).where(eq(referrals.id, id)).for('update').limit(1);
      if (!referral || !['PENDING', 'REGISTERED'].includes(referral.status)) throw new ApiError(409, 'REFERRAL_NOT_REVIEWABLE');
      await tx.update(referrals).set({ status: decision === 'REJECT' ? 'REJECTED' : 'REGISTERED', riskFlags: decision === 'APPROVE' ? [] : referral.riskFlags }).where(eq(referrals.id, id));
      if (decision === 'APPROVE') {
        await fulfillSignupReward(tx,id);
        const [paid] = await tx.select().from(billingOrders).where(and(eq(billingOrders.userId, referral.referredUserId), eq(billingOrders.status, 'PAID'))).orderBy(desc(billingOrders.paidAt)).limit(1);
        if (paid) await qualifyReferralFromPaidOrder(tx, referral.referredUserId, Number(paid.amount));
      }
      await tx.insert(auditLogs).values({ actorId: a.user.id, action: `REFERRAL_${decision}`, targetType: 'REFERRAL', targetId: id, metadata: { reason } });
      const [final] = await tx.select().from(referrals).where(eq(referrals.id, id)).limit(1);
      return final;
    });
  });

  app.get('/api/v1/admin/cost-requests', async req => {
    await admin(req);
    const {page,limit,includeTest}=z.object({includeTest:z.enum(['true','false']).default('false').transform(value=>value==='true'),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(req.query);
    const customerFilter=includeTest?sql`true`:sql`lower(${users.email}) not like '%@example.test'`;
    const [total]=await db.select({count:sql<number>`count(*)`}).from(usageEvents).innerJoin(users,eq(users.id,usageEvents.userId)).where(customerFilter);
    const data=await db.select({id:usageEvents.id,requestId:usageEvents.requestId,user:users.email,model:models.publicId,provider:providers.code,
      inputTokens:usageEvents.inputTokens,outputTokens:usageEvents.outputTokens,cachedInputTokens:usageEvents.cachedInputTokens,reasoningTokens:usageEvents.reasoningTokens,
      pointsCharged:usageEvents.pointsCharged,billingStatus:usageEvents.billingStatus,createdAt:usageEvents.createdAt,
      audit:sql<Record<string,unknown>|null>`${usageEvents.providerReportedUsage}->'bridge_cost_audit'`}).from(usageEvents)
      .innerJoin(users,eq(users.id,usageEvents.userId)).innerJoin(models,eq(models.id,usageEvents.modelId)).innerJoin(providers,eq(providers.id,usageEvents.providerId))
      .where(customerFilter).orderBy(desc(usageEvents.createdAt),desc(usageEvents.id)).limit(limit).offset((page-1)*limit);
    return {page,limit,includeTest,total:Number(total.count),data:data.map(row=>({...row,userChargedRmb:row.pointsCharged/10000}))};
  });
  app.get('/api/v1/admin/cost-analytics', async req => {
    await admin(req);
    const {groupBy,includeTest}=z.object({includeTest:z.enum(['true','false']).default('false').transform(value=>value==='true'),groupBy:z.enum(['day','model','provider','user']).default('day')}).parse(req.query);
    const grouping={day:sql<string>`date_trunc('day',${usageEvents.createdAt} at time zone 'Asia/Shanghai')::text`,model:sql<string>`${models.publicId}`,provider:sql<string>`${providers.code}`,user:sql<string>`${users.email}`}[groupBy];
    const reported=sql`(${usageEvents.providerReportedUsage}->'bridge_cost_audit'->>'reportedCostRmb')::numeric`;
    const estimated=sql`(${usageEvents.providerReportedUsage}->'bridge_cost_audit'->>'estimatedCostRmb')::numeric`;
    const cost=sql`coalesce(${reported},${estimated})`;
    const rows=await db.select({group:grouping,requests:sql<number>`count(*)`,inputTokens:sql<number>`coalesce(sum(${usageEvents.inputTokens}),0)`,outputTokens:sql<number>`coalesce(sum(${usageEvents.outputTokens}),0)`,cachedInputTokens:sql<number>`coalesce(sum(${usageEvents.cachedInputTokens}),0)`,reasoningTokens:sql<number>`coalesce(sum(${usageEvents.reasoningTokens}),0)`,
      pointsCharged:sql<number>`coalesce(sum(${usageEvents.pointsCharged}),0)`,revenueRmb:sql<number>`coalesce(sum(${usageEvents.pointsCharged}),0)/10000.0`,
      reportedRequests:sql<number>`count(*) filter(where ${reported} is not null)`,estimatedRequests:sql<number>`count(*) filter(where ${reported} is null and ${estimated} is not null)`,
      reportedCostRmb:sql<number>`coalesce(sum(${reported}),0)`,estimatedCostRmb:sql<number>`coalesce(sum(${estimated}) filter(where ${reported} is null),0)`,
      knownCostRmb:sql<number>`coalesce(sum(${cost}),0)`,pricedRevenueRmb:sql<number>`coalesce(sum(${usageEvents.pointsCharged}/10000.0) filter(where ${cost} is not null),0)`,
      pricedRequests:sql<number>`count(*) filter(where ${cost} is not null)`,unpricedCostRows:sql<number>`count(*) filter(where ${cost} is null)`})
      .from(usageEvents).innerJoin(models,eq(usageEvents.modelId,models.id)).innerJoin(providers,eq(usageEvents.providerId,providers.id)).innerJoin(users,eq(usageEvents.userId,users.id))
      .where(includeTest?sql`true`:sql`lower(${users.email}) not like '%@example.test'`).groupBy(grouping).orderBy(desc(grouping)).limit(200);
    return {groupBy,includeTest,currency:'CNY',balanceScope:'UPSTREAM_ACCOUNT_WINDOW_NOT_REQUEST',data:rows.map(raw=>{
      const row=Object.fromEntries(Object.entries(raw).map(([key,value])=>[key,key==='group'?value:Number(value)])) as typeof raw;
      return {...row,estimatedGrossMarginRmb:row.pricedRequests?Number((row.pricedRevenueRmb-row.knownCostRmb).toFixed(8)):null};
    })};
  });
}
