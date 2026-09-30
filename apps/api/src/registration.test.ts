import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./website-settings.js', () => ({
  effectiveWebsiteSettings: async () => ({
    turnstile: { siteKey: process.env.TURNSTILE_SITE_KEY, secretKey: process.env.TURNSTILE_SECRET_KEY,
      expectedHostname: process.env.TURNSTILE_EXPECTED_HOSTNAME },
    email: { smtpHost: process.env.SMTP_HOST, smtpPort: Number(process.env.SMTP_PORT),
      smtpUser: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD, from: process.env.SMTP_FROM },
    template: { subject: 'Registration', body: 'Code: {{code}}' },
  }),
}));

process.env.DATABASE_URL ??= 'postgres://localhost/bridge_registration_unit_test';
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
process.env.SMTP_FROM = 'verification@example.test';

describe('staged registration Turnstile verification', () => {
  let verify: typeof import('./registration.js').verifyTurnstile;
  beforeAll(async () => {
    const registration = await import('./registration.js');
    verify = registration.verifyTurnstile;
    expect(registration.registrationMail(
      { subject: 'Code {{code}}', body: 'Enter {{code}} within ten minutes.' }, '123456', false,
    )).toEqual({ subject: 'Code 123456', text: 'Enter 123456 within ten minutes.' });
    expect(JSON.stringify(registration.registrationMail(
      { subject: 'Code {{code}}', body: 'Enter {{code}}.' }, '123456', true,
    ))).not.toContain('123456');
    expect(await registration.registrationConfig()).toEqual({
      verificationRequired: true, turnstileSiteKey: 'public-key', registrationAvailable: true, configurationStatus: 'READY',
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('requires a token and fails closed on invalid responses, action or hostname', async () => {
    await expect(verify(undefined, 'web_login', '127.0.0.1')).rejects.toMatchObject({ code: 'TURNSTILE_INVALID' });
    for (const body of [
      { success: false, action: 'web_login', hostname: 'localhost' },
      { success: true, action: 'registration_email_code', hostname: 'localhost' },
      { success: true, action: 'web_login', hostname: 'evil.example' },
      { success: true, action: 'web_login', hostname: 'localhost', remoteip: '192.0.2.4' },
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
      await expect(verify('token', 'web_login', '127.0.0.1')).rejects.toMatchObject({ code: 'TURNSTILE_INVALID' });
    }
  });

  it('uses only Cloudflare siteverify with action and remote IP', async () => {
    const fetchMock = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify({
      success: true, action: 'registration_email_code', hostname: 'localhost', remoteip: '127.0.0.1',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await verify('token', 'registration_email_code', '127.0.0.1');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const options = fetchMock.mock.calls[0]![1] as { body: URLSearchParams };
    expect(options.body.get('response')).toBe('token');
    expect(options.body.get('remoteip')).toBe('127.0.0.1');
  });

  it('fails closed when verification times out or upstream responds incorrectly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    await expect(verify('token', 'web_login', '127.0.0.1')).rejects.toMatchObject({ status: 503, code: 'TURNSTILE_UNAVAILABLE' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 502 })));
    await expect(verify('token', 'web_login', '127.0.0.1')).rejects.toMatchObject({ status: 503, code: 'TURNSTILE_UNAVAILABLE' });
  });
});
