import { expect, test } from '@playwright/test';

const account = {
  user: { id: 'user', email: 'new@example.test', role: 'USER', status: 'ACTIVE' },
  subscription: null, plan: null, devices: [],
  usage: { tokens: 99999, credit: 999, requests: 100, percent: 100, tokenLimit: 100000, creditLimit: 1000, threshold: 100 },
};

test('dashboard shows wallet and charged points, never SHADOW estimates or legacy token usage', async ({ page }) => {
  const requested: string[] = [];
  let summary = { requests: 2, pointsRated: 90, pointsCharged: 0 };
  let transactions = [{ id: 'grant', type: 'SUBSCRIPTION', points: 42, balanceAfter: 42, createdAt: '2026-09-01T00:00:00Z' }];
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    const bodies: Record<string, unknown> = {
      '/api/v1/account': account,
      '/api/v1/models': { data: [] },
      '/api/v1/releases/latest': { release: null },
      '/api/v1/me/wallet': { balance: 42, unit: 'AI_POINT' },
      '/api/v1/me/usage': summary,
      '/api/v1/me/wallet/transactions': { data: transactions },
    };
    if (!(path in bodies)) return route.fulfill({ status: 500, body: `Unexpected API: ${path}` });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(bodies[path]) });
  });

  await page.goto('/dashboard');
  await expect(page.getByText('AI 点数余额')).toBeVisible();
  await expect(page.getByText('累计实际扣费点数')).toBeVisible();
  await expect(page.getByText('SHADOW 仅测算、不扣费')).toBeVisible();
  await expect(page.getByText('待管理员开通').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /查看测试开通说明/ })).toHaveAttribute('href', '/pricing');
  await expect(page.getByText('Tokens')).toHaveCount(0);
  await expect(page.getByText('Credits')).toHaveCount(0);
  await page.getByRole('button', { name: 'AI 用量' }).click();
  await expect(page.getByRole('heading', { name: '实际扣费点数记录' })).toBeVisible();
  await expect(page.getByText('暂无实际扣费记录')).toBeVisible();
  await expect(page.getByText('SHADOW 测算不计入扣费')).toBeVisible();

  summary = { requests: 3, pointsRated: 97, pointsCharged: 7 };
  transactions = [...transactions, { id: 'settled', type: 'USAGE', points: -7, balanceAfter: 35, createdAt: '2026-09-02T00:00:00Z' }];
  await page.getByRole('button', { name: 'AI 点数', exact: true }).click();
  await page.getByRole('button', { name: 'AI 用量' }).click();
  await expect(page.getByText('-7')).toBeVisible();
  await expect(page.getByRole('heading', { name: '实际扣费点数记录' })).toBeVisible();
  await expect(page.getByText('累计实际扣费点数').locator('..').locator('strong')).toHaveText('7');

  summary = { requests: 0, pointsRated: 0, pointsCharged: 0 };
  transactions = [];
  await page.getByRole('button', { name: '概览' }).click();
  await expect(page.getByText('已计量请求数').locator('..').locator('strong')).toHaveText('0');
  await expect(page.getByText('累计实际扣费点数').locator('..').locator('strong')).toHaveText('0');
  await expect(page.getByText('OFF 模式请求不计入此数')).toBeVisible();
  await page.getByRole('button', { name: '订阅' }).click();
  await expect(page.getByText('待管理员开通').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '测试占位二维码 · 非支付二维码' })).toBeVisible();
  expect(requested).not.toContain('/api/v1/usage/history');
});

test('dashboard does not invent a balance or charge when V2 billing APIs fail', async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/me/wallet' || path === '/api/v1/me/usage')
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE","message":"暂时不可用"}}' });
    const bodies: Record<string, unknown> = {
      '/api/v1/account': account, '/api/v1/models': { data: [] },
      '/api/v1/releases/latest': { release: null },
      '/api/v1/me/wallet/transactions': { data: [] },
    };
    if (!(path in bodies)) return route.fulfill({ status: 500, body: `Unexpected API: ${path}` });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(bodies[path]) });
  });
  await page.goto('/dashboard');
  await expect(page.locator('.error-text[role="alert"]')).toContainText('无法读取计费状态');
  await expect(page.getByText('AI 点数余额')).toHaveCount(0);
  await expect(page.getByText('累计实际扣费点数')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /查看测试开通说明/ })).toBeVisible();
  await page.getByRole('button', { name: 'AI 点数', exact: true }).click();
  await expect(page.locator('.error-text[role="alert"]')).toContainText('暂时不可用');
  await expect(page.getByText('AI 点数余额')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '点数流水' })).toHaveCount(0);
});
