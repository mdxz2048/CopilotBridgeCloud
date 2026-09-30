import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ stored: null as object | null }));
vi.mock('@bridge/db', async importOriginal => {
  const original = await importOriginal<typeof import('@bridge/db')>();
  return { ...original, db: {
    select: () => ({ from: () => ({ where: () => ({
      limit: async () => state.stored ? [{ value: state.stored }] : [],
    }) }) }),
    insert: () => ({ values: (entry: { value: object }) => ({
      onConflictDoUpdate: async () => { state.stored = entry.value; },
    }) }),
  } };
});

describe('editable website verification settings', () => {
  let settings: typeof import('./website-settings.js');
  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgres://localhost/bridge_website_settings_test';
    process.env.ACCESS_SECRET = 'a'.repeat(64);
    process.env.REFRESH_TOKEN_PEPPER = 'b'.repeat(64);
    process.env.PROVIDER_MASTER_KEY = 'c'.repeat(64);
    process.env.PUBLIC_BASE_URL = 'https://example.test';
    process.env.STAGED_EMAIL_REGISTRATION_ENABLED = 'false';
    process.env.TURNSTILE_SITE_KEY = 'existing-public-key';
    process.env.TURNSTILE_SECRET_KEY = 'existing-private-key';
    process.env.TURNSTILE_EXPECTED_HOSTNAME = 'example.test';
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'resend';
    process.env.SMTP_PASSWORD = 'existing-mail-password';
    process.env.SMTP_FROM = 'verify@example.test';
    settings = await import('./website-settings.js');
  });
  afterEach(() => { state.stored = null; });

  it('shows existing environment configuration without returning either secret', async () => {
    const publicSettings = await settings.publicWebsiteSettings();
    expect(publicSettings).toMatchObject({
      verificationRequired: false,
      turnstile: { siteKey: 'existing-public-key', secretConfigured: true },
      email: { passwordConfigured: true, from: 'verify@example.test' },
    });
    expect(JSON.stringify(publicSettings)).not.toContain('existing-private-key');
    expect(JSON.stringify(publicSettings)).not.toContain('existing-mail-password');
  });

  it('encrypts replacement credentials and applies template edits without losing blank secrets', async () => {
    const input = {
      turnstile: { siteKey: 'new-public-key', expectedHostname: 'example.test', secretKey: 'new-private-key' },
      email: { smtpHost: 'smtp.resend.com', smtpPort: 465, smtpUser: 'resend',
        from: 'verify@example.test', password: 'new-mail-password' },
      template: { subject: 'Your code', body: 'Enter {{code}} within ten minutes.' },
    };
    expect(settings.websiteSettingsInput.safeParse(input).success).toBe(true);
    const saved = await settings.saveWebsiteSettings(input);
    expect(saved).toMatchObject({ template: input.template, turnstile: { secretConfigured: true },
      email: { passwordConfigured: true } });
    expect(JSON.stringify(state.stored)).not.toContain('new-private-key');
    expect(JSON.stringify(state.stored)).not.toContain('new-mail-password');
    expect((await settings.effectiveWebsiteSettings()).turnstile.secretKey).toBe('new-private-key');
    expect((await settings.effectiveWebsiteSettings()).email.password).toBe('new-mail-password');
    const updated = await settings.saveWebsiteSettings({
      ...input, turnstile: { siteKey: input.turnstile.siteKey, expectedHostname: 'example.test' },
      email: { ...input.email, password: undefined },
      template: { subject: 'Updated subject', body: 'Code: {{code}}' },
    });
    expect(updated.template.subject).toBe('Updated subject');
    expect((await settings.effectiveWebsiteSettings()).email.password).toBe('new-mail-password');
    expect((await settings.effectiveWebsiteSettings()).turnstile.secretKey).toBe('new-private-key');
  });

  it('rejects mismatched domains and templates that cannot deliver a code', () => {
    const base = {
      turnstile: { siteKey: 'site', expectedHostname: 'example.test' },
      email: { smtpHost: 'smtp.resend.com', smtpPort: 465, smtpUser: 'resend', from: 'verify@example.test' },
      template: { subject: 'Code', body: 'Code: {{code}}' },
    };
    expect(settings.websiteSettingsInput.safeParse({ ...base, turnstile: { ...base.turnstile,
      expectedHostname: 'attacker.test' } }).success).toBe(false);
    expect(settings.websiteSettingsInput.safeParse({ ...base, template: { subject: 'Code',
      body: 'No placeholder here' } }).success).toBe(false);
  });
});
