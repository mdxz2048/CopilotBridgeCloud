import { auditLogs, db, models, plans, pool, providers, rateCards, rateCardVersions, subscriptions, userModelAccess, users } from '@bridge/db';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { applyWalletChange } from '../wallet.js';
import { currentBillingMode } from '../billing-mode.js';

if (process.env.INTEGRATION_MOCK_ENABLED !== 'true') throw new Error('Integration Mock gate is disabled');
const billingMode = currentBillingMode();
if (billingMode === 'ENFORCED') throw new Error('Refusing to configure a Mock fixture in ENFORCED billing mode');
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
  if (billingMode === 'SHADOW') {
    await tx.insert(rateCards).values({ providerId: provider.id, modelId: model.id, billingPolicy: 'MANAGED_USAGE' }).onConflictDoNothing();
    const [card] = await tx.select().from(rateCards).where(and(eq(rateCards.providerId, provider.id), eq(rateCards.modelId, model.id), eq(rateCards.billingPolicy, 'MANAGED_USAGE'))).limit(1);
    if (!card) throw new Error('Mock rate card missing');
    const [active] = await tx.select().from(rateCardVersions).where(and(eq(rateCardVersions.rateCardId, card.id), eq(rateCardVersions.status, 'ACTIVE'))).limit(1);
    const [latestVersion] = await tx.select().from(rateCardVersions).where(eq(rateCardVersions.rateCardId, card.id)).orderBy(desc(rateCardVersions.version)).limit(1);
    if (!active) await tx.insert(rateCardVersions).values({ rateCardId: card.id, version: (latestVersion?.version ?? 0) + 1, status: 'ACTIVE', inputRate: '10', outputRate: '20', minimumCharge: 1,
      cachedInputRate: '0', reasoningRate: '0', imageInputRate: '0', imageOutputRate: '0', toolRate: '0', effectiveFrom: now });
    else if (active.status !== 'ACTIVE' || (Number(active.inputRate) === 0 && Number(active.outputRate) === 0 && active.minimumCharge === 0)) throw new Error('Mock rate card has no active nonzero version');
    const grant = await applyWalletChange(tx, { userId: user.id, points: 10000, type: 'TEST_GRANT', referenceType: 'INTEGRATION_FIXTURE', referenceId: user.id,
      idempotencyKey: `integration-shadow-v1:${user.id}`, metadata: { purpose: 'SHADOW_E2E' } });
    if (!grant.duplicate) await tx.insert(auditLogs).values({ actorId: null, action: 'INTEGRATION_TEST_POINTS_GRANTED', targetType: 'USER', targetId: user.id,
      metadata: { transactionId: grant.transaction.id, points: 10000 } });
  }
  await tx.insert(auditLogs).values({ actorId: null, action: 'INTEGRATION_TEST_ACCOUNT_CONFIGURED', targetType: 'USER', targetId: user.id, metadata: { email, mockModelId: model.id } });
  return { email: user.email, id: user.id, plan: plan.code, model: model.publicId };
});
process.stdout.write(`${JSON.stringify(account)}\n`);
await pool.end();
