import { expect, test, type Page } from '@playwright/test';
import { createBoard, createWorkspace, registerAndVerify, sceneElements, uniqueUser } from '../helpers';

/** Dispatches a touch-pointer drag on the canvas (Playwright's touchscreen only supports taps). */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.evaluate(
    ({ from, to }) => {
      const el = document.querySelector('[data-testid="interactive-canvas"]')!;
      const fire = (type: string, x: number, y: number) =>
        el.dispatchEvent(
          new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5 }),
        );
      fire('pointerdown', from.x, from.y);
      for (let i = 1; i <= 10; i++) fire('pointermove', from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
      fire('pointerup', to.x, to.y);
    },
    { from, to },
  );
}

async function pinch(page: Page, center: { x: number; y: number }, fromGap: number, toGap: number) {
  await page.evaluate(
    ({ center, fromGap, toGap }) => {
      const el = document.querySelector('[data-testid="interactive-canvas"]')!;
      const fire = (type: string, id: number, x: number, y: number) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 21, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
      fire('pointerdown', 21, center.x - fromGap / 2, center.y);
      fire('pointerdown', 22, center.x + fromGap / 2, center.y);
      for (let i = 1; i <= 10; i++) {
        const gap = fromGap + ((toGap - fromGap) * i) / 10;
        fire('pointermove', 21, center.x - gap / 2, center.y);
        fire('pointermove', 22, center.x + gap / 2, center.y);
      }
      fire('pointerup', 21, center.x - toGap / 2, center.y);
      fire('pointerup', 22, center.x + toGap / 2, center.y);
    },
    { center, fromGap, toGap },
  );
}

test('touch drawing, pinch zoom and the mobile toolbar', async ({ page }) => {
  test.setTimeout(150_000);
  await registerAndVerify(page, uniqueUser('mobile'));
  await createWorkspace(page, 'Phone');
  await createBoard(page, 'Touch board');
  const box = (await page.getByTestId('interactive-canvas').boundingBox())!;
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.getByTestId('tool-rectangle').tap();
  await touchDrag(page, { x: c.x - 80, y: c.y - 80 }, { x: c.x + 60, y: c.y });
  await expect.poll(async () => (await sceneElements(page)).length).toBe(1);

  await page.getByTestId('tool-pencil').tap();
  await touchDrag(page, { x: c.x - 60, y: c.y + 60 }, { x: c.x + 80, y: c.y + 120 });
  await expect.poll(async () => (await sceneElements(page)).map((e) => e.type)).toContain('freedraw');

  const zoomBefore = await page.evaluate(() => (window as unknown as { __inkflow: { editor: { state: { viewport: { zoom: number } } } } }).__inkflow.editor.state.viewport.zoom);
  await pinch(page, c, 80, 240);
  const zoomAfter = await page.evaluate(() => (window as unknown as { __inkflow: { editor: { state: { viewport: { zoom: number } } } } }).__inkflow.editor.state.viewport.zoom);
  expect(zoomAfter).toBeGreaterThan(zoomBefore * 1.5);

  // Style bottom sheet
  await page.getByTestId('tool-selection').tap();
  await page.getByTestId('mobile-style').tap();
  await expect(page.getByTestId('properties-panel')).toBeVisible();
});
