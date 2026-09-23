import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  canvasCenter,
  createBoard,
  createWorkspace,
  drawWithTool,
  modKey,
  registerAndVerify,
  sceneElements,
  uniqueUser,
  waitSaved,
} from '../helpers';

test('exports SVG and JSON, saves and restores versions, trash and restore', async ({ page }) => {
  test.setTimeout(180_000);
  await registerAndVerify(page, uniqueUser('export'));
  const workspaceId = await createWorkspace(page, 'Exports');
  const boardId = await createBoard(page, 'Export me');
  const c = await canvasCenter(page);
  await drawWithTool(page, 'rectangle', { x: c.x - 100, y: c.y - 60 }, { x: c.x + 100, y: c.y + 60 });
  await drawWithTool(page, 'arrow', { x: c.x + 150, y: c.y }, { x: c.x + 300, y: c.y });
  await waitSaved(page);

  const exportAs = async (format: 'svg' | 'json') => {
    await page.getByTestId('board-menu').click();
    await page.getByTestId('menu-export').click();
    await page.getByTestId(`export-format-${format}`).click();
    const dl = page.waitForEvent('download');
    await page.getByTestId('export-download').click();
    const file = await readFile((await (await dl).path())!, 'utf8');
    await page.keyboard.press('Escape');
    return file;
  };
  const svg = await exportAs('svg');
  expect(svg).toContain('<svg');
  expect(svg).toMatch(/<path[^>]+d="/);
  expect(svg).not.toContain('<script');
  const json = JSON.parse(await exportAs('json')) as { type: string; elements: unknown[] };
  expect(json.type).toBe('inkflow');
  expect(json.elements).toHaveLength(2);

  // Manual version, then change, then restore.
  await page.getByTestId('board-menu').click();
  await page.getByTestId('menu-versions').click();
  await expect(page.getByTestId('panel-versions')).toBeVisible();
  await page.getByTestId('version-save').click();
  await expect(page.getByTestId('version-row').first()).toBeVisible();
  await page.getByTestId('canvas-container').focus();
  await page.keyboard.press(`${modKey}+a`);
  await page.keyboard.press('Delete');
  expect(await sceneElements(page)).toHaveLength(0);
  await waitSaved(page);
  await page.getByTestId('version-row').first().hover();
  await page.getByTestId('version-restore').first().click();
  await page.getByRole('button', { name: /restore/i }).last().click();
  await expect.poll(async () => (await sceneElements(page)).length, { timeout: 20_000 }).toBe(2);

  // Trash and restore from the dashboard.
  await page.goto(`/w/${workspaceId}`);
  const card = page.locator(`[data-testid="board-card"][data-board-id="${boardId}"]`);
  await card.getByTestId('board-card-menu').click();
  await page.getByTestId('board-menu-delete').click();
  await page.getByTestId('trash-nav').click();
  await expect(page.locator(`[data-board-id="${boardId}"]`)).toBeVisible();
  await page.locator(`[data-board-id="${boardId}"]`).getByTestId('trash-restore').click();
  await page.goto(`/b/${boardId}`);
  await expect.poll(async () => (await sceneElements(page)).length).toBe(2);
});
