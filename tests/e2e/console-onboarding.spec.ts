import { expect, test } from '@playwright/test';

test('admin binds DeepSeek before creating a disabled model draft', async ({ page }) => {
  const providerId = '11111111-1111-4111-8111-111111111111';
  let enabled = false;
  let model: Record<string, unknown> | null = null;
  let binding = '';
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === `/api/v1/admin/providers/${providerId}` && method === 'PATCH') {
      const payload = route.request().postDataJSON() as { apiKey: string; enabled: boolean };
      binding = payload.apiKey; enabled = payload.enabled;
      return route.fulfill({ json: { enabled } });
    }
    if (path === '/api/v1/admin/models' && method === 'POST') {
      model = { ...(route.request().postDataJSON() as Record<string, unknown>), id: 'model-id' };
      return route.fulfill({ status: 201, json: model });
    }
    const replies: Record<string, unknown> = {
      '/api/v1/auth/me': { user: { email: 'admin@example.test', role: 'ADMIN' } },
      '/api/v1/admin/dashboard': {},
      '/api/v1/admin/insights': { periodDays: 30, requests: [], models: [] },
      '/api/v1/admin/system': { database: 'ok', gateway: 'ok' },
      '/api/v1/admin/site/page-views': { data: [] },
      '/api/v1/admin/models': { data: model ? [model] : [] },
      '/api/v1/admin/plans': { data: [] },
      '/api/v1/admin/model-access': { planAccess: [], overrides: [], subscription: null, effectiveModelIds: [] },
      '/api/v1/admin/providers': { data: [{ id: providerId, name: 'DeepSeek', code: 'DEEPSEEK', enabled }] },
      [`/api/v1/admin/providers/${providerId}/health`]: { ready: true },
    };
    if (!(path in replies)) return route.fulfill({ status: 500, body: `Unexpected ${method} ${path}` });
    return route.fulfill({ json: replies[path] });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: '模型管理' }).click();
  await page.getByRole('button', { name: '连接 / 认证 Provider' }).click();
  const dialog = page.getByRole('dialog', { name: '配置 DeepSeek' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('DeepSeek API Key').fill('test-key-not-real');
  await dialog.getByRole('button', { name: '绑定并检查连接' }).click();
  await expect(dialog.getByText('Provider 已配置并通过健康检查。')).toBeVisible();
  await dialog.getByRole('button', { name: '继续添加模型草稿' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel('Provider Model ID').fill('deepseek-chat');
  await page.getByLabel('公开 ID').fill('deepseek/chat');
  await page.getByLabel('显示名称').fill('DeepSeek Chat');
  await page.getByRole('button', { name: '创建模型草稿' }).click();
  expect(binding).toBe('test-key-not-real');
  expect(model).toMatchObject({ enabled: false, publicId: 'deepseek/chat' });
});

test('admin uploads installer as unpublished draft before publishing', async ({ page }) => {
  const releases: Array<Record<string, unknown>> = [];
  let uploaded = false;
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === '/api/v1/admin/releases/upload' && method === 'POST') {
      expect(route.request().headers()['x-release-version']).toBe('0.3.0');
      expect(route.request().postDataBuffer()?.subarray(0, 2).toString()).toBe('MZ');
      uploaded = true;
      releases.push({ id: 'release-id', version: '0.3.0', channel: 'stable', platform: 'windows', published: false, sha256: 'a'.repeat(64), downloadUrl: '/api/v1/releases/files/release-id' });
      return route.fulfill({ status: 201, json: releases[0] });
    }
    if (path === '/api/v1/admin/releases/release-id' && method === 'PATCH') {
      releases[0].published = true;
      return route.fulfill({ json: releases[0] });
    }
    const replies: Record<string, unknown> = {
      '/api/v1/auth/me': { user: { email: 'admin@example.test', role: 'ADMIN' } },
      '/api/v1/admin/dashboard': {},
      '/api/v1/admin/insights': { periodDays: 30, requests: [], models: [] },
      '/api/v1/admin/system': { database: 'ok', gateway: 'ok' },
      '/api/v1/admin/site/page-views': { data: [] },
      '/api/v1/admin/releases': { data: releases },
    };
    if (!(path in replies)) return route.fulfill({ status: 500, body: `Unexpected ${method} ${path}` });
    return route.fulfill({ json: replies[path] });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: '客户端版本' }).click();
  await page.getByLabel('版本', { exact: true }).fill('0.3.0');
  await page.getByLabel('安装包（.exe）').setInputFiles({ name: 'bridge.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ installer') });
  await page.getByRole('button', { name: '上传为草稿' }).click();
  await expect(page.getByText('安装包已上传并计算 SHA-256')).toBeVisible();
  expect(uploaded).toBe(true);
  await page.getByRole('button', { name: '管理', exact: true }).click();
  await page.getByRole('button', { name: '发布', exact: true }).click();
  await expect(page.getByRole('row', { name: /0.3.0/ }).getByText('是')).toBeVisible();
});
