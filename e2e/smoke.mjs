/* eslint-disable no-console */
// Visual smoke check against the dev stack: `node e2e/smoke.mjs <outDir>`
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
await page.goto('http://localhost:5173/login');
await page.getByTestId('login-email').fill('demo@inkflow.dev');
await page.getByTestId('login-password').fill('inkflow-demo-2024');
await page.getByTestId('login-submit').click();
await page.waitForURL(/\/w\//, { timeout: 20000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/dashboard.png` });
const cards = page.getByTestId('board-card');
console.log('board cards:', await cards.count());
const titles = process.argv.slice(3);
for (const title of titles.length ? titles : ['Platform architecture']) {
  await page.goto(page.url().replace(/\/b\/.*/, ''));
  await page.getByTestId('board-card').filter({ hasText: title }).first().click();
  await page.waitForURL(/\/b\//);
  await page.waitForFunction(() => Boolean(window.__inkflow), null, { timeout: 20000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/${title.replace(/\W+/g, '-')}.png` });
  console.log(
    title,
    'elements:',
    await page.evaluate(() => window.__inkflow.editor.getElements().length),
  );
  await page.goBack();
}
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
