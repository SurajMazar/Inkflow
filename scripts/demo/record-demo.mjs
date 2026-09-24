/* eslint-disable no-console */
// Records the Inkflow demo. Usage: node record.mjs <demoDir>
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const dir = process.argv[2];
const durations = JSON.parse(readFileSync(`${dir}/durations.json`, 'utf8'));
const BASE = 'http://localhost:5173';
const W = 1440,
  H = 900;
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: `${dir}/raw`, size: { width: W, height: H } },
});
await ctx.addInitScript(() => {
  Element.prototype.requestFullscreen = () => Promise.resolve();
});
const page = await ctx.newPage();
const t0 = Date.now();
const marks = {};
const sleep = (ms) => page.waitForTimeout(ms);
async function scene(key, fn) {
  const start = Date.now();
  marks[key] = (start - t0) / 1000;
  await fn();
  const need = (durations[key] + 0.7) * 1000 - (Date.now() - start);
  if (need > 0) await sleep(need);
}
async function drag(p, a, b, steps = 18) {
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move(b.x, b.y, { steps });
  await p.mouse.up();
}
const tool = (t) => page.getByTestId(`tool-${t}`).click();
const C = { x: W / 2, y: H / 2 };
const at = (dx, dy) => ({ x: C.x + dx, y: C.y + dy });
const selectType = (type) =>
  page.evaluate((t) => {
    const ed = window.__inkflow.editor;
    const el = ed.getElements().find((e) => e.type === t);
    ed.select([el.id]);
  }, type);
const editorReady = (p) =>
  p.waitForFunction(() => Boolean(window.__inkflow), null, { timeout: 30000 });

// Sign in before recording scenes (trimmed out later).
await page.goto(`${BASE}/login`);
await page.getByTestId('login-email').fill('demo@inkflow.dev');
await page.getByTestId('login-password').fill('inkflow-demo-2024');
await page.getByTestId('login-submit').click();
await page.waitForURL(/\/w\//);
await page.getByTestId('board-card').first().waitFor();
await sleep(800);
{
  await page.getByTestId('board-card').filter({ hasText: 'Platform architecture' }).first().click();
  await page.waitForFunction(() => Boolean(window.__inkflow));
  await page.evaluate(() => {
    const ed = window.__inkflow.editor;
    const n = ed.getElements().find((e) => e.label && e.label.text === 'API gateway');
    if (n && (n.x !== 300 || n.y !== 180))
      ed.updateElements([[n.id, { x: 300, y: 180 }]], 'Restore position');
  });
  await page
    .getByTestId('save-status')
    .and(page.locator('[data-state="saved"]'))
    .waitFor({ timeout: 20000 });
  await page.goto(`${BASE}/`);
  await page.getByTestId('board-card').first().waitFor();
  await sleep(800);
}
const trimStart = (Date.now() - t0) / 1000;

await scene('intro', async () => {
  await page.mouse.move(700, 300, { steps: 20 });
  await sleep(2500);
  await page.mouse.wheel(0, 500);
  await sleep(2500);
  await page.mouse.wheel(0, -500);
});

await scene('draw', async () => {
  await page.getByTestId('new-board').first().click();
  await page.getByTestId('new-board-title').fill('Product launch plan');
  await sleep(500);
  await page.getByTestId('new-board-submit').click();
  await page.waitForURL(/\/b\//);
  await editorReady(page);
  await sleep(600);
  await tool('rectangle');
  await drag(page, at(-420, -170), at(-240, -60));
  await tool('ellipse');
  await drag(page, at(-80, -170), at(90, -60));
  await tool('diamond');
  await drag(page, at(250, -180), at(420, -50));
});

await scene('style', async () => {
  await page.keyboard.press('Escape');
  await selectType('rectangle');
  await sleep(600);
  await page.getByTestId('background-color').locator('button').nth(2).click();
  await sleep(700);
  await page.getByTestId('fill-style-hachure').click();
  await sleep(700);
  await page.getByTestId('stroke-width-4').click();
  await sleep(700);
  await page.getByTestId('roughness-2').click();
  await sleep(700);
  await selectType('ellipse');
  await sleep(400);
  await page.getByTestId('background-color').locator('button').nth(4).click();
  await page.getByTestId('fill-style-solid').click();
  await page.getByTestId('stroke-style-dashed').click();
});

await scene('text', async () => {
  await page.keyboard.press('Escape');
  await tool('text');
  await page.mouse.click(C.x - 420, C.y + 40);
  await page.keyboard.type('Launch checklist', { delay: 55 });
  await page.keyboard.press('Escape');
  await tool('pencil');
  const pts = Array.from({ length: 30 }, (_, i) => at(-420 + i * 12, 130 + Math.sin(i / 3) * 22));
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts) await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.up();
});

await scene('connect', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.keyboard.press('c');
  await drag(page, at(-330, -115), at(5, -115), 22);
  await page.keyboard.press('c');
  await drag(page, at(5, -115), at(335, -115), 22);
  await page.keyboard.press('v');
  await sleep(400);
  await drag(page, at(5, -165), at(5, 30), 30);
  await sleep(900);
  await page.keyboard.press('Meta+z');
  await sleep(900);
  await page.keyboard.press('Meta+Shift+z');
});

await scene('library', async () => {
  await page.mouse.click(C.x + 500, C.y + 300);
  await page.getByTestId('open-library').click();
  await sleep(1500);
  await page.getByRole('tab', { name: /templates/i }).click();
  await sleep(1800);
  await page.getByTestId('template-insert').first().click();
  await sleep(700);
  await page.keyboard.press('Shift+1');
});

await scene('mermaid', async () => {
  await page.getByRole('tab', { name: /text|mermaid/i }).click();
  await page.mouse.move(C.x - 200, C.y);
  await page.mouse.wheel(0, 1100);
  await page
    .getByTestId('mermaid-input')
    .fill(
      'flowchart LR\n  A[Idea] --> B{Validated?}\n  B -->|yes| C[Build]\n  B -->|no| D[Research]\n  C --> E[Launch]',
    );
  await sleep(900);
  await page.getByTestId('mermaid-insert').click();
  await sleep(1200);
  await page.getByTestId('open-library').click();
  await page.getByTestId('canvas-container').focus();
  await page.keyboard.press('Alt+Shift+L');
  await sleep(1000);
  await page.getByTestId('autolayout-apply').click();
  await sleep(500);
  await page.keyboard.press('Shift+2');
});

// Share link for the collaborator (created through the UI).
await page.keyboard.press('Escape');
await page.keyboard.press('Shift+1');
await scene('collab', async () => {
  await page.getByTestId('share-button').click();
  await page.getByTestId('share-link-role').selectOption('EDITOR');
  await page.getByTestId('share-link-create').click();
  const url = await page.getByTestId('share-link-url').first().inputValue();
  await sleep(1200);
  await page.keyboard.press('Escape');
  const guestCtx = await browser.newContext({ viewport: { width: W, height: H } });
  const guest = await guestCtx.newPage();
  await guest.goto(`${BASE}${new URL(url).pathname}`);
  await editorReady(guest);
  await guest.waitForTimeout(800);
  // Guest cursor wanders, then draws a sticky-style rectangle with a label.
  await guest.mouse.move(300, 300);
  await guest.mouse.move(900, 650, { steps: 40 });
  await guest.getByTestId('tool-rectangle').click();
  await drag(guest, { x: 900, y: 650 }, { x: 1110, y: 760 }, 30);
  await guest.keyboard.press('Enter');
  await guest.keyboard.type('Ship it!', { delay: 90 });
  await guest.keyboard.press('Escape');
  await guest.mouse.move(700, 500, { steps: 40 });
  await guest.waitForTimeout(1500);
  globalThis.guestCtx = guestCtx;
});

await scene('comments', async () => {
  await globalThis.guestCtx.close();
  await tool('comment');
  await page.mouse.click(C.x + 250, C.y + 200);
  await page.getByTestId('comment-input').fill('Can we launch before the conference?');
  await sleep(500);
  await page.getByTestId('comment-submit').click();
});

await scene('versions', async () => {
  await page.keyboard.press('Escape');
  await page.getByTestId('board-menu').click();
  await page.getByTestId('menu-versions').click();
  await sleep(1500);
  await page.getByTestId('version-save').click();
  await sleep(1500);
});

await scene('export', async () => {
  await page.keyboard.press('Escape');
  await page.getByTestId('board-menu').click();
  await page.getByTestId('menu-export').click();
  await sleep(1400);
  await page.getByTestId('export-format-svg').click();
  await sleep(1400);
  await page.getByTestId('export-format-pdf').click();
  await sleep(1400);
  await page.getByTestId('export-format-png').click();
});

await scene('diagrams', async () => {
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}/`);
  await page.getByTestId('board-card').filter({ hasText: 'Platform architecture' }).first().click();
  await editorReady(page);
  await sleep(3500);
  await page.goBack();
  await page.getByTestId('board-card').filter({ hasText: 'Store database' }).first().click();
  await editorReady(page);
});

await scene('present', async () => {
  await page.goBack();
  await page.getByTestId('board-card').filter({ hasText: 'Platform architecture' }).first().click();
  await editorReady(page);
  await sleep(600);
  await page.getByTestId('present').click();
  await sleep(1800);
  await page.keyboard.press('l');
  await page.mouse.move(400, 400);
  await page.mouse.down();
  await page.mouse.move(900, 450, { steps: 25 });
  await page.mouse.up();
});

await scene('outro', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.keyboard.press('Alt+Shift+D');
});
await sleep(500);
const total = (Date.now() - t0) / 1000;
await page.keyboard.press('Alt+Shift+D');
const videoPath = await page.video().path();
await ctx.close();
await browser.close();
writeFileSync(`${dir}/marks.json`, JSON.stringify({ trimStart, total, marks, videoPath }, null, 1));
console.log({ trimStart, total, videoPath });
