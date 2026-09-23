import { expect, test } from '@playwright/test';
import {
  boardElementsInDb,
  canvasCenter,
  createBoard,
  createWorkspace,
  dragOnCanvas,
  drawWithTool,
  registerAndVerify,
  sceneElements,
  uniqueUser,
  waitForEditor,
  waitSaved,
} from '../helpers';

test('viewer links are read-only and strangers have no access', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const owner = uniqueUser('perm-owner');
  await registerAndVerify(page, owner);
  await createWorkspace(page, 'Permissions');
  const boardId = await createBoard(page, 'Private board');
  const c = await canvasCenter(page);
  await drawWithTool(page, 'rectangle', { x: c.x - 80, y: c.y - 50 }, { x: c.x + 80, y: c.y + 50 });
  await waitSaved(page);

  // Create a view-only link.
  await page.getByTestId('share-button').click();
  await page.getByTestId('share-link-create').click();
  const url = await page.getByTestId('share-link-url').first().inputValue();
  await page.keyboard.press('Escape');

  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await viewer.goto(new URL(url).pathname);
  await waitForEditor(viewer);
  expect(await sceneElements(viewer)).toHaveLength(1);
  await expect(viewer.getByTestId('tool-rectangle')).toHaveCount(0);
  await expect(viewer.getByTestId('save-status')).toContainText(/view only/i);
  // Keyboard shortcuts and drags cannot modify the board.
  const vc = await canvasCenter(viewer);
  await viewer.getByTestId('canvas-container').focus();
  await viewer.keyboard.press('r');
  await dragOnCanvas(viewer, { x: vc.x + 150, y: vc.y + 150 }, { x: vc.x + 300, y: vc.y + 250 });
  await viewer.keyboard.press('Control+a');
  await viewer.keyboard.press('Delete');
  expect(await sceneElements(viewer)).toHaveLength(1);
  await viewer.waitForTimeout(1000);
  expect(await boardElementsInDb(boardId)).toHaveLength(1);
  await viewerCtx.close();

  // A signed-in stranger cannot open the board.
  const strangerCtx = await browser.newContext();
  const stranger = await strangerCtx.newPage();
  await registerAndVerify(stranger, uniqueUser('stranger'));
  await stranger.goto(`/b/${boardId}`);
  await expect(
    stranger.getByText(/couldn.t find|no longer have access|not found/i).first(),
  ).toBeVisible();
  // The API itself refuses (never trust the frontend).
  const res = await stranger.request.get(`/api/boards/${boardId}`);
  expect(res.status()).toBe(404);
  await strangerCtx.close();
});
