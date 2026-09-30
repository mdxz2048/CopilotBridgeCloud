import { expect, test } from '@playwright/test';

const initial = {
  verificationRequired: false,
  turnstile: { siteKey: 'public-site-key', secretConfigured: true, expectedHostname: 'example.test' },
  email: { smtpHost: 'smtp.resend.com', smtpPort: 465, smtpUser: 'resend', passwordConfigured: true, from: 'sender@example.test' },
  template: { subject: 'Registration code', body: 'Your code is {{code}}.\nUse it soon.' },
};
type SettingsWrite = {
  turnstile: { siteKey: string; expectedHostname: string; secretKey?: string };
  email: { smtpHost: string; smtpPort: number; smtpUser: string; from: string; password?: string };
  template: { subject: string; body: string };
};

test('admin edits website settings without retransmitting saved secrets and previews plaintext', async ({ page }) => {
  let settings = initial;
  const writes: SettingsWrite[] = [];
  const requests: string[] = [];
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path === '/api/v1/auth/me') return route.fulfill({ json: { user: { email: 'admin@example.test', role: 'ADMIN' } } });
    if (path === '/api/v1/admin/dashboard') return route.fulfill({ json: {} });
    if (path === '/api/v1/admin/website-settings') {
      if (route.request().method() === 'PUT') {
        const body: SettingsWrite = route.request().postDataJSON();
        writes.push(body);
        settings = {
          ...settings, turnstile: { ...body.turnstile, secretConfigured: true },
          email: { ...body.email, passwordConfigured: true }, template: body.template,
        };
      }
      return route.fulfill({ json: settings });
    }
    return route.fulfill({ status: 501, body: `Unexpected API: ${path}` });
  });

  await page.goto('/admin');
  await page.getByRole('button', { name: '网站配置' }).click();
  await expect(page.getByText('服务端未要求验证', { exact: false })).toBeVisible();
  await expect(page.getByText('保存此处配置不会启用验证', { exact: false })).toBeVisible();
  await expect(page.getByText('请确认此发件域名已在 Resend 启用发送', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Cloudflare Turnstile Secret Key')).toBeEmpty();
  await expect(page.getByLabel('SMTP Password')).toBeEmpty();
  await expect(page.getByLabel('验证域名')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('邮件正文（纯文本）')).toHaveValue(initial.template.body);
  await page.getByRole('button', { name: '预览邮件' }).click();
  await expect(page.getByLabel('邮件预览')).toContainText('Your code is 123456.');
  await page.getByLabel('邮件主题').fill('New subject');
  await page.getByRole('button', { name: '保存网站配置' }).click();
  await expect(page.getByRole('status').filter({ hasText: '网站配置已保存' })).toBeVisible();
  expect(writes).toEqual([{
    turnstile: { siteKey: 'public-site-key', expectedHostname: 'example.test' },
    email: { smtpHost: 'smtp.resend.com', smtpPort: 465, smtpUser: 'resend', from: 'sender@example.test' },
    template: { subject: 'New subject', body: initial.template.body },
  }]);
  expect(requests.every(path => ['/api/v1/auth/me', '/api/v1/admin/dashboard', '/api/v1/admin/website-settings',
    '/api/v1/admin/insights', '/api/v1/admin/system', '/api/v1/admin/site/page-views'].includes(path))).toBe(true);
  await page.getByLabel('Cloudflare Turnstile Secret Key').fill('replacement-secret');
  await page.getByLabel('SMTP Password').fill('replacement-password');
  await page.getByRole('button', { name: '保存网站配置' }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].turnstile.secretKey).toBe('replacement-secret');
  expect(writes[1].email.password).toBe('replacement-password');
  await expect(page.getByLabel('Cloudflare Turnstile Secret Key')).toBeEmpty();
  await expect(page.getByLabel('SMTP Password')).toBeEmpty();
});

test('template requires the code placeholder and keeps edits after a failed save', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') return route.fulfill({ json: { user: { email: 'admin@example.test', role: 'ADMIN' } } });
    if (path === '/api/v1/admin/dashboard') return route.fulfill({ json: {} });
    if (path === '/api/v1/admin/website-settings') {
      if (route.request().method() === 'PUT') {
        writes++;
        return route.fulfill({ status: 400, json: { error: { code: 'INVALID_CONFIG', message: 'Invalid settings' } } });
      }
      return route.fulfill({ json: initial });
    }
    return route.fulfill({ status: 501 });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: '网站配置' }).click();
  await page.getByLabel('邮件正文（纯文本）').fill('Missing placeholder');
  await page.getByRole('button', { name: '保存网站配置' }).click();
  await expect(page.locator('.error-text[role="alert"]')).toContainText('{{code}}');
  expect(writes).toBe(0);
  await page.getByLabel('邮件正文（纯文本）').fill('Code: {{code}}');
  await page.getByRole('button', { name: '保存网站配置' }).click();
  await expect(page.locator('.error-text[role="alert"]')).toHaveText('Invalid settings');
  await expect(page.getByLabel('邮件正文（纯文本）')).toHaveValue('Code: {{code}}');
  expect(writes).toBe(1);
});
