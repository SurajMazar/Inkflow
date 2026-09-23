import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  boardElementsInDb,
  canvasCenter,
  createBoard,
  createWorkspace,
  dragOnCanvas,
  drawWithTool,
  login,
  logout,
  modKey,
  registerAndVerify,
  sceneElements,
  uniqueUser,
  waitForEditor,
  waitSaved,
  worldToPage,
} from '../helpers';

test('complete journey: register → draw → diagram → undo/redo → persist → share → collaborate → export', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = uniqueUser('owner');

  // Register → verify → create workspace → sign out → sign in
  await registerAndVerify(page, owner);
  await createWorkspace(page, 'Journey workspace');
  await logout(page);
  await login(page, owner);

  // Create board
  const boardId = await createBoard(page, 'Journey board');
  const c = await canvasCenter(page);

  // Draw objects
  await drawWithTool(
    page,
    'rectangle',
    { x: c.x - 360, y: c.y - 120 },
    { x: c.x - 200, y: c.y - 20 },
  );
  await drawWithTool(
    page,
    'ellipse',
    { x: c.x + 120, y: c.y - 120 },
    { x: c.x + 280, y: c.y - 20 },
  );
  let els = await sceneElements(page);
  expect(els.map((e) => e.type).sort()).toEqual(['ellipse', 'rectangle']);
  const rect = els.find((e) => e.type === 'rectangle')!;
  const ellipse = els.find((e) => e.type === 'ellipse')!;
  expect(rect.width).toBeGreaterThan(100);

  // Add text
  await page.getByTestId('tool-text').click();
  await page.mouse.click(c.x - 300, c.y + 140);
  await expect(page.getByTestId('text-editor')).toBeVisible();
  await page.keyboard.type('Hello Inkflow');
  await page.keyboard.press('Escape');
  els = await sceneElements(page);
  expect(els.find((e) => e.type === 'text')?.text).toBe('Hello Inkflow');

  // Create a diagram connection: connector from the rectangle to the ellipse (bound to both)
  await page.getByTestId('canvas-container').focus();
  await page.keyboard.press('c');
  const from = await worldToPage(page, rect.x + rect.width / 2, rect.y + rect.height / 2);
  const to = await worldToPage(page, ellipse.x + ellipse.width / 2, ellipse.y + ellipse.height / 2);
  await dragOnCanvas(page, from, to);
  els = await sceneElements(page);
  const connector = els.find((e) => e.type === 'connector')!;
  expect(connector).toBeTruthy();
  expect(connector.startBinding?.elementId).toBe(rect.id);
  expect(connector.endBinding?.elementId).toBe(ellipse.id);

  // Move a node: the connector follows
  await page.keyboard.press('v');
  const grab = await worldToPage(page, ellipse.x + ellipse.width / 2, ellipse.y + 4);
  await page.mouse.click(c.x, c.y + 300); // deselect
  await dragOnCanvas(page, grab, { x: grab.x, y: grab.y + 220 });
  els = await sceneElements(page);
  const movedEllipse = els.find((e) => e.id === ellipse.id)!;
  expect(movedEllipse.y).toBeGreaterThan(ellipse.y + 150);
  const movedConnector = els.find((e) => e.id === connector.id)!;
  expect(movedConnector.y + movedConnector.height).toBeGreaterThan(
    connector.y + connector.height + 100,
  );

  // Undo / redo actually change the document
  await page.keyboard.press(`${modKey}+z`);
  els = await sceneElements(page);
  expect(els.find((e) => e.id === ellipse.id)!.y).toBeCloseTo(ellipse.y, 0);
  await page.keyboard.press(`${modKey}+Shift+z`);
  els = await sceneElements(page);
  expect(els.find((e) => e.id === ellipse.id)!.y).toBeCloseTo(movedEllipse.y, 0);

  // Save (autosave) → PostgreSQL
  await waitSaved(page);
  const rows = await boardElementsInDb(boardId);
  expect(rows.map((r) => r.type).sort()).toEqual(['connector', 'ellipse', 'rectangle', 'text']);
  const dbEllipse = rows.find((r) => r.element_id === ellipse.id)!;
  expect(Number(dbEllipse.data.y)).toBeCloseTo(movedEllipse.y, 0);

  // Reload → the board is restored from the server
  await page.reload();
  await waitForEditor(page);
  const restored = await sceneElements(page);
  expect(restored.map((e) => e.id).sort()).toEqual(els.map((e) => e.id).sort());
  expect(restored.find((e) => e.type === 'text')?.text).toBe('Hello Inkflow');

  // Share: create an editor link
  await page.getByTestId('share-button').click();
  await page.getByTestId('share-link-role').selectOption('EDITOR');
  await page.getByTestId('share-link-create').click();
  const shareUrl = await page
    .getByTestId('share-link-url')
    .first()
    .inputValue()
    .catch(async () => (await page.getByTestId('share-link-url').first().textContent()) ?? '');
  expect(shareUrl).toContain('/s/');
  await page.keyboard.press('Escape');

  // Second browser (anonymous guest via the link)
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(new URL(shareUrl).pathname);
  await guest.waitForURL(new RegExp(`/b/${boardId}`));
  await waitForEditor(guest);
  expect((await sceneElements(guest)).length).toBe(4);
  await expect(page.getByTestId('collaborator-avatar')).toHaveCount(1, { timeout: 20_000 });

  // Collaborate: the guest draws, the owner sees it live and it is persisted
  const gc = await canvasCenter(guest);
  await drawWithTool(
    guest,
    'rectangle',
    { x: gc.x - 100, y: gc.y + 150 },
    { x: gc.x + 40, y: gc.y + 240 },
  );
  await expect.poll(async () => (await sceneElements(page)).length, { timeout: 20_000 }).toBe(5);
  // The owner moves the text; the guest sees the new position
  const text = (await sceneElements(page)).find((e) => e.type === 'text')!;
  await page.getByTestId('canvas-container').focus();
  const textPoint = await worldToPage(page, text.x + 10, text.y + text.height / 2);
  await dragOnCanvas(page, textPoint, { x: textPoint.x + 120, y: textPoint.y });
  await expect
    .poll(async () => (await sceneElements(guest)).find((e) => e.id === text.id)!.x, {
      timeout: 20_000,
    })
    .toBeGreaterThan(text.x + 80);
  await waitSaved(guest);
  await expect
    .poll(async () => (await boardElementsInDb(boardId)).length, { timeout: 20_000 })
    .toBe(5);
  await guestContext.close();

  // Export PNG (actually produces a PNG file)
  await page.getByTestId('board-menu').click();
  await page.getByTestId('menu-export').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByTestId('export-format-png').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-download').click();
  const download = await downloadPromise;
  const file = await readFile((await download.path())!);
  expect(file.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(file.length).toBeGreaterThan(2000);
});
