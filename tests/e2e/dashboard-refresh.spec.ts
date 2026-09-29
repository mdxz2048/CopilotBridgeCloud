import { expect, test } from '@playwright/test';

test('returning from another app refreshes account, wallet, usage and referral once', async ({ page }) => {
  let subscription: object | null = null;
  let plan: object | null = null;
  let balance = 5;
  let requests = 0;
  let registered = 0;
  const calls: Record<string, number> = {};
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    calls[path] = (calls[path] ?? 0) + 1;
    const responses: Record<string, unknown> = {
      '/api/v1/account': { user: { id: 'user', email: 'user@example.test', role: 'USER', status: 'ACTIVE' },
        subscription, plan, devices: [], usage: null },
      '/api/v1/me/wallet': { balance },
      '/api/v1/me/usage': { requests, pointsRated: 20, pointsCharged: 0 },
      '/api/v1/models': { data: [] },
      '/api/v1/releases/latest': { release: null },
      '/api/v1/referral/stats': { code: 'TESTCODE123', registered, rewarded: 0, pointsEarned: 0 },
      '/api/v1/referral/history': { data: [] },
    };
    if (!(path in responses)) return route.fulfill({ status: 500, body: `Unexpected API: ${path}` });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(responses[path]) });
  });

  await page.goto('/dashboard');
  await expect(page.getByText('待管理员开通').first()).toBeVisible();
  await expect(page.getByText('AI 点数余额').locator('..').locator('strong')).toHaveText('5');
  const initialAccountCalls = calls['/api/v1/account'];
  const initialWalletCalls = calls['/api/v1/me/wallet'];
  plan = { name: '手工测试套餐', maxDevices: 1, monthlyPrice: '0' };
  subscription = { status: 'ACTIVE', currentPeriodEnd: '2026-10-29T00:00:00Z', cancelAtPeriodEnd: false };
  balance = 25;
  requests = 1;
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByText('手工测试套餐')).toBeVisible();
  await expect(page.getByText('AI 点数余额').locator('..').locator('strong')).toHaveText('25');
  await expect(page.getByText('已计量请求数').locator('..').locator('strong')).toHaveText('1');
  expect(calls['/api/v1/account']).toBe(initialAccountCalls + 1);
  expect(calls['/api/v1/me/wallet']).toBe(initialWalletCalls + 1);

  await page.getByRole('button', { name: '邀请', exact: true }).click();
  await expect(page.getByText('已邀请').locator('..').locator('strong')).toHaveText('0');
  const initialReferralCalls = calls['/api/v1/referral/stats'];
  registered = 3;
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.getByText('已邀请').locator('..').locator('strong')).toHaveText('3');
  expect(calls['/api/v1/referral/stats']).toBe(initialReferralCalls + 1);
  const accountCalls = calls['/api/v1/account'];
  await page.waitForTimeout(350);
  expect(calls['/api/v1/account']).toBe(accountCalls);
});
