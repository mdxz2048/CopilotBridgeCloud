import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db, publicRateHits, systemSettings, auditLogs } from '@bridge/db';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { admin, ApiError } from './core.js';

export const RatePolicySchema = z.object({
  accountRpm: z.number().int().min(1).max(120),
  deviceRpm: z.number().int().min(1).max(60),
  publicIpRpm: z.number().int().min(1).max(120),
  authIpRpm: z.number().int().min(1).max(120),
}).strict().refine(value => value.authIpRpm <= value.publicIpRpm, 'Auth rate cannot exceed the public rate');
export type RatePolicy = z.infer<typeof RatePolicySchema>;
export const defaultRatePolicy: RatePolicy = { accountRpm: 2, deviceRpm: 1, publicIpRpm: 60, authIpRpm: 10 };
const key = 'rate_policy';
const oneMinute = 60_000;
let nextPublicCleanup = 0;

export async function currentRatePolicy(): Promise<RatePolicy> {
  const [setting] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return setting ? RatePolicySchema.parse(setting.value) : defaultRatePolicy;
}

export function isPublicPath(req: Pick<FastifyRequest, 'url' | 'method'>) {
  const path = new URL(req.url, 'http://localhost').pathname;
  return /^\/api\/v1\/auth\/(register|login|refresh)$/.test(path)
    || (req.method === 'GET' && /^\/api\/v1\/(plans|client\/config|releases\/latest)$/.test(path));
}

async function consumePublicIp(ip: string, policy: RatePolicy, auth: boolean) {
  const fingerprint = createHash('sha256').update(ip).digest('hex');
  const scopes = auth ? [{ name: 'auth', limit: policy.authIpRpm }, { name: 'public', limit: policy.publicIpRpm }]
    : [{ name: 'public', limit: policy.publicIpRpm }];
  await db.transaction(async tx => {
    for (const scope of scopes) {
      const ipHash = `${scope.name}:${fingerprint}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ipHash}, 0))`);
      const [usage] = await tx.select({ count: sql<number>`count(*)` }).from(publicRateHits)
        .where(and(eq(publicRateHits.ipHash, ipHash), gte(publicRateHits.createdAt, new Date(Date.now() - oneMinute))));
      if (Number(usage.count) >= scope.limit) throw new ApiError(429, 'RATE_LIMITED');
      await tx.insert(publicRateHits).values({ ipHash });
    }
    if (Date.now() >= nextPublicCleanup) {
      await tx.delete(publicRateHits).where(lt(publicRateHits.createdAt, new Date(Date.now() - 2 * oneMinute)));
      nextPublicCleanup = Date.now() + oneMinute;
    }
  });
}

export function registerRatePolicy(app: FastifyInstance) {
  app.addHook('onRequest', async req => {
    if (!isPublicPath(req)) return;
    const policy = await currentRatePolicy();
    await consumePublicIp(req.ip, policy, new URL(req.url, 'http://localhost').pathname.startsWith('/api/v1/auth/'));
  });
  app.get('/api/v1/admin/rate-policy', async req => {
    await admin(req);
    return { policy: await currentRatePolicy() };
  });
  app.put('/api/v1/admin/rate-policy', async req => {
    const a = await admin(req);
    const policy = RatePolicySchema.parse(req.body);
    await db.transaction(async tx => {
      await tx.insert(systemSettings).values({ key, value: policy })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: policy, updatedAt: new Date() } });
      await tx.insert(auditLogs).values({ actorId: a.user.id, action: 'RATE_POLICY_UPDATED', targetType: 'SYSTEM_SETTING', targetId: key, metadata: { policy } });
    });
    return { policy };
  });
}
