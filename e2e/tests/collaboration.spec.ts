import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  boardElementsInDb,
  canvasCenter,
  createBoard,
  createWorkspace,
  drawWithTool,
  registerAndVerify,
  sceneElements,
  uniqueUser,
  waitForEditor,
  waitSaved,
  type TestUser,
} from '../helpers';

async function signedInPage(browser: Browser, user: TestUser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await registerAndVerify(page, user);
  return page;
}

test('two signed-in collaborators: invite, presence, live edits, offline sync', async ({ browser }) => {
  test.setTimeout(240_000);
  const alice = uniqueUser('alice');
  const bob = uniqueUser('bob');
  const a = await signedInPage(browser, alice);
  const b = await signedInPage(browser, bob);
  await createWorkspace(b, 'Bob space');

  await createWorkspace(a, 'Alice space');
  const boardId = await createBoard(a, 'Shared board');

  // Alice shares the board with Bob by email as an editor.
  await a.getByTestId('share-button').click();
  await a.getByTestId('share-invite-email').fill(bob.email);
  await a.getByTestId('share-invite-submit').click();
  await expect(a.getByText(bob.email).first()).toBeVisible();
  await a.keyboard.press('Escape');

  // Bob sees it under "Shared with me" and opens it.
  await b.goto(`/b/${boardId}`);
  await waitForEditor(b);

  // Presence: each sees the other.
  await expect(a.getByTestId('collaborator-avatar')).toHaveCount(1, { timeout: 20_000 });
  await expect(b.getByTestId('collaborator-avatar')).toHaveCount(1, { timeout: 20_000 });

  // Live edits in both directions.
  const ca = await canvasCenter(a);
  await drawWithTool(a, 'rectangle', { x: ca.x - 200, y: ca.y - 100 }, { x: ca.x - 60, y: ca.y });
  await expect.poll(async () => (await sceneElements(b)).length, { timeout: 20_000 }).toBe(1);
  const cb = await canvasCenter(b);
  await drawWithTool(b, 'diamond', { x: cb.x + 60, y: cb.y - 100 }, { x: cb.x + 200, y: cb.y });
  await expect.poll(async () => (await sceneElements(a)).length, { timeout: 20_000 }).toBe(2);

  // Bob goes offline, keeps editing; changes are queued locally.
  await b.context().setOffline(true);
  await b.evaluate(() => window.dispatchEvent(new Event('offline')));
  await drawWithTool(b, 'ellipse', { x: cb.x - 100, y: cb.y + 120 }, { x: cb.x + 20, y: cb.y + 220 });
  await expect(b.getByTestId('save-status')).toHaveAttribute('data-state', 'offline', { timeout: 20_000 });
  expect((await boardElementsInDb(boardId)).length).toBe(2);

  // Back online: the queued operation syncs, Alice receives it, PostgreSQL has it.
  await b.context().setOffline(false);
  await b.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitSaved(b);
  await expect.poll(async () => (await sceneElements(a)).length, { timeout: 30_000 }).toBe(3);
  await expect.poll(async () => (await boardElementsInDb(boardId)).length, { timeout: 20_000 }).toBe(3);

  await a.context().close();
  await b.context().close();
});
