import { expect, test } from '@playwright/test';

async function mockAccount(page: import('@playwright/test').Page, role: 'USER' | 'ADMIN') {
  const adminRequests: string[] = [];
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/v1/admin/')) adminRequests.push(path);
    const bodies: Record<string, unknown> = {
      '/api/v1/auth/me': { user: { email: `${role.toLowerCase()}@example.test`, role } },
      '/api/v1/account': { user: { id: 'user-id', email: `${role.toLowerCase()}@example.test`,
        role, status: 'ACTIVE' }, subscription: null, plan: null, devices: [], usage: null },
      '/api/v1/models': { data: [] },
      '/api/v1/releases/latest': { release: null },
      '/api/v1/me/wallet': { balance: 0 },
      '/api/v1/referral/stats': { code: 'TESTCODE123', registered: 0 },
      '/api/v1/admin/dashboard': { users: 1, devices: 0, orders: 0, requests: 0 },
      '/api/v1/admin/insights': { periodDays: 30, requests: [], models: [] },
      '/api/v1/admin/system': { database: 'ok', gateway: 'ok' },
      '/api/v1/admin/site/page-views': { metric: 'page_views', data: [] },
    };
    if (!(path in bodies)) return route.fulfill({ status: 501, body: `Unexpected API: ${path}` });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(bodies[path]) });
  });
  return adminRequests;
}

test('a normal user sees only self-service navigation and is redirected away from Admin', async ({ page }) => {
  const adminRequests = await mockAccount(page, 'USER');
  await page.goto('/dashboard');
  await expect(page.getByRole('navigation', { name: '用户中心导航' })).toBeVisible();
  await expect(page.getByText('已邀请人数')).toBeVisible();
  await expect(page.getByText('剩余 AI 点数')).toBeVisible();
  await expect(page.getByText('已绑定设备', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI 用量' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '管理后台' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '网站配置' })).toHaveCount(0);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('navigation', { name: '管理员导航' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '网站配置' })).toHaveCount(0);
  expect(adminRequests).toEqual([]);
});

test('an administrator goes directly to their separate console', async ({ page }) => {
  await mockAccount(page, 'ADMIN');
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('navigation', { name: '管理员导航' })).toBeVisible();
  await expect(page.getByRole('button', { name: '用户管理' })).toBeVisible();
  await expect(page.getByRole('button', { name: '模型管理' })).toBeVisible();
  await expect(page.getByRole('link', { name: '用户中心' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '网站配置' })).toBeVisible();
});
