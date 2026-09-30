import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./website-settings.js', () => ({
  effectiveWebsiteSettings: async () => ({
    turnstile: {
      siteKey: process.env.TURNSTILE_SITE_KEY ?? '', secretKey: process.env.TURNSTILE_SECRET_KEY ?? '',
      expectedHostname: process.env.TURNSTILE_EXPECTED_HOSTNAME ?? '',
    },
    email: {
      smtpHost: process.env.SMTP_HOST ?? '', smtpPort: Number(process.env.SMTP_PORT) || 465,
      smtpUser: process.env.SMTP_USER ?? '', password: process.env.SMTP_PASSWORD ?? '',
      from: process.env.SMTP_FROM ?? '',
    },
    template: { subject: 'Registration', body: 'Code: {{code}}' },
  }),
}));

const required = {
  DATABASE_URL: 'postgres://localhost/bridge_registration_unit_test',
  ACCESS_SECRET: 'a'.repeat(64), REFRESH_TOKEN_PEPPER: 'b'.repeat(64),
  PROVIDER_MASTER_KEY: 'c'.repeat(64), PUBLIC_BASE_URL: 'https://example.test',
};
const gated = {
  STAGED_EMAIL_REGISTRATION_ENABLED: 'true', TURNSTILE_SITE_KEY: 'site',
  TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_EXPECTED_HOSTNAME: 'example.test',
  SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_USER: 'user',
  SMTP_PASSWORD: 'password', SMTP_FROM: 'verify@example.test',
};
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
const set = (env: Record<string, string>) => { for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value); };

describe('staged registration startup gate', () => {
  it('defaults safely to disabled without SMTP or captcha credentials', async () => {
    set(required);
    vi.stubEnv('STAGED_EMAIL_REGISTRATION_ENABLED', 'false');
    for (const key of Object.keys(gated).filter(key => key !== 'STAGED_EMAIL_REGISTRATION_ENABLED')) vi.stubEnv(key, undefined);
    vi.stubEnv('SMTP_FROM', '');
    vi.stubEnv('SMTP_PORT', '');
    expect((await import('./config.js')).config.STAGED_EMAIL_REGISTRATION_ENABLED).toBe('false');
    expect(await (await import('./registration.js')).registrationConfig()).toEqual({
      verificationRequired: false, turnstileSiteKey: null, registrationAvailable: true, configurationStatus: 'MISSING_CONFIG',
    });
  });

  it('fails startup with incomplete settings or the wrong verification hostname', async () => {
    set(required);
    vi.stubEnv('STAGED_EMAIL_REGISTRATION_ENABLED', 'true');
    for (const key of Object.keys(gated).filter(key => key !== 'STAGED_EMAIL_REGISTRATION_ENABLED')) vi.stubEnv(key, undefined);
    await expect(import('./config.js')).rejects.toThrow();
    vi.resetModules();
    set(gated);
    vi.stubEnv('TURNSTILE_EXPECTED_HOSTNAME', 'other.example.test');
    await expect(import('./config.js')).rejects.toThrow();
    vi.resetModules();
    vi.stubEnv('TURNSTILE_EXPECTED_HOSTNAME', 'example.test');
    expect((await import('./config.js')).config.STAGED_EMAIL_REGISTRATION_ENABLED).toBe('true');
    vi.resetModules();
    vi.stubEnv('STAGED_EMAIL_REGISTRATION_ENABLED', 'false');
    expect((await (await import('./registration.js')).registrationConfig()).configurationStatus).toBe('DISABLED');
  });
});
