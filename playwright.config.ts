import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', timeout: 30000, workers: 1,
  use: { baseURL: process.env.PROD_BASE_URL ?? 'http://127.0.0.1:3000', ...devices['Desktop Chrome'], channel: 'chrome' },
  webServer: process.env.PROD_BASE_URL ? undefined : { command: 'pnpm --filter @bridge/web dev', url: 'http://127.0.0.1:3000', reuseExistingServer: true, timeout: 120000 },
});
