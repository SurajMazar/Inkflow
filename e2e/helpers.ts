import { expect, type Page } from '@playwright/test';
import pg from 'pg';
import { E2E, WEB_URL } from './env';

export interface TestUser {
  name: string;
  email: string;
  password: string;
}

let counter = 0;
export function uniqueUser(prefix = 'user'): TestUser {
  counter += 1;
  const id = `${Date.now().toString(36)}${counter}`;
  return { name: `${prefix} ${id}`, email: `${prefix}.${id}@example.test`, password: `Sketch-${id}-pass9` };
}

// ───────────────────────────── email (Mailpit) ─────────────────────────────

interface MailpitSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  Created: string;
}

/** Polls Mailpit for the newest email to `to` whose subject matches, and returns its text body. */
export async function waitForEmail(to: string, subject: RegExp, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${E2E.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=20`);
    if (res.ok) {
      const data = (await res.json()) as { messages: MailpitSummary[] };
      const match = data.messages.find((m) => subject.test(m.Subject));
      if (match) {
        const msg = (await (await fetch(`${E2E.mailpitUrl}/api/v1/message/${match.ID}`)).json()) as { Text: string; HTML: string };
        return `${msg.Text}\n${msg.HTML}`;
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`No email to ${to} matching ${subject} within ${timeoutMs} ms`);
}

/** Extracts an app link (e.g. /verify-email?token=…) from an email body, rebased onto the E2E origin. */
export function extractLink(body: string, path: string): string {
  const re = new RegExp(`https?://[^\\s"'<>]+${path.replace(/[/?]/g, (c) => `\\${c}`)}[^\\s"'<>]*`);
  const m = re.exec(body);
  if (!m) throw new Error(`Link ${path} not found in email`);
  const url = new URL(m[0].replace(/&amp;/g, '&'));
  return `${WEB_URL}${url.pathname}${url.search}`;
}

// ───────────────────────────── database ─────────────────────────────

export async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: E2E.databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

export async function boardElementsInDb(boardId: string) {
  return query<{ element_id: string; type: string; data: Record<string, unknown>; is_deleted: boolean }>(
    `SELECT element_id, type, data, is_deleted FROM board_elements WHERE board_id = $1 AND is_deleted = false ORDER BY z_index COLLATE "C"`,
    [boardId],
  );
}

// ───────────────────────────── auth & navigation ─────────────────────────────

export async function registerAndVerify(page: Page, user: TestUser): Promise<void> {
  await page.goto('/register');
  await page.getByTestId('register-name').fill(user.name);
  await page.getByTestId('register-email').fill(user.email);
  await page.getByTestId('register-password').fill(user.password);
  await page.getByTestId('register-submit').click();
  await expect(page.getByTestId('register-success')).toBeVisible();
  const body = await waitForEmail(user.email, /verify/i);
  await page.goto(extractLink(body, '/verify-email'));
  await page.waitForURL((url) => !url.pathname.startsWith('/verify-email'), { timeout: 20_000 });
}

export async function login(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(user.email);
  await page.getByTestId('login-password').fill(user.password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

export async function logout(page: Page): Promise<void> {
  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await page.waitForURL(/\/login/);
}

export async function createWorkspace(page: Page, name: string): Promise<string> {
  await page.getByTestId('create-workspace-name').fill(name);
  await page.getByTestId('create-workspace-submit').click();
  await page.waitForURL(/\/w\/[^/]+/);
  return new URL(page.url()).pathname.split('/')[2]!;
}

export async function createBoard(page: Page, title: string): Promise<string> {
  await page.getByTestId('new-board').first().click();
  await page.getByTestId('new-board-title').fill(title);
  await page.getByTestId('new-board-submit').click();
  await page.waitForURL(/\/b\/[^/]+/);
  await waitForEditor(page);
  return new URL(page.url()).pathname.split('/')[2]!;
}

// ───────────────────────────── editor helpers ─────────────────────────────

export interface ElementSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  label?: { text: string } | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  groupIds: string[];
}

export async function waitForEditor(page: Page): Promise<void> {
  await expect(page.getByTestId('interactive-canvas')).toBeVisible();
  await page.waitForFunction(() => Boolean((window as unknown as { __inkflow?: unknown }).__inkflow));
}

export async function sceneElements(page: Page): Promise<ElementSnapshot[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __inkflow: { editor: { getElements(): ElementSnapshotLike[] } } };
    type ElementSnapshotLike = Record<string, unknown>;
    return JSON.parse(JSON.stringify(w.__inkflow.editor.getElements())) as never;
  });
}

/** Converts world coordinates into page coordinates for pointer input. */
export async function worldToPage(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([wx, wy]) => {
      const w = window as unknown as { __inkflow: { editor: { state: { viewport: { x: number; y: number; zoom: number } } } } };
      const vp = w.__inkflow.editor.state.viewport;
      const canvas = document.querySelector('[data-testid="interactive-canvas"]')!.getBoundingClientRect();
      return { x: canvas.left + (wx - vp.x) * vp.zoom, y: canvas.top + (wy - vp.y) * vp.zoom };
    },
    [x, y] as const,
  );
}

export async function canvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId('interactive-canvas').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Selects a tool and drags on the canvas between two page points. */
export async function drawWithTool(page: Page, tool: string, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.getByTestId(`tool-${tool}`).click();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
}

export async function dragOnCanvas(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await page.mouse.up();
}

export async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', { timeout: 20_000 });
}

export const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
