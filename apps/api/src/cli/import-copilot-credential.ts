import { auditLogs, db, pool, providerCredentials, providers } from '@bridge/db';
import { eq } from 'drizzle-orm';
import { CopilotProvider } from '../copilot-provider.js';
import { encryptSecret } from '../security.js';

async function readToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      value += chunk;
      if (value.length > 4096) reject(new Error('TOKEN_TOO_LONG'));
    });
    process.stdin.on('end', () => resolve(value.trim()));
  });
}

try {
  const token = await readToken();
  if (!/^(gho_|ghu_|github_pat_)[A-Za-z0-9_]+$/.test(token)) throw new Error('TOKEN_FORMAT_INVALID');
  const github = await fetch('https://api.github.com/user', { headers: {
    Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Copilot-Bridge-Cloud',
  }, signal: AbortSignal.timeout(10000) });
  if (!github.ok) throw new Error('GITHUB_AUTH_FAILED');
  const identity = await github.json() as { login?: string };
  if (!identity.login) throw new Error('GITHUB_AUTH_FAILED');
  const discovered = await new CopilotProvider(token, 60000).discover();
  const selected = discovered.models.find(model => model.id === 'gpt-5.4-mini' && model.policy?.state === 'enabled');
  if (!selected) throw new Error('COPILOT_MODEL_NOT_ENTITLED');
  const [provider] = await db.select().from(providers).where(eq(providers.code, 'COPILOT')).limit(1);
  if (!provider) throw new Error('COPILOT_PROVIDER_NOT_SEEDED');
  const encrypted = encryptSecret(token);
  await db.transaction(async tx => {
    await tx.insert(providerCredentials).values({ providerId: provider.id, ...encrypted })
      .onConflictDoUpdate({ target: providerCredentials.providerId, set: { ...encrypted, updatedAt: new Date() } });
    await tx.insert(auditLogs).values({ actorId: null, action: 'COPILOT_CREDENTIAL_IMPORTED', targetType: 'PROVIDER', targetId: provider.id,
      metadata: { githubLogin: identity.login, discoveredModelCount: discovered.models.length, releaseModel: selected.id } });
  });
  process.stdout.write(`${JSON.stringify({ githubAuthentication: 'PASS', copilotEntitlement: 'PASS',
    githubLogin: identity.login, discoveredModels: discovered.models.map(model => model.id),
    credentialStorage: 'AES_256_GCM_DATABASE' })}\n`);
} catch (error) {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'COPILOT_CREDENTIAL_IMPORT_FAILED';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
} finally { await pool.end(); }
