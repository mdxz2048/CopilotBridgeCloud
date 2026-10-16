import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.env.HOMEPAGE_BASE_URL ?? 'http://127.0.0.1:3128';
const output = process.env.HOMEPAGE_EVIDENCE_DIR;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [];
const errors = [];
const index = page => page.locator('.shot-dot[aria-current="true"]').evaluate(button => [...button.parentElement.children].indexOf(button));
async function fixture(context) {
  // Avoid recording synthetic QA page views or depending on a private account.
  await context.route('**/api/v1/site/page-view', route => route.fulfill({ status: 204 }));
  await context.route('**/api/v1/auth/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: '请登录' } }) }));
}
try {
  if (output) await mkdir(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await fixture(context);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  assert.equal((await page.goto(base)).status(), 200);
  await page.getByRole('link', { name: '登录', exact: true }).waitFor();
  assert.equal(await page.locator('.homepage h1').innerText(), '一句话，\n把想法变成成果。');
  assert.equal(await page.locator('.modelSection,.model-section').count(), 0);
  assert.equal(await page.locator('.screenshot-slide:not([hidden])').count(), 1);
  assert.equal(await page.locator('.shot-dot').count(), 3);
  assert.equal(await page.locator('.design-ribbon').count(), 0);
  assert.equal(await page.locator('.site-header a[href="/#examples"]').count(), 1);
  await page.getByRole('button', { name: '暂停自动播放', exact: true }).waitFor();
  await page.clock.runFor(6600);
  assert.equal(await index(page), 1);
  await page.clock.runFor(6600);
  assert.equal(await index(page), 2);
  checks.push('Production SSR, hydration, single visible screenshot and automatic 0 → 1 → 2 playback');
  await page.getByRole('button', { name: '下一张截图' }).click();
  assert.equal(await index(page), 0);
  await page.getByRole('button', { name: '上一张截图' }).click();
  assert.equal(await index(page), 2);
  await page.getByRole('button', { name: '第 2 张：阅读摘要' }).click();
  assert.equal(await index(page), 1);
  await page.keyboard.press('Home'); assert.equal(await index(page), 0);
  await page.keyboard.press('End'); assert.equal(await index(page), 2);
  await page.keyboard.press('ArrowLeft'); assert.equal(await index(page), 1);
  await page.clock.runFor(14000); assert.equal(await index(page), 1);
  checks.push('Arrows wrap, dots select, Home / End / arrows work; focused controls pause autoplay');
  await page.locator('.site-header .brand').focus();
  await page.locator('.screenshot-viewport').hover();
  await page.clock.runFor(14000); assert.equal(await index(page), 1);
  await page.getByRole('button', { name: '暂停自动播放', exact: true }).click();
  await page.mouse.move(1, 1); await page.locator('.site-header .brand').focus();
  await page.clock.runFor(14000); assert.equal(await index(page), 1);
  await page.getByRole('button', { name: '开始自动播放', exact: true }).click();
  await page.mouse.move(1, 1); await page.locator('.site-header .brand').focus();
  await page.clock.runFor(6600); assert.equal(await index(page), 2);
  await page.getByRole('button', { name: '暂停自动播放', exact: true }).click();
  checks.push('Hover pauses, manual pause persists, explicit resume restarts autoplay');
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: '第 1 张：屏幕检测工具' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.screenshot-slide img')].every(img => img.complete && img.naturalWidth > 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow at ' + width);
    const img = page.locator('.screenshot-slide:not([hidden]) img');
    assert.equal(await img.evaluate(image => image.naturalWidth), width <= 760 ? 780 : 2400);
    assert.equal(await page.locator('.shot-dot').first().evaluate(button => getComputedStyle(button).height), '7px');
    if (output && [1440, 390].includes(width)) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${output}/homepage-${width}.png`, fullPage: true });
      await page.locator('.screenshot-carousel').screenshot({ path: `${output}/homepage-carousel-${width}.png`, style: '.site-header{visibility:hidden}' });
    }
  }
  checks.push('1440 / 1024 / 768 / 390 / 320: no horizontal overflow, correct desktop/mobile image source, three round dots');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('link', { name: '常见问题', exact: true }).click();
  await page.locator('.faq summary').first().click();
  assert.equal(await page.locator('.faq details').first().getAttribute('open'), '');
  await page.locator('.hero-actions a[href="/download"]').click();
  await page.waitForURL('**/download');
  assert.equal(await page.locator('.homepage').count(), 0);
  assert.equal(await page.locator('.site-header a[href="/pricing"]').count(), 1);
  checks.push('FAQ expands, download navigation and shared header work, homepage CSS stays scoped');
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await fixture(mobile);
  const touchPage = await mobile.newPage();
  touchPage.on('pageerror', error => errors.push(error.message));
  await touchPage.clock.install();
  await touchPage.goto(base);
  await touchPage.getByRole('button', { name: '开始自动播放', exact: true }).waitFor();
  await touchPage.clock.runFor(20000); assert.equal(await index(touchPage), 0);
  await touchPage.locator('.screenshot-viewport').scrollIntoViewIfNeeded();
  const box = await touchPage.locator('.screenshot-viewport').boundingBox();
  const cdp = await mobile.newCDPSession(touchPage);
  const y = Math.max(120, box.y + 160);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width - 30, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 30, y: y + 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await index(touchPage), 1);
  checks.push('Reduced motion defaults to paused; native mobile touch swipe switches screenshot');
  await mobile.close();

  const signedIn = await browser.newContext({ viewport: { width: 320, height: 844 } });
  await fixture(signedIn);
  await signedIn.route('**/api/v1/auth/me', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: { email: 'homepage-preview@example.test', role: 'USER' } }) }));
  const account = await signedIn.newPage(); await account.goto(base);
  await account.getByRole('link', { name: '账号中心：homepage-preview@example.test' }).waitFor();
  assert.equal(await account.getByRole('link', { name: '账号中心：homepage-preview@example.test' }).getAttribute('href'), '/dashboard');
  assert.ok(await account.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  checks.push('Existing signed-in header / user centre retained, including 320px layout (synthetic identity)');
  await signedIn.close();
  assert.deepEqual(errors, []);
  const report = { date: '2026-10-17', base, checks, rendererErrors: errors, syntheticIdentity: true, syntheticPageViewsSuppressed: true, realModelCalls: 0 };
  if (output) await writeFile(`${output}/homepage-review.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
