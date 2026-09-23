import { auditLogs, db, models, plans, pool, providers, subscriptions, userModelAccess, users } from '@bridge/db';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

if (process.env.INTEGRATION_MOCK_ENABLED !== 'true') throw new Error('Integration Mock gate is disabled');
const email = z.email().parse(process.env.INTEGRATION_MOCK_TEST_EMAIL).toLowerCase();
const now = new Date();
const account = await db.transaction(async tx => {
  const [user] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.role !== 'USER' || user.status !== 'ACTIVE') throw new Error('Register a dedicated active USER account before setup');
  const [plan] = await tx.select().from(plans).where(eq(plans.code, 'PRO')).limit(1);
  if (!plan || plan.enabled) throw new Error('Refusing to alter an enabled commercial PRO plan');
  await tx.update(plans).set({ maxDevices: 3, monthlyTokenLimit: 100000, monthlyUsageCreditLimit: '100000', maxConcurrentRequests: 4, requestsPerMinute: 60 }).where(eq(plans.id, plan.id));
  const [provider] = await tx.update(providers).set({ enabled: true }).where(eq(providers.code, 'MOCK')).returning();
  if (!provider) throw new Error('Mock provider seed is missing');
  const [model] = await tx.update(models).set({ enabled: true }).where(eq(models.publicId, 'mock/mock-chat')).returning();
  if (!model || model.providerId !== provider.id) throw new Error('Mock model seed is missing or mismatched');
  await tx.insert(userModelAccess).values({ userId: user.id, modelId: model.id, access: 'ALLOW' })
    .onConflictDoUpdate({ target: [userModelAccess.userId, userModelAccess.modelId], set: { access: 'ALLOW' } });
  const [latest] = await tx.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).orderBy(desc(subscriptions.createdAt)).limit(1);
  if (!latest || latest.planId !== plan.id || latest.status !== 'ACTIVE' || latest.currentPeriodEnd <= now) {
    await tx.insert(subscriptions).values({ userId: user.id, planId: plan.id, status: 'ACTIVE', startedAt: now, currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86400000) });
  }
  await tx.insert(auditLogs).values({ actorId: null, action: 'INTEGRATION_TEST_ACCOUNT_CONFIGURED', targetType: 'USER', targetId: user.id, metadata: { email, mockModelId: model.id } });
  return { email: user.email, id: user.id, plan: plan.code, model: model.publicId };
});
process.stdout.write(`${JSON.stringify(account)}\n`);
await pool.end();
