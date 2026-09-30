import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, desc } from 'drizzle-orm';

const sendMail = vi.hoisted(() => vi.fn<(message: { text: string; to: string }) => Promise<unknown>>());
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

const enabled = Boolean(process.env.V2_TEST_DATABASE_URL);
describe.skipIf(!enabled)('staged registration (dedicated PostgreSQL)', () => {
  let app: Awaited<ReturnType<typeof import('./server.js').createServer>>;
  let data: typeof import('@bridge/db');
  let ip = 10;
  const email = () => `registration-${randomUUID()}@example.test`;
  const password = 'correct-password-123';
  const emailHash = (address: string) => createHmac('sha256', process.env.REFRESH_TOKEN_PEPPER!)
    .update(`registration:email:${address.toLowerCase()}`).digest('hex');
  const inject = async (method: 'GET' | 'POST', url: string, payload?: object, origin = 'http://localhost:3000') =>
    await app.inject({ method, url, payload, remoteAddress: `192.0.2.${ip++}`, headers: { origin } });
  const captcha = { turnstileToken: 'captcha-test' };
  const issue = async (address: string) => {
    const response = await inject('POST', '/api/v1/auth/email-code', { email: address, ...captcha });
    expect(response.statusCode).toBe(202);
    const call = sendMail.mock.lastCall?.[0];
    expect(call?.text).toMatch(/registration code is \d{6}/);
    return call!.text.match(/registration code is (\d{6})/)![1];
  };

  beforeAll(async () => {
    if (!new URL(process.env.V2_TEST_DATABASE_URL!).pathname.startsWith('/bridge_v2_test_'))
      throw new Error('REFUSE_NON_TEST_DATABASE');
    process.env.DATABASE_URL = process.env.V2_TEST_DATABASE_URL!;
    process.env.NODE_ENV = 'test';
    process.env.ACCESS_SECRET ??= 'a'.repeat(64);
    process.env.REFRESH_TOKEN_PEPPER ??= 'b'.repeat(64);
    process.env.PROVIDER_MASTER_KEY ??= 'c'.repeat(64);
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
    process.env.STAGED_EMAIL_REGISTRATION_ENABLED = 'true';
    process.env.TURNSTILE_SITE_KEY = 'public-key';
    process.env.TURNSTILE_SECRET_KEY = 'private-key';
    process.env.TURNSTILE_EXPECTED_HOSTNAME = 'localhost';
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASSWORD = 'password';
    process.env.SMTP_FROM = 'verify@example.test';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true, hostname: 'localhost', action: 'registration_email_code',
    }), { status: 200 })));
    sendMail.mockImplementation(async message => ({ accepted: [message.to] }));
    data = await import('@bridge/db');
    app = await (await import('./server.js')).createServer();
  }, 180_000);
  afterAll(async () => { await app?.close(); await data?.pool.end(); vi.unstubAllGlobals(); }, 180_000);

  it('rejects missing and invalid captcha before sending, without affecting admin login', async () => {
    const address = email();
    const missing = await inject('POST', '/api/v1/auth/email-code', { email: address });
    expect(missing.statusCode).toBe(400);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const invalid = await inject('POST', '/api/v1/auth/email-code', { email: address, ...captcha });
    expect(invalid.statusCode).toBe(403);
    expect(sendMail).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true, hostname: 'localhost', action: 'registration_email_code',
    }), { status: 200 })));
    const adminEmail = email();
    const [admin] = await data.db.insert(data.users).values({
      email: adminEmail, passwordHash: await (await import('./security.js')).hashPassword(password), role: 'ADMIN',
    }).returning();
    expect(admin.role).toBe('ADMIN');
    const missingWebCaptcha = await inject('POST', '/api/v1/auth/login', { email: adminEmail, password });
    expect(missingWebCaptcha.json().error.code).toBe('TURNSTILE_INVALID');
    const missingCode = await inject('POST', '/api/v1/auth/register', { email: email(), password });
    expect(missingCode.json().error.code).toBe('VALIDATION_ERROR');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true, hostname: 'localhost', action: 'web_login',
    }), { status: 200 })));
    const login = await inject('POST', '/api/v1/auth/login', { email: adminEmail, password, ...captcha });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.role).toBe('ADMIN');
    const adminRead = await app.inject({
      method: 'GET', url: '/api/v1/admin/rate-policy', headers: { cookie: login.headers['set-cookie'] as string },
    });
    expect(adminRead.statusCode).toBe(200);
    const [plan] = await data.db.insert(data.plans).values({
      code: `TEST${randomUUID().slice(0, 8)}`, name: 'Registration test',
      monthlyPrice: '0', maxDevices: 2, monthlyTokenLimit: 1000,
      monthlyUsageCreditLimit: '1000', maxConcurrentRequests: 2, requestsPerMinute: 10,
    }).returning();
    const now = new Date();
    await data.db.insert(data.subscriptions).values({
      userId: admin.id, planId: plan.id, status: 'ACTIVE', startedAt: now, currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 86400000),
    });
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' }) as { kty: 'EC'; crv: 'P-256'; x: string; y: string };
    const payload = JSON.stringify({ email: adminEmail, password, device: {
      deviceId: randomUUID(), deviceName: 'Test desktop', platform: 'windows', osVersion: '', appVersion: '',
      publicKeyJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    } });
    const desktop = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload,
      headers: { host: 'localhost:3001', 'content-type': 'application/json' },
      remoteAddress: `192.0.2.${ip++}`,
    });
    expect(desktop.statusCode).toBe(200);
    expect(desktop.json().device.publicKeyJwk).toEqual(expect.objectContaining({ x: jwk.x, y: jwk.y }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true, hostname: 'localhost', action: 'registration_email_code',
    }), { status: 200 })));
  }, 180_000);

  it('never reports a failed SMTP send as successful, and masks registered emails', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP offline'));
    const failed = await inject('POST', '/api/v1/auth/email-code', { email: email(), ...captcha });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error.code).toBe('EMAIL_DELIVERY_UNAVAILABLE');
    const existing = email();
    await data.db.insert(data.users).values({ email: existing, passwordHash: 'test' });
    const count = sendMail.mock.calls.length;
    const masked = await inject('POST', '/api/v1/auth/email-code', { email: existing, ...captcha });
    expect(masked.statusCode).toBe(202);
    expect(masked.json()).toEqual({ accepted: true });
    expect(sendMail.mock.calls.length).toBe(count + 1);
    expect(sendMail.mock.lastCall?.[0].text).not.toContain('registration code is');
  }, 180_000);

  it('enforces durable email cooldown, hourly email quota and hourly IP quota', async () => {
    const address = email();
    await issue(address);
    const cooldown = await inject('POST', '/api/v1/auth/email-code', { email: address, ...captcha });
    expect(cooldown.statusCode).toBe(429);
    for (let attempt = 0; attempt < 2; attempt++) {
      await data.db.update(data.registrationChallenges).set({ createdAt: new Date(Date.now() - 65000) })
        .where(eq(data.registrationChallenges.emailHash, emailHash(address)));
      await issue(address);
    }
    const exhausted = await inject('POST', '/api/v1/auth/email-code', { email: address, ...captcha });
    expect(exhausted.statusCode).toBe(429);

    const { requestEmailCode } = await import('./registration.js');
    const quotaIp = `2001:db8:${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}::1`;
    for (let attempt = 0; attempt < 8; attempt++) await requestEmailCode(email(), quotaIp);
    await expect(requestEmailCode(email(), quotaIp)).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  }, 180_000);

  it('limits wrong codes, rejects expired codes, and prevents replay', async () => {
    const address = email();
    const code = await issue(address);
    const wrong = await inject('POST', '/api/v1/auth/register', { email: address, password, emailCode: '999999' === code ? '111111' : '999999' });
    expect(wrong.statusCode).toBe(400);
    const success = await inject('POST', '/api/v1/auth/register', { email: address, password, emailCode: code });
    expect(success.statusCode).toBe(201);
    expect((await inject('POST', '/api/v1/auth/register', { email: address, password, emailCode: code })).json().error.code).toBe('EMAIL_CODE_INVALID');
    const expiring = email();
    const expiredCode = await issue(expiring);
    const { registrationChallenges } = data;
    const [challenge] = await data.db.select().from(registrationChallenges)
      .where(eq(registrationChallenges.emailHash, emailHash(expiring))).orderBy(desc(registrationChallenges.createdAt));
    await data.db.update(registrationChallenges).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(registrationChallenges.id, challenge.id));
    const expired = await inject('POST', '/api/v1/auth/register', { email: expiring, password, emailCode: expiredCode });
    expect(expired.json().error.code).toBe('EMAIL_CODE_INVALID');
    expect((await data.db.select().from(data.users).where(eq(data.users.email, expiring))).length).toBe(0);

    const attempted = email();
    await issue(attempted);
    const { consumeEmailCode } = await import('./registration.js');
    for (let index = 0; index < 5; index++)
      expect(await data.db.transaction(tx => consumeEmailCode(tx, attempted, 'abcdef'))).toBe(false);
    const [exhausted] = await data.db.select().from(registrationChallenges)
      .where(eq(registrationChallenges.emailHash, emailHash(attempted)));
    expect(exhausted.state).toBe('EXHAUSTED');
  }, 180_000);

  it('rolls back invalid referral and duplicate-email registration while preserving challenge', async () => {
    const address = email();
    const code = await issue(address);
    const invalid = await inject('POST', '/api/v1/auth/register',
      { email: address, password, emailCode: code, referralCode: 'INVALID_CODE' });
    expect(invalid.json().error.code).toBe('INVALID_REFERRAL_CODE');
    const [referrer] = await data.db.insert(data.users).values({ email: email(), passwordHash: 'test' }).returning();
    const referralCode = `VALID${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    await data.db.insert(data.referralCodes).values({ userId: referrer.id, code: referralCode });
    const valid = await inject('POST', '/api/v1/auth/register',
      { email: address, password, emailCode: code, referralCode });
    expect(valid.statusCode).toBe(201);
    const [referral] = await data.db.select().from(data.referrals).where(eq(data.referrals.referredUserId, valid.json().user.id));
    expect(referral.referrerUserId).toBe(referrer.id);

    const duplicate = email();
    const duplicateCode = await issue(duplicate);
    await data.db.insert(data.users).values({ email: duplicate, passwordHash: 'test' });
    const collision = await inject('POST', '/api/v1/auth/register', { email: duplicate, password, emailCode: duplicateCode });
    expect(collision.statusCode).toBe(409);
    expect(collision.json().error.code).toBe('EMAIL_IN_USE');
    const [challenge] = await data.db.select().from(data.registrationChallenges)
      .where(eq(data.registrationChallenges.emailHash, emailHash(duplicate)));
    expect(challenge.state).toBe('ISSUED');
  }, 180_000);

  it('keeps admin website credentials encrypted and uses the edited email template', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/website-settings' })).statusCode).toBe(401);
    const adminEmail = email();
    await data.db.insert(data.users).values({
      email: adminEmail, passwordHash: await (await import('./security.js')).hashPassword(password), role: 'ADMIN',
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true, hostname: 'localhost', action: 'web_login',
    }), { status: 200 })));
    const login = await inject('POST', '/api/v1/auth/login', { email: adminEmail, password, ...captcha });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers['set-cookie'] as string;
    const before = await app.inject({ method: 'GET', url: '/api/v1/admin/website-settings', headers: { cookie } });
    expect(before.statusCode).toBe(200);
    expect(before.json().turnstile.secretConfigured).toBe(true);
    const update = await app.inject({
      method: 'PUT', url: '/api/v1/admin/website-settings', headers: { cookie, origin: 'http://localhost:3000' },
      payload: {
        turnstile: { siteKey: 'updated-public-key', expectedHostname: 'localhost', secretKey: 'updated-private-key' },
        email: { smtpHost: 'smtp.example.test', smtpPort: 587, smtpUser: 'user',
          from: 'verify@example.test', password: 'updated-mail-password' },
        template: { subject: 'Registration {{code}}', body: 'Code: {{code}}' },
      },
    });
    expect(update.statusCode).toBe(200);
    expect(JSON.stringify(update.json())).not.toContain('updated-private-key');
    expect(JSON.stringify(update.json())).not.toContain('updated-mail-password');
    const [stored] = await data.db.select().from(data.systemSettings).where(eq(data.systemSettings.key, 'website_verification'));
    expect(JSON.stringify(stored.value)).not.toContain('updated-private-key');
    expect(JSON.stringify(stored.value)).not.toContain('updated-mail-password');
    expect((await inject('GET', '/api/v1/auth/registration-config')).json().turnstileSiteKey).toBe('updated-public-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true, hostname: 'localhost', action: 'registration_email_code',
    }), { status: 200 })));
    const delivered = await inject('POST', '/api/v1/auth/email-code', { email: email(), ...captcha });
    expect(delivered.statusCode).toBe(202);
    expect(sendMail.mock.lastCall?.[0].text).toMatch(/^Code: \d{6}$/);
    await data.db.delete(data.systemSettings).where(eq(data.systemSettings.key, 'website_verification'));
  }, 180_000);
});
