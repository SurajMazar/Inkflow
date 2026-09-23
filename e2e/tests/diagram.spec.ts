import { expect, test } from '@playwright/test';
import {
  boardElementsInDb,
  createBoard,
  createWorkspace,
  modKey,
  registerAndVerify,
  sceneElements,
  uniqueUser,
  waitSaved,
} from '../helpers';

test('templates, library items, Mermaid import and auto layout create real diagrams', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await registerAndVerify(page, uniqueUser('diagram'));
  await createWorkspace(page, 'Diagrams');
  const boardId = await createBoard(page, 'Architecture');

  // Insert a template from the library panel.
  await page.getByTestId('open-library').click();
  await expect(page.getByTestId('panel-library')).toBeVisible();
  await page.getByRole('tab', { name: /templates/i }).click();
  await page.getByTestId('template-insert').first().click();
  await expect.poll(async () => (await sceneElements(page)).length).toBeGreaterThan(5);
  const afterTemplate = await sceneElements(page);
  const connectors = afterTemplate.filter((e) => e.type === 'connector');
  expect(connectors.length).toBeGreaterThan(0);
  const ids = new Set(afterTemplate.map((e) => e.id));
  for (const conn of connectors) {
    if (conn.startBinding) expect(ids.has(conn.startBinding.elementId)).toBe(true);
    if (conn.endBinding) expect(ids.has(conn.endBinding.elementId)).toBe(true);
  }

  // Mermaid → diagram
  await page.getByRole('tab', { name: /text|mermaid/i }).click();
  await page
    .getByTestId('mermaid-input')
    .fill('flowchart LR\n  A[Start] --> B{Valid?}\n  B -->|yes| C[Save]\n  B -->|no| D[Reject]');
  await page.getByTestId('mermaid-insert').click();
  await expect
    .poll(async () => (await sceneElements(page)).length)
    .toBeGreaterThan(afterTemplate.length + 5);

  // Auto layout the newly inserted diagram (it is selected after insertion).
  const before = await sceneElements(page);
  await page.getByTestId('canvas-container').focus();
  await page.keyboard.press('Alt+Shift+L');
  await expect(page.getByTestId('autolayout-dialog')).toBeVisible();
  await page.getByTestId('autolayout-apply').click();
  const after = await sceneElements(page);
  const moved = after.filter((e) => {
    const prev = before.find((p) => p.id === e.id);
    return prev && (Math.abs(prev.x - e.x) > 1 || Math.abs(prev.y - e.y) > 1);
  });
  expect(moved.length).toBeGreaterThan(0);

  // Undo the layout in one step.
  await page.keyboard.press(`${modKey}+z`);
  const undone = await sceneElements(page);
  for (const e of before) {
    const u = undone.find((x) => x.id === e.id)!;
    expect(u.x).toBeCloseTo(e.x, 0);
  }

  await waitSaved(page);
  const rows = await boardElementsInDb(boardId);
  expect(rows.length).toBe(undone.length);
  expect(rows.some((r) => r.type === 'connector' && r.data.startBinding)).toBe(true);
});
