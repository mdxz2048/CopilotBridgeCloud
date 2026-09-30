import { expect, test } from '@playwright/test';

test('invite link uses the signed-in account code and encodes it for registration', async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      '/api/v1/auth/me': { user: { role: 'USER' } },
      '/api/v1/account': { user: { id: 'user', email: 'user@example.test', role: 'USER', status: 'ACTIVE' }, subscription: null, plan: null, devices: [], usage: null },
      '/api/v1/me/wallet': { balance: 0 },
      '/api/v1/referral/stats': { code: 'TEST&CODE+123', registered: 2 },
    };
    if (!(path in responses)) return route.fulfill({ status: 500, body: `Unexpected API: ${path}` });
    return route.fulfill({ json: responses[path] });
  });
  await page.goto('/dashboard');
  await expect(page.getByText('已邀请人数').locator('..').locator('strong')).toHaveText('2');
  await expect(page.getByRole('link', { name: '打开邀请注册链接' })).toHaveAttribute('href', '/register?ref=TEST%26CODE%2B123');
});
