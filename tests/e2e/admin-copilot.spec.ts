import { expect, test } from '@playwright/test';

test('admin starts Copilot authorization from Providers without opening real services', async ({ page, context }) => {
  let providers = [
    { id: 'copilot', code: 'COPILOT', name: 'GitHub Copilot', enabled: false },
    { id: 'deepseek', code: 'DEEPSEEK', name: 'DeepSeek', enabled: true },
  ];
  let authStatus = 'NOT_AUTHENTICATED';
  let starts = 0;

  await context.route('https://github.com/**', route => {
    expect(new URL(route.request().url()).pathname).toBe('/login/device');
    return route.fulfill({ contentType: 'text/html', body: '<h1>Mock GitHub verification</h1>' });
  });
  await context.route('**/api/v1/**', route => {
    const { pathname } = new URL(route.request().url());
    let body;
    if (pathname === '/api/v1/auth/me') body = { user: { email: 'admin@example.test', role: 'ADMIN' } };
    else if (pathname === '/api/v1/admin/dashboard') body = {};
    else if (pathname === '/api/v1/admin/providers') body = { data: providers };
    else if (pathname === '/api/v1/admin/models') body = { data: [] };
    else if (pathname === '/api/v1/admin/copilot/auth') {
      if (route.request().method() === 'POST') {
        starts++;
        authStatus = 'PENDING';
      }
      body = authStatus === 'PENDING'
        ? {
          status: authStatus,
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://github.com/login/device',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }
        : authStatus === 'AUTHENTICATED'
          ? { status: authStatus, login: 'mock-admin' }
          : { status: authStatus };
    } else {
      return route.fulfill({ status: 501, body: 'Unexpected API request' });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/admin');
  await page.getByRole('button', { name: 'Provider 连接' }).click();
  await expect(page.locator('.copilot-auth')).toHaveCount(1);
  await expect(page.locator('.copilot-auth + .toolbar')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '开始认证' })).toBeVisible();
  expect(starts).toBe(0);

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: '开始认证' }).click(),
  ]);
  await expect(page.getByText('ABCD-EFGH')).toBeVisible();
  await popup.waitForURL('https://github.com/login/device');
  await expect(popup.getByRole('heading', { name: 'Mock GitHub verification' })).toBeVisible();
  expect(starts).toBe(1);

  authStatus = 'AUTHENTICATED';
  await expect(page.getByText(/登录名：mock-admin/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: '管理', exact: true }).click();
  await expect(page.getByText('新 API Key（留空则不修改）')).toBeVisible();
  await expect(page.locator('.copilot-auth')).toHaveCount(1);

  providers = providers.filter(provider => provider.code !== 'COPILOT');
  await page.getByRole('button', { name: '网站总览' }).click();
  await page.getByRole('button', { name: 'Provider 连接' }).click();
  await expect(page.locator('.copilot-auth')).toHaveCount(0);
});
