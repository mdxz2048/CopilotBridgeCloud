import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { db, registrationChallenges, users } from '@bridge/db';
import { and, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { config } from './config.js';
import { ApiError } from './core.js';
import { effectiveWebsiteSettings } from './website-settings.js';

const enabled = config.STAGED_EMAIL_REGISTRATION_ENABLED === 'true';
let nextCleanup = 0;
const hash = (purpose: string, value: string) => createHmac('sha256', config.REFRESH_TOKEN_PEPPER)
  .update(`registration:${purpose}:${value}`).digest('hex');
export function registrationMail(template: { subject: string; body: string }, code: string, existing: boolean) {
  return existing
    ? {
      subject: 'Registration request received',
      text: 'A registration request was received for this address. If you already have an account, sign in instead. If you did not request this, ignore this email.',
    }
    : { subject: template.subject.replaceAll('{{code}}', code), text: template.body.replaceAll('{{code}}', code) };
}

export async function registrationConfig() {
  const settings = await effectiveWebsiteSettings();
  const configured = Boolean(settings.turnstile.siteKey && settings.turnstile.secretKey && settings.email.smtpHost
    && settings.email.smtpPort && settings.email.smtpUser && settings.email.password && settings.email.from
    && settings.turnstile.expectedHostname === new URL(config.PUBLIC_BASE_URL).hostname);
  return {
    verificationRequired: enabled, turnstileSiteKey: enabled ? settings.turnstile.siteKey : null,
    registrationAvailable: true,
    configurationStatus: enabled ? 'READY' as const : configured ? 'DISABLED' as const : 'MISSING_CONFIG' as const,
  };
}

export async function verifyTurnstile(token: string | undefined, action: 'registration_email_code' | 'web_login', ip: string) {
  if (!enabled) return;
  if (!token) throw new ApiError(403, 'TURNSTILE_INVALID');
  const { turnstile } = await effectiveWebsiteSettings();
  if (!turnstile.secretKey || turnstile.expectedHostname !== new URL(config.PUBLIC_BASE_URL).hostname)
    throw new ApiError(503, 'TURNSTILE_UNAVAILABLE');
  let response: Response;
  try {
    response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: turnstile.secretKey, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Turnstile service error');
    const result: unknown = await response.json();
    if (typeof result !== 'object' || !result || !('success' in result) || typeof result.success !== 'boolean')
      throw new Error('Invalid Turnstile response');
    if (!result.success || !('hostname' in result) || result.hostname !== turnstile.expectedHostname
      || !('action' in result) || result.action !== action
      || ('remoteip' in result && result.remoteip !== ip)) throw new ApiError(403, 'TURNSTILE_INVALID');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'TURNSTILE_UNAVAILABLE');
  }
}

export async function requestEmailCode(email: string, ip: string) {
  if (!enabled) throw new ApiError(404, 'FEATURE_DISABLED');
  const { email: mail, template } = await effectiveWebsiteSettings();
  if (!mail.smtpHost || !mail.smtpUser || !mail.password || !mail.from) throw new ApiError(503, 'EMAIL_DELIVERY_UNAVAILABLE');
  const implicitTls = mail.smtpPort === 465 || mail.smtpPort === 2465;
  const mailer = nodemailer.createTransport({
    host: mail.smtpHost, port: mail.smtpPort, secure: implicitTls,
    requireTLS: !implicitTls, auth: { user: mail.smtpUser, pass: mail.password },
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
  });
  const normalized = email.toLowerCase();
  const emailHash = hash('email', normalized);
  const ipHash = hash('ip', ip);
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const now = new Date();
  const challenge = await db.transaction(async tx => {
    // Serialize by IP then email to make cooldown and rolling quotas safe across API instances.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ipHash}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${emailHash}, 0))`);
    const [ipCount] = await tx.select({ total: sql<number>`count(*)` }).from(registrationChallenges)
      .where(and(eq(registrationChallenges.ipHash, ipHash), gte(registrationChallenges.createdAt, new Date(now.getTime() - 3600000))));
    const [emailCount] = await tx.select({ total: sql<number>`count(*)` }).from(registrationChallenges)
      .where(and(eq(registrationChallenges.emailHash, emailHash), gte(registrationChallenges.createdAt, new Date(now.getTime() - 3600000))));
    const [recent] = await tx.select({ id: registrationChallenges.id }).from(registrationChallenges)
      .where(and(eq(registrationChallenges.emailHash, emailHash),
        inArray(registrationChallenges.state, ['PENDING', 'ISSUED', 'SUPPRESSED']),
        gte(registrationChallenges.createdAt, new Date(now.getTime() - 60000)))).limit(1);
    if (Number(ipCount.total) >= 8 || Number(emailCount.total) >= 3 || recent) throw new ApiError(429, 'RATE_LIMITED');
    const [account] = await tx.select({ id: users.id }).from(users).where(eq(users.email, normalized)).limit(1);
    const [reserved] = await tx.insert(registrationChallenges).values({
      emailHash, ipHash, state: account ? 'SUPPRESSED' : 'PENDING', expiresAt: new Date(now.getTime() + 10 * 60000),
    }).returning({ id: registrationChallenges.id });
    if (Date.now() >= nextCleanup) {
      await tx.delete(registrationChallenges).where(lt(registrationChallenges.createdAt, new Date(now.getTime() - 86400000)));
      nextCleanup = Date.now() + 3600000;
    }
    return { ...reserved, existing: Boolean(account) };
  });
  try {
    const content = registrationMail(template, code, challenge.existing);
    const delivery = await mailer.sendMail({
      from: mail.from, to: normalized, ...content,
    });
    if (!Array.isArray(delivery.accepted) || !delivery.accepted.some((recipient: unknown) =>
      typeof recipient === 'string' && recipient.toLowerCase() === normalized)) throw new Error('Recipient not accepted');
  } catch {
    await db.update(registrationChallenges).set({ state: 'FAILED' }).where(eq(registrationChallenges.id, challenge.id));
    throw new ApiError(503, 'EMAIL_DELIVERY_UNAVAILABLE');
  }
  if (challenge.existing) {
    await db.update(registrationChallenges).set({ sentAt: new Date() }).where(eq(registrationChallenges.id, challenge.id));
    return;
  }
  await db.transaction(async tx => {
    await tx.update(registrationChallenges).set({ state: 'EXHAUSTED' })
      .where(and(eq(registrationChallenges.emailHash, emailHash), eq(registrationChallenges.state, 'ISSUED'),
        ne(registrationChallenges.id, challenge.id)));
    await tx.update(registrationChallenges).set({
      state: 'ISSUED', sentAt: new Date(), codeHash: hash('code', `${challenge.id}:${code}`),
    }).where(eq(registrationChallenges.id, challenge.id));
  });
}

export async function consumeEmailCode(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0], email: string, code: string,
) {
  const [challenge] = await tx.select().from(registrationChallenges)
    .where(and(eq(registrationChallenges.emailHash, hash('email', email.toLowerCase())),
      eq(registrationChallenges.state, 'ISSUED')))
    .orderBy(desc(registrationChallenges.createdAt)).for('update').limit(1);
  if (!challenge) throw new ApiError(400, 'EMAIL_CODE_INVALID');
  const expected = Buffer.from(challenge.codeHash ?? '', 'hex');
  const actual = Buffer.from(hash('code', `${challenge.id}:${code}`), 'hex');
  if (challenge.expiresAt <= new Date() || challenge.attempts >= 5
    || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await tx.update(registrationChallenges).set({
      attempts: challenge.attempts + 1, state: challenge.attempts >= 4 || challenge.expiresAt <= new Date() ? 'EXHAUSTED' : 'ISSUED',
    }).where(eq(registrationChallenges.id, challenge.id));
    return false;
  }
  await tx.update(registrationChallenges).set({ state: 'USED' }).where(eq(registrationChallenges.id, challenge.id));
  return true;
}
