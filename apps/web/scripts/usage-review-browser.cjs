// Run against a local web dev server. Every API request is intercepted; no production mutation.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const userId = '11111111-1111-4111-8111-111111111111';
    let reviewed = false, writes = 0, fail = true;
    const event = { id: 'event-current', userId, requestId: 'request-known', billingStatus: 'METERING_ERROR', pointsCharged: 0, createdAt: '2026-10-11T01:00:00Z' };
    await page.route('**/api/v1/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      let body;
      if (path === '/api/v1/auth/me') body = { user: { role: 'ADMIN', email: 'admin@example.test' } };
      else if (path === '/api/v1/admin/dashboard') body = {};
      else if (path === '/api/v1/admin/users') body = { data: [{ id: userId, email: 'review@example.test', role: 'USER', status: 'ACTIVE', createdAt: event.createdAt }] };
      else if (path === `/api/v1/admin/users/${userId}`) body = { user: { email: 'review@example.test', status: 'ACTIVE', role: 'USER' }, usage: null, recentUsage: [], limits: { accountRpm: 10, deviceRpm: 10 }, devices: [], subscriptions: [] };
      else if (path.endsWith('/finance')) body = { wallet: { balance: 500000 }, transactions: [] };
      else if (path.endsWith('/activity')) body = { inviteCount: 0, invited: [], referredBy: null, orders: [] };
      else if (path === '/api/v1/admin/model-access') body = { overrides: [], planAccess: [], subscription: null, effectiveModelIds: [] };
      else if (['/api/v1/admin/models', '/api/v1/admin/providers', '/api/v1/admin/money-plans', '/api/v1/admin/model-instances', '/api/v1/admin/plans'].includes(path)) body = { data: [] };
      else if (path === '/api/v1/admin/usage-events/review') {
        assert.equal(url.searchParams.get('userId'), userId);
        body = { data: reviewed ? [] : [event, { ...event, id: 'event-other', userId: 'other-user', requestId: 'never-visible' }] };
      } else if (path === '/api/v1/admin/usage-events/event-current/review') {
        assert.equal(request.method(), 'POST');
        assert.deepEqual(request.postDataJSON(), { resolution: 'platform_waived', reason: '核对取消请求，平台承担未知成本' });
        writes++;
        if (fail) { fail = false; return route.fulfill({ status: 503, json: { error: { message: '审核暂时不可用', requestId: 'review-error-id' } } }); }
        reviewed = true; body = { alreadyReviewed: false, review: { supplierCostKnown: false } };
      } else throw new Error(`Unexpected API: ${path}`);
      return route.fulfill({ json: body });
    });
    page.on('dialog', dialog => { assert.match(dialog.message(), /不退款、不修改已知用量或账本/); void dialog.accept(); });
    await page.goto(process.env.WEB_TEST_URL || 'http://127.0.0.1:3013/admin');
    await page.getByRole('button', { name: '用户与权限', exact: true }).click();
    await page.getByRole('button', { name: '管理', exact: true }).click();
    const panel = page.getByRole('region', { name: '待计费审核' });
    await panel.getByText('request-known', { exact: true }).waitFor();
    assert.equal(await page.getByText('never-visible', { exact: true }).count(), 0);
    await panel.getByRole('button', { name: '审核此事件' }).click();
    const submit = panel.getByRole('button', { name: '平台承担并解除限制', exact: true });
    assert.equal(await submit.isDisabled(), true);
    await panel.getByLabel('审核原因（必填，最多 500 字）').fill('   ');
    assert.equal(await submit.isDisabled(), true);
    await panel.getByLabel('审核原因（必填，最多 500 字）').fill('核对取消请求，平台承担未知成本');
    await submit.click();
    await panel.getByRole('alert').filter({ hasText: 'review-error-id' }).waitFor();
    assert.equal(await panel.getByLabel('审核原因（必填，最多 500 字）').inputValue(), '核对取消请求，平台承担未知成本');
    await submit.click();
    await panel.getByText('此用户没有待审核事件。', { exact: true }).waitFor();
    assert.equal(writes, 2);
    if (process.env.WEB_TEST_SCREENSHOT) await page.screenshot({ path: process.env.WEB_TEST_SCREENSHOT, fullPage: true });
    console.log('PASS: scoped user, hidden foreign event, mandatory reason, confirmation, retry with requestId, success refresh');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
