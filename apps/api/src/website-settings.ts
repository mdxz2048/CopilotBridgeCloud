import { db, systemSettings } from '@bridge/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from './config.js';
import { ApiError } from './core.js';
import { decryptSecret, encryptSecret } from './security.js';

const key = 'website_verification';
const encrypted = z.object({ ciphertext: z.string(), iv: z.string(), tag: z.string() });
const storedSchema = z.object({
  turnstile: z.object({
    siteKey: z.string(), expectedHostname: z.string(), secret: encrypted.optional(),
  }),
  email: z.object({
    smtpHost: z.string(), smtpPort: z.number().int(), smtpUser: z.string(),
    from: z.string(), password: encrypted.optional(),
  }),
  template: z.object({ subject: z.string(), body: z.string() }),
});
const expectedHostname = new URL(config.PUBLIC_BASE_URL).hostname;
const templateDefault = {
  subject: 'Your registration request',
  body: 'Your registration code is {{code}}. It expires in 10 minutes. If you did not request it, ignore this email.',
};
export const websiteSettingsInput = z.object({
  turnstile: z.object({
    siteKey: z.string().max(256),
    expectedHostname: z.literal(expectedHostname),
    secretKey: z.string().min(1).max(4096).optional(),
  }),
  email: z.object({
    smtpHost: z.string().max(255), smtpPort: z.number().int().min(1).max(65535),
    smtpUser: z.string().max(255), from: z.union([z.literal(''), z.email()]),
    password: z.string().min(1).max(4096).optional(),
  }),
  template: z.object({
    subject: z.string().trim().min(1).max(200),
    body: z.string().min(1).max(4000).refine(value => value.includes('{{code}}'), 'Template must include {{code}}'),
  }),
});
type Stored = z.infer<typeof storedSchema>;

async function readStored() {
  const [setting] = await db.select({ value: systemSettings.value }).from(systemSettings)
    .where(eq(systemSettings.key, key)).limit(1);
  return setting ? storedSchema.parse(setting.value) : null;
}

export async function effectiveWebsiteSettings() {
  const stored = await readStored();
  return {
    turnstile: {
      siteKey: stored?.turnstile.siteKey ?? config.TURNSTILE_SITE_KEY ?? '',
      secretKey: stored?.turnstile.secret ? decryptSecret(stored.turnstile.secret) : config.TURNSTILE_SECRET_KEY ?? '',
      expectedHostname: stored?.turnstile.expectedHostname ?? config.TURNSTILE_EXPECTED_HOSTNAME ?? expectedHostname,
    },
    email: {
      smtpHost: stored?.email.smtpHost ?? config.SMTP_HOST ?? '',
      smtpPort: stored?.email.smtpPort ?? config.SMTP_PORT ?? 465,
      smtpUser: stored?.email.smtpUser ?? config.SMTP_USER ?? '',
      password: stored?.email.password ? decryptSecret(stored.email.password) : config.SMTP_PASSWORD ?? '',
      from: stored?.email.from ?? config.SMTP_FROM ?? '',
    },
    template: stored?.template ?? templateDefault,
  };
}

export async function publicWebsiteSettings() {
  const settings = await effectiveWebsiteSettings();
  return {
    verificationRequired: config.STAGED_EMAIL_REGISTRATION_ENABLED === 'true',
    turnstile: {
      siteKey: settings.turnstile.siteKey,
      secretConfigured: Boolean(settings.turnstile.secretKey),
      expectedHostname: settings.turnstile.expectedHostname,
    },
    email: {
      smtpHost: settings.email.smtpHost, smtpPort: settings.email.smtpPort,
      smtpUser: settings.email.smtpUser, passwordConfigured: Boolean(settings.email.password),
      from: settings.email.from,
    },
    template: settings.template,
  };
}

export async function saveWebsiteSettings(input: z.infer<typeof websiteSettingsInput>) {
  const previous = await readStored();
  const candidate: Stored = {
    turnstile: {
      siteKey: input.turnstile.siteKey.trim(), expectedHostname: input.turnstile.expectedHostname,
      secret: input.turnstile.secretKey ? encryptSecret(input.turnstile.secretKey) : previous?.turnstile.secret,
    },
    email: {
      smtpHost: input.email.smtpHost.trim(), smtpPort: input.email.smtpPort,
      smtpUser: input.email.smtpUser.trim(), from: input.email.from.trim(),
      password: input.email.password ? encryptSecret(input.email.password) : previous?.email.password,
    },
    template: input.template,
  };
  if (config.STAGED_EMAIL_REGISTRATION_ENABLED === 'true'
    && (!candidate.turnstile.siteKey || !(candidate.turnstile.secret || config.TURNSTILE_SECRET_KEY)
      || !candidate.email.smtpHost || !candidate.email.smtpUser
      || !(candidate.email.password || config.SMTP_PASSWORD) || !candidate.email.from))
    throw new ApiError(400, 'INVALID_CONFIG', 'Verification requires complete Turnstile and mail settings');
  await db.insert(systemSettings).values({ key, value: candidate })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: candidate, updatedAt: new Date() } });
  return publicWebsiteSettings();
}
