import { expect, test } from '@playwright/test';

const account = {
  user: { id: 'user', email: 'new@example.test', role: 'USER', status: 'ACTIVE' },
  subscription: null, plan: null, devices: [],
  usage: { tokens: 99999, credit: 999, requests: 100, percent: 100 },
};

test('user dashboard shows only account status, invitation, real wallet and devices', async ({ page }) => {
  const requested: string[] = [];
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    const bodies: Record<string, unknown> = {
      '/api/v1/auth/me': { user: account.user },
      '/api/v1/account': account,
      '/api/v1/me/wallet': { balance: 42 },
      '/api/v1/referral/stats': { registered: 3, code: 'TESTCODE123' },
    };
    if (!(path in bodies)) return route.fulfill({ status: 500, body: `Unexpected API: ${path}` });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(bodies[path]) });
  });
  await page.goto('/dashboard');
  await expect(page.getByText('账号状态', { exact: true }).locator('..').locator('strong')).toHaveText('待开通');
  await expect(page.getByText('已邀请人数').locator('..').locator('strong')).toHaveText('3');
  await expect(page.getByText('剩余 AI 点数').locator('..').locator('strong')).toHaveText('42');
  await expect(page.getByText('已绑定设备').locator('..').locator('strong')).toHaveText('0');
  await expect(page.getByRole('link', { name: '前往下载页面' })).toHaveAttribute('href', '/download');
  await expect(page.getByText('99999')).toHaveCount(0);
  expect(requested).not.toContain('/api/v1/me/usage');
  expect(requested).not.toContain('/api/v1/usage/history');
});

test('wallet failures do not invent a balance', async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/me/wallet')
      return route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: '暂时不可用' } } });
    const bodies: Record<string, unknown> = {
      '/api/v1/auth/me': { user: account.user }, '/api/v1/account': account,
      '/api/v1/referral/stats': { registered: 0, code: 'TESTCODE123' },
    };
    if (!(path in bodies)) return route.fulfill({ status: 500 });
    return route.fulfill({ json: bodies[path] });
  });
  await page.goto('/dashboard');
  await expect(page.locator('.auth-card [role="alert"]')).toContainText('账号状态暂时无法读取');
  await expect(page.getByText('剩余 AI 点数')).toHaveCount(0);
});
