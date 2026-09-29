import { expect, test } from '@playwright/test';

test('invite link copies a same-origin encoded URL and reports clipboard failures', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const methods: string[] = [];
  await page.route('**/api/v1/**', route => {
    const request = route.request();
    methods.push(request.method());
    const path = new URL(request.url()).pathname;
    const responses: Record<string, unknown> = {
      '/api/v1/account': { user: { id: 'user', email: 'user@example.test', role: 'USER', status: 'ACTIVE' }, subscription: null, plan: null, devices: [], usage: null },
      '/api/v1/models': { data: [] },
      '/api/v1/releases/latest': { release: null },
      '/api/v1/me/wallet': { balance: 0 },
      '/api/v1/me/usage': { requests: 0, pointsCharged: 0 },
      '/api/v1/referral/stats': { code: 'TEST&CODE+123', registered: 0, rewarded: 0, pointsEarned: 0 },
      '/api/v1/referral/history': { data: [] },
    };
    if (!(path in responses)) return route.fulfill({ status: 500, body: `Unexpected API: ${path}` });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(responses[path]) });
  });

  await page.goto('/dashboard');
  await page.getByRole('button', { name: '邀请', exact: true }).click();
  const path = '/register?ref=TEST%26CODE%2B123';
  await expect(page.getByRole('link', { name: '打开注册邀请链接' })).toHaveAttribute('href', path);
  await page.getByRole('button', { name: '复制注册链接' }).click();
  await expect(page.getByRole('status').filter({ hasText: '注册链接已复制' })).toContainText('注册本身不发奖');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL(path, page.url()).href);

  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('Clipboard blocked')) });
  });
  await page.getByRole('button', { name: '复制注册链接' }).click();
  await expect(page.locator('.error-text[role="alert"]')).toContainText('复制失败');
  await expect(page.getByRole('link', { name: '打开注册邀请链接' })).toHaveAttribute('href', path);
  expect(methods.every(method => method === 'GET')).toBe(true);
});
