import { expect, test } from '@playwright/test';

test('returning from another app refreshes the four account indicators once', async ({ page }) => {
  let balance = 5;
  let registered = 0;
  const calls: Record<string, number> = {};
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    calls[path] = (calls[path] ?? 0) + 1;
    const responses: Record<string, unknown> = {
      '/api/v1/auth/me': { user: { role: 'USER' } },
      '/api/v1/account': { user: { id: 'user', email: 'user@example.test', role: 'USER', status: 'ACTIVE' },
        subscription: null, plan: null, devices: [], usage: null },
      '/api/v1/me/wallet': { balance },
      '/api/v1/referral/stats': { code: 'TESTCODE123', registered },
    };
    if (!(path in responses)) return route.fulfill({ status: 500, body: `Unexpected API: ${path}` });
    return route.fulfill({ json: responses[path] });
  });

  await page.goto('/dashboard');
  await expect(page.getByText('剩余 AI 点数').locator('..').locator('strong')).toHaveText('5');
  const initialAccountCalls = calls['/api/v1/account'];
  balance = 25;
  registered = 3;
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByText('剩余 AI 点数').locator('..').locator('strong')).toHaveText('25');
  await expect(page.getByText('已邀请人数').locator('..').locator('strong')).toHaveText('3');
  expect(calls['/api/v1/account']).toBe(initialAccountCalls + 1);
  const accountCalls = calls['/api/v1/account'];
  await page.waitForTimeout(350);
  expect(calls['/api/v1/account']).toBe(accountCalls);
});
