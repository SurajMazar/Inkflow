import { defineConfig, devices } from '@playwright/test';
import { E2E, WEB_URL } from './env';

const apiEnv = {
  NODE_ENV: 'test',
  PORT: String(E2E.apiPort),
  DATABASE_URL: E2E.databaseUrl,
  WEB_ORIGIN: WEB_URL,
  PUBLIC_API_URL: `${WEB_URL}/api`,
  RATE_LIMIT_MAX: '100000',
  AUTH_RATE_LIMIT_MAX: '100000',
  REQUIRE_EMAIL_VERIFICATION: 'true',
  LOG_LEVEL: 'warn',
};

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './global-setup.ts',
  outputDir: './test-results',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      cwd: '..',
      url: `http://localhost:${E2E.apiPort}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: apiEnv,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `pnpm --filter @inkflow/web exec vite --port ${E2E.webPort} --strictPort`,
      cwd: '..',
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { INKFLOW_API_URL: `http://localhost:${E2E.apiPort}`, VITE_E2E: '1' },
    },
  ],
});
