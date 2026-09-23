/* eslint-disable no-console */
// Screenshot of the properties panel after changing options: `node e2e/panel-shot.mjs <out.png>`
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? 'panel.png';
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
await page.goto('http://localhost:5173/login');
await page.getByTestId('login-email').fill('demo@inkflow.dev');
await page.getByTestId('login-password').fill('inkflow-demo-2024');
await page.getByTestId('login-submit').click();
await page.waitForURL(/\/w\//);
await page.getByTestId('board-card').filter({ hasText: 'Launch brainstorm' }).first().click();
await page.waitForFunction(() => Boolean(window.__inkflow));
await page.waitForTimeout(800);
const id = await page.evaluate(() => {
  const ed = window.__inkflow.editor;
  const el = ed
    .getElements()
    .find((e) => e.type === 'ellipse' || e.type === 'rectangle' || e.type === 'node');
  ed.select([el.id]);
  return el.id;
});
await page.getByTestId('roughness-0').click();
await page.getByTestId('stroke-width-4').click();
await page.getByTestId('stroke-style-dashed').click();
await page.mouse.move(10, 450);
await page.waitForTimeout(400);
const state = await page.evaluate((i) => {
  const el = window.__inkflow.editor.getElement(i);
  return { roughness: el.roughness, strokeWidth: el.strokeWidth, strokeStyle: el.strokeStyle };
}, id);
const checked = await page.$$eval(
  '[data-testid^="roughness-"],[data-testid^="stroke-width-"],[data-testid^="stroke-style-"]',
  (els) =>
    els.map(
      (e) =>
        `${e.getAttribute('data-testid')}:${e.getAttribute('aria-checked')}:${e.getAttribute('data-state')}`,
    ),
);
console.log(JSON.stringify(state), checked.filter((c) => c.includes(':true')).join(' '));
await page.screenshot({ path: out, clip: { x: 1100, y: 40, width: 340, height: 860 } });
await browser.close();
