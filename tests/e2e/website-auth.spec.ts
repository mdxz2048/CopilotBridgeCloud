import { expect, test, type Page } from '@playwright/test';

const capabilities = { verificationRequired: true, registrationAvailable: true, turnstileSiteKey: 'test-public-site-key', configurationStatus: 'READY' };

async function mockCaptcha(page: Page) {
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js**', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.turnstile = {
      widgets: new Map(),
      render(element, options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '完成测试人机验证';
        button.onclick = () => options.callback('test-captcha-token');
        element.appendChild(button);
        const id = 'widget-' + Math.random();
        this.widgets.set(id, button);
        return id;
      },
      remove(id) { this.widgets.get(id)?.remove(); this.widgets.delete(id); }
    };`,
  }));
}

test('public pages show the current account and only ADMIN sees the management link', async ({ page }) => {
  let role: 'USER' | 'ADMIN' = 'USER';
  let hold = false;
  const releases: (() => void)[] = [];
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') {
      if (hold) await new Promise<void>(resolve => { releases.push(resolve); });
      return route.fulfill({ json: { user: { email: 'user@example.test', role } } });
    }
    if (path === '/api/v1/auth/registration-config') return route.fulfill({ json: { ...capabilities, verificationRequired: false, turnstileSiteKey: null, configurationStatus: 'DISABLED' } });
    if (path === '/api/v1/plans') return route.fulfill({ json: { data: [] } });
    if (path === '/api/v1/releases/latest') return route.fulfill({ json: { release: null } });
    return route.fulfill({ status: 404 });
  });
  hold = true;
  for (const path of ['/', '/pricing', '/download']) {
    await page.goto(path);
    if (hold) {
      await expect(page.locator('.site-header').getByRole('status')).toBeVisible();
      await expect(page.locator('.site-header').getByRole('link', { name: '登录', exact: true })).toHaveCount(0);
      await expect.poll(() => releases.length).toBeGreaterThan(0);
      hold = false;
      releases.splice(0).forEach(resolve => resolve());
    }
    await expect(page.getByRole('link', { name: '账号中心：user@example.test' })).toBeVisible();
    await expect(page.locator('.site-header').getByRole('link', { name: '管理后台' })).toHaveCount(0);
  }
  role = 'ADMIN';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.site-header').getByRole('link', { name: '管理后台' })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('.site-header').getByRole('link', { name: '管理后台' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('bridge:logout')));
  await expect(page.locator('.site-header').getByRole('link', { name: '开始使用' })).toBeVisible();
});

test('stalled identity checks time out and an older response cannot replace a newer focus result', async ({ page }) => {
  let slow = true;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') {
      if (slow) await new Promise(resolve => setTimeout(resolve, 6500));
      return route.fulfill({ json: { user: { id: 'user-id', email: 'user@example.test', role: 'USER' } } }).catch(() => {});
    }
    if (path === '/api/v1/auth/registration-config')
      return route.fulfill({ json: { verificationRequired: false, registrationAvailable: true, turnstileSiteKey: null, configurationStatus: 'MISSING_CONFIG' } });
    return route.fulfill({ status: 404 });
  });
  await page.goto('/');
  await expect(page.locator('.site-header').getByRole('status')).toBeVisible();
  await expect(page.locator('.site-header').getByRole('link', { name: '登录' })).toBeVisible({ timeout: 8000 });
  slow = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('link', { name: '账号中心：user@example.test' })).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(page.locator('.site-header').getByRole('link', { name: '登录' })).toHaveCount(0);

  slow = true;
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: '登录你的账号' })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('暂时无法确认登录状态；你仍可尝试登录')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: '创建你的账号' })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('暂时无法确认登录状态；你仍可尝试注册')).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
});

test('transient identity failures keep a confirmed account, but 401 clears it', async ({ page }) => {
  let status = 200;
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') return route.fulfill(status === 200
      ? { json: { user: { email: 'user@example.test', role: 'USER' } } }
      : { status, json: { error: { code: status === 401 ? 'UNAUTHORIZED' : 'SERVICE_UNAVAILABLE' } } });
    if (path === '/api/v1/plans') return route.fulfill({ json: { data: [] } });
    return route.fulfill({ status: 404 });
  });
  await page.goto('/pricing');
  const account = page.locator('.site-header').getByRole('link', { name: '账号中心：user@example.test' });
  await expect(account).toBeVisible();
  status = 503;
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/api/v1/auth/me') && response.status() === 503),
    page.evaluate(() => window.dispatchEvent(new Event('focus'))),
  ]);
  await expect(account).toBeVisible();
  await expect(page.locator('.site-header').getByRole('link', { name: '登录' })).toHaveCount(0);
  status = 401;
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/api/v1/auth/me') && response.status() === 401),
    page.evaluate(() => window.dispatchEvent(new Event('focus'))),
  ]);
  await expect(account).toHaveCount(0);
  await expect(page.locator('.site-header').getByRole('link', { name: '登录' })).toBeVisible();
});

test('registration requests code with captcha, reports code errors, and supports resend', async ({ page }) => {
  await mockCaptcha(page);
  let sends = 0;
  let registers = 0;
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED' } } });
    if (path === '/api/v1/auth/registration-config') return route.fulfill({ json: capabilities });
    if (path === '/api/v1/auth/email-code') {
      const body = route.request().postDataJSON();
      expect(body).toEqual({ email: 'new@example.test', turnstileToken: 'test-captcha-token' });
      sends++;
      return route.fulfill({ status: 202, json: { accepted: true } });
    }
    if (path === '/api/v1/auth/register') {
      expect(route.request().postDataJSON()).toMatchObject({ email: 'new@example.test', emailCode: '123456', referralCode: 'REF12345' });
      registers++;
      return route.fulfill({ status: 400, json: { error: { code: 'EMAIL_CODE_INVALID' } } });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto('/register?ref=REF12345');
  await expect(page.getByText('注册时会发送验证码确认邮箱。', { exact: false })).toBeVisible();
  await page.getByLabel('邮箱', { exact: true }).fill('new@example.test');
  await page.getByLabel('密码（至少 12 位）').fill('LongTestPassword123');
  await expect(page.getByLabel('邀请码（可选）')).toHaveValue('REF12345');
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('请先完成人机验证')).toBeVisible();
  await page.getByRole('button', { name: '完成测试人机验证' }).click();
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByLabel('邮箱验证码')).toBeVisible();
  await expect(page.getByRole('status').getByText('如该邮箱可注册，验证码已发送；已有账号可直接登录。')).toBeVisible();
  expect(sends).toBe(1);
  await page.getByLabel('邮箱验证码').fill('123456');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.getByText('验证码错误、已过期或已使用')).toBeVisible();
  expect(registers).toBe(1);
  await expect(page.getByRole('button', { name: '重新发送验证码' })).toBeDisabled();
  await page.clock.install();
  await page.clock.fastForward(61_000);
  await page.getByRole('button', { name: '完成测试人机验证' }).click();
  await page.getByRole('button', { name: '重新发送验证码' }).click();
  expect(sends).toBe(2);
});

test('authenticated visitors skip login and register forms; 401 visitors stay on them', async ({ page }) => {
  let authenticated = true;
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') return route.fulfill(authenticated
      ? { json: { user: { id: 'user-id', email: 'user@example.test', role: 'USER' } } }
      : { status: 401, json: { error: { code: 'UNAUTHORIZED' } } });
    if (path === '/api/v1/auth/registration-config')
      return route.fulfill({ json: { verificationRequired: false, registrationAvailable: true, turnstileSiteKey: null, configurationStatus: 'DISABLED' } });
    if (path === '/api/v1/account') return route.fulfill({ json: {
      user: { id: 'user-id', email: 'user@example.test', role: 'USER', status: 'ACTIVE' },
      subscription: null, plan: null, devices: [], usage: null,
    } });
    if (path === '/api/v1/me/wallet') return route.fulfill({ json: { balance: 0 } });
    if (path === '/api/v1/me/usage') return route.fulfill({ json: { requests: 0, pointsCharged: 0 } });
    if (path === '/api/v1/models') return route.fulfill({ json: { data: [] } });
    return route.fulfill({ status: 404 });
  });
  for (const path of ['/login', '/register']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('navigation', { name: '用户中心导航' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /登录你的账号|创建你的账号/ })).toHaveCount(0);
  }
  authenticated = false;
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: '登录你的账号' })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: '创建你的账号' })).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
});

test('login rejects invalid captcha and absent verification configuration blocks both forms', async ({ page }) => {
  await mockCaptcha(page);
  let loginCalls = 0;
  let misconfigured = false;
  let unavailableResponse = false;
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED' } } });
    if (path === '/api/v1/auth/registration-config') {
      if (unavailableResponse) return route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE' } } });
      return route.fulfill({ json: misconfigured ? { ...capabilities, configurationStatus: 'MISSING_CONFIG', turnstileSiteKey: null } : capabilities });
    }
    if (path === '/api/v1/auth/login') {
      loginCalls++;
      expect(route.request().postDataJSON().turnstileToken).toBe('test-captcha-token');
      return route.fulfill({ status: 403, json: { error: { code: 'TURNSTILE_INVALID' } } });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto('/login');
  await page.getByLabel('邮箱').fill('user@example.test');
  await page.getByLabel('密码').fill('LongTestPassword123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByText('请先完成人机验证后再登录。')).toBeVisible();
  expect(loginCalls).toBe(0);
  await page.getByRole('button', { name: '完成测试人机验证' }).click();
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByText('人机验证失败，请重新完成验证后再试。')).toBeVisible();
  expect(loginCalls).toBe(1);
  misconfigured = true;
  await page.goto('/register');
  await expect(page.getByText('注册验证暂不可用')).toBeVisible();
  await expect(page.getByRole('button', { name: '发送验证码' })).toHaveCount(0);
  await page.goto('/login');
  await expect(page.getByText('登录验证暂不可用')).toBeVisible();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled();
  unavailableResponse = true;
  await page.goto('/register');
  await expect(page.getByText('注册验证暂不可用')).toBeVisible();
  await page.goto('/login');
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled();
});

test('disabled verification keeps legacy register and login requests unchanged', async ({ page }) => {
  const calls: { path: string; body: Record<string, string> }[] = [];
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED' } } });
    if (path === '/api/v1/auth/registration-config')
      return route.fulfill({ json: { verificationRequired: false, registrationAvailable: true, turnstileSiteKey: null, configurationStatus: 'MISSING_CONFIG' } });
    if (path === '/api/v1/auth/register' || path === '/api/v1/auth/login') {
      calls.push({ path, body: route.request().postDataJSON() });
      return route.fulfill({ status: 400, json: { error: { code: 'VALIDATION_ERROR', message: 'test' } } });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto('/register');
  await expect(page.getByText('当前未启用邮箱验证码，注册不代表邮箱已核验。', { exact: false })).toBeVisible();
  await page.getByLabel('邮箱', { exact: true }).fill('legacy@example.test');
  await page.getByLabel('密码（至少 12 位）').fill('LongTestPassword123');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.getByText('邮箱、密码、验证码或邀请码格式不正确')).toBeVisible();
  await page.goto('/login');
  await page.getByLabel('邮箱').fill('legacy@example.test');
  await page.getByLabel('密码').fill('LongTestPassword123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByText('test', { exact: true })).toBeVisible();
  expect(calls).toEqual([
    { path: '/api/v1/auth/register', body: { email: 'legacy@example.test', password: 'LongTestPassword123' } },
    { path: '/api/v1/auth/login', body: { email: 'legacy@example.test', password: 'LongTestPassword123' } },
  ]);
});
