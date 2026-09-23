import { db, plans, pool, providers, models, planModelAccess } from '@bridge/db';
import { eq } from 'drizzle-orm';

const specs = [
  { code: 'STANDARD', name: 'Standard', prefix: 'STANDARD' },
  { code: 'PRO', name: 'Pro', prefix: 'PRO' },
] as const;
for (const spec of specs) {
  const env = process.env;
  const price = env[`${spec.prefix}_MONTHLY_PRICE`];
  const devices = env[`${spec.prefix}_MAX_DEVICES`];
  const tokens = env[`${spec.prefix}_MONTHLY_TOKEN_LIMIT`];
  const credit = env[`${spec.prefix}_MONTHLY_CREDIT_LIMIT`];
  const concurrent = env[`${spec.prefix}_MAX_CONCURRENT`];
  const rpm = env[`${spec.prefix}_RPM`];
  const configured = [price, devices, tokens, credit, concurrent, rpm].every(Boolean);
  await db.insert(plans).values({ code: spec.code, name: spec.name, description: `${spec.name} monthly subscription`, monthlyPrice: price ?? '0', currency: 'CNY', maxDevices: Number(devices ?? 0), monthlyTokenLimit: Number(tokens ?? 0), monthlyUsageCreditLimit: credit ?? '0', maxConcurrentRequests: Number(concurrent ?? 0), requestsPerMinute: Number(rpm ?? 0), enabled: configured }).onConflictDoNothing();
}
const providerSpecs = [
  { code: 'MOCK', name: 'Mock (test only)', baseUrl: null, enabled: process.env.ENABLE_MOCK_PROVIDER === 'true' },
  { code: 'DEEPSEEK', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', enabled: false },
  { code: 'COPILOT', name: 'GitHub Copilot', baseUrl: null, enabled: false },
];
for (const p of providerSpecs) await db.insert(providers).values(p).onConflictDoNothing();
for (const [code, publicId, providerModelId, name] of [
  ['MOCK', 'mock/mock-chat', 'mock-chat', 'Mock Chat'],
  ['DEEPSEEK', 'deepseek/deepseek-chat', 'deepseek-chat', 'DeepSeek Chat'],
  ['DEEPSEEK', 'deepseek/deepseek-reasoner', 'deepseek-reasoner', 'DeepSeek Reasoner'],
]) {
  const [provider] = await db.select().from(providers).where(eq(providers.code, code)).limit(1);
  await db.insert(models).values({ providerId: provider.id, publicId, providerModelId, displayName: name, enabled: code === 'MOCK' && process.env.ENABLE_MOCK_PROVIDER === 'true', supportsTools: true, supportsReasoning: name.includes('Reasoner'), supportsStreaming: true }).onConflictDoNothing();
}
if (process.env.ENABLE_MOCK_PROVIDER === 'true') {
  const [model] = await db.select().from(models).where(eq(models.publicId, 'mock/mock-chat')).limit(1);
  for (const spec of specs) {
    const [plan] = await db.select().from(plans).where(eq(plans.code, spec.code)).limit(1);
    await db.insert(planModelAccess).values({ planId: plan.id, modelId: model.id }).onConflictDoNothing();
  }
}
process.stdout.write('Seed complete\n');
await pool.end();
