import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

test('public pages, navigation and responsive layout', async ({ page }) => {
  mkdirSync('artifacts/screenshots', { recursive: true });
  for (const width of [375, 768, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /让桌面工作/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `Homepage overflows at ${width}px`).toBe(false);
    await page.screenshot({ path: `artifacts/screenshots/home-${width}.png`, fullPage: true });
  }
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { name: /选择适合/ })).toBeVisible();
  await page.goto('/download');
  await expect(page.getByRole('heading', { name: /把 Agent/ })).toBeVisible();
  await page.goto('/login');
  await expect(page.getByLabel('邮箱')).toBeVisible();
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: /创建你的账号/ })).toBeVisible();
});
