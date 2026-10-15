import { db, systemSettings, models, usageRecords, providers, plans, auditLogs } from '@bridge/db';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { admin, ApiError } from './core.js';
import { providerFor, isDeepSeekProvider } from './provider.js';

import {POINTS_PER_RMB,MoneyPolicySchema,defaultMoneyPolicy,ratesFor} from './money-pricing.js';
export {POINTS_PER_RMB,MoneyPolicySchema,defaultMoneyPolicy,ratesFor,isPeak} from './money-pricing.js';
export async function moneyPolicy(source:Pick<typeof db,'select'>=db) {
  const [row] = await source.select().from(systemSettings).where(eq(systemSettings.key, 'money_policy')).limit(1);
  return row ? MoneyPolicySchema.parse(row.value) : defaultMoneyPolicy;
}
const PlanSchema = z.object({ code: z.enum(['PAYG', 'QUARTER']), name: z.string().trim().min(1).max(120), priceRmb: z.number().nonnegative().max(100000), includedRmb: z.number().nonnegative().max(100000), enabled: z.boolean(), maxDevices: z.number().int().min(1).max(100), requestsPerMinute: z.number().int().min(1).max(120), maxConcurrentRequests: z.number().int().min(1).max(20) }).strict();
const balanceCache = new Map<string, { expires: number; value: unknown }>();
export async function upstreamBalance(providerId:string,code:string) {
  const cached=balanceCache.get(providerId);
  if(cached&&cached.expires>Date.now()&&cached.expires<=Date.now()+5000)return cached.value as {isAvailable:boolean;balances:Array<{currency:string;total:string}>};
  const adapter=await providerFor(providerId,code);
  const value=await (adapter as {balance?:()=>Promise<unknown>}).balance?.();
  if(!value)throw new ApiError(503,'PROVIDER_UNAVAILABLE');
  balanceCache.set(providerId,{expires:Date.now()+5000,value});
  return value as {isAvailable:boolean;balances:Array<{currency:string;total:string}>};
}
export function registerMoneyAdmin(app: FastifyInstance) {
  app.get('/api/v1/admin/money-policy', async req => { await admin(req); return { policy: await moneyPolicy(), pointsPerRmb: POINTS_PER_RMB, source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/' }; });
  app.put('/api/v1/admin/money-policy', async req => {
    const a = await admin(req), data = MoneyPolicySchema.parse(req.body);
    await db.transaction(async tx => { await tx.insert(systemSettings).values({ key: 'money_policy', value: data }).onConflictDoUpdate({ target: systemSettings.key, set: { value: data, updatedAt: new Date() } });
      await tx.insert(auditLogs).values({ actorId: a.user.id, action: 'MONEY_POLICY_UPDATED', targetType: 'SYSTEM', targetId: 'money_policy', metadata: data }); });
    return { policy: data };
  });
  app.get('/api/v1/admin/money-plans', async req => {
    await admin(req); return { data: await db.select().from(plans).where(sql`${plans.code} in ('PAYG','QUARTER')`) };
  });
  app.put('/api/v1/admin/money-plans', async req => {
    const a = await admin(req), data = PlanSchema.parse(req.body);
    if (data.code === 'PAYG' && (data.priceRmb !== 0 || data.includedRmb !== 0)) throw new ApiError(400, 'VALIDATION_ERROR', '按量套餐不预收固定套餐费或赠送周期额度。');
    const values = { name: data.name, description: data.code === 'PAYG' ? '按实际用量扣减人民币余额' : '季度（90 天）包含人民币消费额度', monthlyPrice: String(data.priceRmb), monthlyPoints: Math.round(data.includedRmb * POINTS_PER_RMB), currency: 'CNY', enabled: data.enabled, maxDevices: data.maxDevices, requestsPerMinute: data.requestsPerMinute, maxConcurrentRequests: data.maxConcurrentRequests, monthlyTokenLimit: 2_000_000_000, monthlyUsageCreditLimit: '2000000000', rolloverPolicy: data.code === 'PAYG' ? 'UNLIMITED' : 'NONE' };
    const result = await db.transaction(async tx => { const [row] = await tx.insert(plans).values({ code: data.code, ...values }).onConflictDoUpdate({ target: plans.code, set: values }).returning();
      await tx.insert(auditLogs).values({ actorId: a.user.id, action: 'MONEY_PLAN_UPDATED', targetType: 'PLAN', targetId: row.id, metadata: data }); return row; });
    return result;
  });
  app.get('/api/v1/admin/providers/:id/metrics', async req => {
    await admin(req); const id = z.uuid().parse((req.params as { id: string }).id);
    const [provider] = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
    if (!provider || !isDeepSeekProvider(provider.code)) throw new ApiError(404, 'NOT_FOUND');
    let balance: unknown = null, balanceError: string | null = null;
    if (provider.enabled) {
      const cached = balanceCache.get(id);
      if (cached && cached.expires > Date.now()) balance = cached.value;
      else try { const adapter = await providerFor(id, provider.code); balance = await (adapter as { balance?: () => Promise<unknown> }).balance?.() ?? null; balanceCache.set(id, { expires: Date.now() + 5000, value: balance }); } catch { balanceError = 'UPSTREAM_BALANCE_UNAVAILABLE'; }
    }
    const rows = await db.select({ id: models.id, publicId: models.publicId, name: models.displayName, enabled: models.enabled, requests: sql<number>`count(${usageRecords.id}) filter (where ${usageRecords.status} = 'COMPLETED')`, inputTokens: sql<number>`coalesce(sum(${usageRecords.inputTokens}) filter (where ${usageRecords.status} = 'COMPLETED'),0)`, outputTokens: sql<number>`coalesce(sum(${usageRecords.outputTokens}) filter (where ${usageRecords.status} = 'COMPLETED'),0)` }).from(models).leftJoin(usageRecords, eq(usageRecords.modelId, models.id)).where(eq(models.providerId, id)).groupBy(models.id);
    return { balance, balanceError, balanceScope: 'UPSTREAM_ACCOUNT_SHARED', models: rows.map(row => ({ ...row, requests: Number(row.requests), inputTokens: Number(row.inputTokens), outputTokens: Number(row.outputTokens) })) };
  });
}
