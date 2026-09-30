import { expect, test } from '@playwright/test';

test('registration accepts a prefilled or manually entered referral without awarding at signup', async ({ page }) => {
  const registrations: Record<string, unknown>[] = [];
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 401,
    json: { error: { code: 'UNAUTHORIZED' } } }));
  await page.route('**/api/v1/auth/registration-config', route => route.fulfill({ json: {
    verificationRequired: false, turnstileSiteKey: null, registrationAvailable: true, configurationStatus: 'MISSING_CONFIG',
  } }));
  await page.route('**/api/v1/auth/register', route => {
    registrations.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/register?ref=PRE-FILLED');
  await expect(page.getByLabel('邀请码（可选）')).toHaveValue('PRE-FILLED');
  await page.getByLabel('邀请码（可选）').fill('  MANUAL-CODE  ');
  await page.getByLabel('邮箱').fill('referred@example.test');
  await page.getByLabel('密码（至少 12 位）').fill('test-password-123');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(registrations).toEqual([{ email: 'referred@example.test', password: 'test-password-123', referralCode: 'MANUAL-CODE' }]);
});

test('registration explains duplicate email and optional invalid referral without blaming the password', async ({ page }) => {
  let failure = 'EMAIL_IN_USE';
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 401,
    json: { error: { code: 'UNAUTHORIZED' } } }));
  await page.route('**/api/v1/auth/registration-config', route => route.fulfill({ json: {
    verificationRequired: false, turnstileSiteKey: null, registrationAvailable: true, configurationStatus: 'MISSING_CONFIG',
  } }));
  await page.route('**/api/v1/auth/register', route => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    return failure ? route.fulfill({ status: failure === 'EMAIL_IN_USE' ? 409 : 404,
      contentType: 'application/json', body: JSON.stringify({ error: { code: failure, message: failure } }) })
      : route.fulfill({ status: 201, contentType: 'application/json', body: '{"user":{}}' });
  });
  await page.goto('/register');
  await page.getByLabel('邮箱').fill('already@example.test');
  await page.getByLabel('密码（至少 12 位）').fill('test-password-123');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.locator('.auth-card .error-text[role="alert"]')).toContainText('这个邮箱已经注册');
  failure = 'INVALID_REFERRAL_CODE';
  await page.getByLabel('邮箱').fill('new@example.test');
  await page.getByLabel('邀请码（可选）').fill('INVALIDCODE');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.locator('.auth-card .error-text[role="alert"]')).toContainText('没有邀请码也可以留空注册');
  failure = '';
  await page.getByLabel('邀请码（可选）').fill('');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(requests.map(request => request.referralCode)).toEqual([undefined, 'INVALIDCODE', undefined]);
});

test('usage pricing does not present legacy monthly charges or test QR as a payment method', async ({ page }) => {
  const apiRequests: string[] = [];
  const plans = [{ id: 'test-plan', code: 'TEST', name: '测试套餐', description: '仅供测试', monthlyPrice: '10',
    maxDevices: 1, monthlyPoints: 100, monthlyTokenLimit: 99999, monthlyUsageCreditLimit: '999',
    maxConcurrentRequests: 1, requestsPerMinute: 5 }];
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    apiRequests.push(`${route.request().method()} ${path}`);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(path === '/api/v1/plans' ? { data: plans } : {}) });
  });
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { name: '按实际使用量计费。' })).toBeVisible();
  await expect(page.locator('.pricing-price')).toContainText('按量计费');
  await expect(page.getByText('¥10')).toHaveCount(0);
  await expect(page.getByRole('img', { name: /测试占位二维码/ })).toHaveCount(0);
  await expect(page.getByText('Tokens')).toHaveCount(0);
  expect(apiRequests.length).toBeGreaterThan(0);
  expect(apiRequests.every(request => ['GET /api/v1/plans', 'GET /api/v1/auth/me', 'POST /api/v1/site/page-view'].includes(request))).toBe(true);
});

test('admin sees server effective models and refreshed plan ACL and user overrides', async ({ page }) => {
  const plan = '11111111-1111-4111-8111-111111111111';
  const model = '22222222-2222-4222-8222-222222222222';
  const user = '33333333-3333-4333-8333-333333333333';
  const provider = '44444444-4444-4444-8444-444444444444';
  let planAllowed = false;
  let override = 'DEFAULT';
  const writes: string[] = [];
  await page.route('**/api/v1/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'PUT') {
      writes.push(path);
      const payload = request.postDataJSON() as { allowed?: boolean; access?: string };
      if (path === `/api/v1/admin/models/${model}/plans/${plan}`) planAllowed = payload.allowed ?? false;
      else if (path === `/api/v1/admin/users/${user}/models/${model}`) override = payload.access ?? 'DEFAULT';
      else return route.fulfill({ status: 500, body: 'Unexpected write' });
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    }
    const bodies: Record<string, unknown> = {
      '/api/v1/auth/me': { user: { email: 'admin@example.test', role: 'ADMIN' } },
      '/api/v1/admin/dashboard': {},
      '/api/v1/admin/models': { data: [{ id: model, publicId: 'mock-model', displayName: 'Mock Model', providerId: provider, enabled: true, usageWeight: 1 }] },
      '/api/v1/admin/providers': { data: [{ id: provider, code: 'MOCK', name: 'Mock Provider', enabled: true }] },
      '/api/v1/admin/plans': { data: [{ id: plan, code: 'TEST', name: 'Test Plan', enabled: true }] },
      '/api/v1/admin/users': { data: [{ id: user, email: 'user@example.test', role: 'USER', status: 'ACTIVE' }] },
      '/api/v1/admin/model-access': {
        planAccess: planAllowed ? [{ planId: plan, modelId: model }] : [],
        overrides: new URL(request.url()).searchParams.has('userId') && override !== 'DEFAULT' ? [{ modelId: model, access: override }] : [],
        subscription: new URL(request.url()).searchParams.has('userId') ? { planId: plan, planCode: 'TEST', status: 'ACTIVE' } : null,
        effectiveModelIds: new URL(request.url()).searchParams.has('userId') && (override === 'ALLOW' || (planAllowed && override !== 'DENY')) ? [model] : [],
      },
    };
    if (!(path in bodies)) return route.fulfill({ status: 500, body: `Unexpected API: ${path}` });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(bodies[path]) });
  });

  await page.goto('/admin');
  await page.getByRole('button', { name: '模型管理' }).click();
  await page.getByRole('button', { name: '管理', exact: true }).click();
  await expect(page.getByText('Test Plan（启用）：未开放')).toBeVisible();
  await page.getByRole('button', { name: '开放', exact: true }).click();
  await expect(page.getByText('Test Plan（启用）：已开放')).toBeVisible();
  await page.getByRole('button', { name: '用户管理' }).click();
  await page.getByRole('button', { name: '管理', exact: true }).click();
  await expect(page.getByText('当前账号可用')).toBeVisible();
  const overrideSelect = page.getByRole('combobox', { name: 'mock-model 用户覆盖' });
  await overrideSelect.selectOption('DENY');
  await expect(page.getByText('用户特例拒绝')).toBeVisible();
  await expect(overrideSelect).toHaveValue('DENY');
  await overrideSelect.selectOption('DEFAULT');
  await expect(page.getByText('当前账号可用')).toBeVisible();
  expect(writes).toEqual([`/api/v1/admin/models/${model}/plans/${plan}`, `/api/v1/admin/users/${user}/models/${model}`, `/api/v1/admin/users/${user}/models/${model}`]);
});
