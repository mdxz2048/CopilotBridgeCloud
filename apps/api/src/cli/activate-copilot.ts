import { aiRequests, auditLogs, db, models, pool, providerCredentials, providers, rateCards, rateCardVersions,
  usageEvents, userModelAccess, users } from '@bridge/db';
import { and, eq, gt } from 'drizzle-orm';
import { CopilotProvider } from '../copilot-provider.js';
import { currentBillingMode } from '../billing-mode.js';
import { decryptSecret } from '../security.js';

const modelId = 'gpt-5.4-mini';
const publicId = `copilot/${modelId}`;
const email = process.env.INTEGRATION_MOCK_TEST_EMAIL?.toLowerCase();
const finalize = process.argv.includes('--finalize');

try {
  if (currentBillingMode() !== 'SHADOW') throw new Error('SHADOW_MODE_REQUIRED');
  if (!email) throw new Error('TEST_ACCOUNT_NOT_CONFIGURED');
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const [provider] = await db.select().from(providers).where(eq(providers.code, 'COPILOT')).limit(1);
  if (!user || !provider) throw new Error('TEST_ACCOUNT_OR_PROVIDER_MISSING');

  if (finalize) {
    const [model] = await db.select().from(models).where(and(eq(models.publicId, publicId), eq(models.providerId, provider.id))).limit(1);
    if (!model) throw new Error('COPILOT_MODEL_MISSING');
    const [settled] = await db.select({ id: usageEvents.id }).from(usageEvents)
      .innerJoin(aiRequests, eq(usageEvents.requestId, aiRequests.id))
      .where(and(eq(aiRequests.userId, user.id), eq(aiRequests.providerId, provider.id), eq(aiRequests.modelId, model.id),
        eq(aiRequests.status, 'COMPLETED'), eq(usageEvents.billingStatus, 'SHADOW'), gt(usageEvents.pointsRated, 0),
        eq(usageEvents.pointsCharged, 0))).limit(1);
    if (!settled) throw new Error('REAL_SHADOW_SETTLEMENT_MISSING');
    await db.transaction(async tx => {
      const [mock] = await tx.select().from(providers).where(eq(providers.code, 'MOCK')).limit(1);
      if (mock) {
        await tx.update(providers).set({ enabled: false }).where(eq(providers.id, mock.id));
        await tx.update(models).set({ enabled: false }).where(eq(models.providerId, mock.id));
      }
      await tx.insert(auditLogs).values({ actorId: null, action: 'COPILOT_ONLY_RELEASE_SCOPE', targetType: 'PROVIDER',
        targetId: provider.id, metadata: { releaseModel: publicId, testUserId: user.id, realShadowSettlementId: settled.id } });
    });
    process.stdout.write(`${JSON.stringify({ catalog: 'COPILOT_ONLY', model: publicId, billingMode: 'SHADOW' })}\n`);
  } else {
    const [credential] = await db.select().from(providerCredentials).where(eq(providerCredentials.providerId, provider.id)).limit(1);
    if (!credential) throw new Error('COPILOT_CREDENTIAL_MISSING');
    const discovered = await new CopilotProvider(decryptSecret(credential), provider.timeoutMs).discover();
    const selected = discovered.models.find(model => model.id === modelId && model.policy?.state === 'enabled');
    if (!selected) throw new Error('COPILOT_MODEL_NOT_ENTITLED');
    const [model] = await db.insert(models).values({ providerId: provider.id, providerModelId: modelId, publicId,
      displayName: selected.name, enabled: true, supportsTools: false, supportsVision: false,
      supportsReasoning: true, supportsStreaming: true })
      .onConflictDoUpdate({ target: models.publicId, set: { providerModelId: modelId, displayName: selected.name,
        enabled: true, supportsTools: false, supportsVision: false, supportsReasoning: true, supportsStreaming: true } }).returning();
    await db.transaction(async tx => {
      await tx.update(providers).set({ name: 'Copilot Bridge Cloud', enabled: true }).where(eq(providers.id, provider.id));
      await tx.insert(userModelAccess).values({ userId: user.id, modelId: model.id, access: 'ALLOW' })
        .onConflictDoUpdate({ target: [userModelAccess.userId, userModelAccess.modelId], set: { access: 'ALLOW' } });
      const [card] = await tx.insert(rateCards).values({ providerId: provider.id, modelId: model.id, billingPolicy: 'MANAGED_USAGE' })
        .onConflictDoUpdate({ target: [rateCards.providerId, rateCards.modelId, rateCards.billingPolicy],
          set: { billingPolicy: 'MANAGED_USAGE' } }).returning();
      const [version] = await tx.select().from(rateCardVersions).where(and(eq(rateCardVersions.rateCardId, card.id), eq(rateCardVersions.version, 1))).limit(1);
      if (!version) await tx.insert(rateCardVersions).values({ rateCardId: card.id, version: 1, status: 'ACTIVE',
        inputRate: '1', outputRate: '2', cachedInputRate: '0.25', reasoningRate: '2', minimumCharge: 1,
        effectiveFrom: new Date() });
      await tx.insert(auditLogs).values({ actorId: null, action: 'COPILOT_TEST_MODEL_ACTIVATED', targetType: 'MODEL',
        targetId: model.id, metadata: { publicId, testUserId: user.id, billingMode: 'SHADOW' } });
    });
    process.stdout.write(`${JSON.stringify({ provider: 'Copilot Bridge Cloud', model: publicId, testAccount: email,
      billingMode: 'SHADOW', credential: 'ENCRYPTED' })}\n`);
  }
} catch (error) {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'COPILOT_ACTIVATION_FAILED';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
} finally { await pool.end(); }
