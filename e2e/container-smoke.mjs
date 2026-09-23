/* eslint-disable no-console */
// Smoke test of the containerized stack: `node e2e/container-smoke.mjs [baseUrl] [screenshot]`
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://localhost:8190';
const shot = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/login`);
await page.getByTestId('login-email').fill('demo@inkflow.dev');
await page.getByTestId('login-password').fill('inkflow-demo-2024');
await page.getByTestId('login-submit').click();
await page.waitForURL(/\/w\//, { timeout: 20000 });
console.log('dashboard boards:', await page.getByTestId('board-card').count());
await page.getByTestId('board-card').filter({ hasText: 'Platform architecture' }).first().click();
await page.waitForURL(/\/b\//);
await page.getByTestId('interactive-canvas').waitFor();
await page.waitForTimeout(1500);
const box = await page.getByTestId('interactive-canvas').boundingBox();
await page.getByTestId('tool-rectangle').click();
await page.mouse.move(box.x + 700, box.y + 820);
await page.mouse.down();
await page.mouse.move(box.x + 820, box.y + 870, { steps: 6 });
await page.mouse.up();
await page
  .getByTestId('save-status')
  .and(page.locator('[data-state="saved"]'))
  .waitFor({ timeout: 20000 });
const status = await page.getByTestId('save-status').textContent();
await page.reload();
await page.getByTestId('interactive-canvas').waitFor();
await page.waitForTimeout(1500);
if (shot) await page.screenshot({ path: shot });
const wsOk = await page.evaluate(async () => {
  const r = await fetch('/api/health/ready');
  return r.ok;
});
console.log(
  'save status:',
  status,
  '| api via nginx:',
  wsOk,
  '| page errors:',
  errors.length ? errors : 'none',
);
await browser.close();
