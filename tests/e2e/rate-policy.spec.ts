import { expect, test } from '@playwright/test';

test('admin can review and change new-turn and public IP limits', async ({ page }) => {
  let policy = { accountRpm: 2, deviceRpm: 1, publicIpRpm: 60, authIpRpm: 10 };
  const writes: typeof policy[] = [];
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/admin/rate-policy' && route.request().method() === 'PUT') {
      policy = route.request().postDataJSON() as typeof policy;
      writes.push(policy);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ policy }) });
    }
    const bodies: Record<string, unknown> = {
      '/api/v1/auth/me': { user: { email: 'admin@example.test', role: 'ADMIN' } },
      '/api/v1/admin/dashboard': {},
      '/api/v1/admin/system': { database: 'ok', gateway: 'ok', settings: [] },
      '/api/v1/admin/rate-policy': { policy },
    };
    if (!(path in bodies)) return route.fulfill({ status: 501, body: `Unexpected API: ${path}` });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(bodies[path]) });
  });

  await page.goto('/admin');
  await page.getByRole('button', { name: '系统状态' }).click();
  await expect(page.getByLabel('每设备 AI 新提问 / 分钟')).toHaveValue('1');
  await expect(page.getByText(/工具续接最多 8 次/)).toBeVisible();
  await page.getByLabel('每账号 AI 新提问 / 分钟').fill('4');
  await page.getByLabel('每设备 AI 新提问 / 分钟').fill('2');
  await page.getByRole('button', { name: '保存限额' }).click();
  await expect(page.getByRole('status').filter({ hasText: '请求限额已保存并审计' })).toBeVisible();
  expect(writes).toEqual([{ accountRpm: 4, deviceRpm: 2, publicIpRpm: 60, authIpRpm: 10 }]);
  await expect(page.getByLabel('每设备 AI 新提问 / 分钟')).toHaveValue('2');
});
