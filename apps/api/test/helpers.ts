import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@inkflow/collaboration';
import { createElement, type ElementType, type NewElementProps, type SceneElement } from '@inkflow/elements';
import type { Operation } from '@inkflow/scene';
import { CSRF_COOKIE, CSRF_HEADER, type UserDto, type WorkspaceDto } from '@inkflow/shared';
import { createApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { MAILPIT_URL, testEnv } from './env';

// ───────────────────────────── app ─────────────────────────────

export interface TestApp {
  app: NestExpressApplication;
  url: string;
  wsUrl: string;
  prisma: PrismaService;
  close(): Promise<void>;
}

/** Boots the real application on a random port against the test services. */
export async function startApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const env = testEnv(overrides);
  const app = await createApp(env);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  return {
    app,
    url,
    wsUrl: `ws://127.0.0.1:${port}/api/ws`,
    prisma: app.get(PrismaService),
    close: () => app.close(),
  };
}

// ───────────────────────────── HTTP client with a cookie jar ─────────────────────────────

interface StoredCookie {
  value: string;
  path: string;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  /** Send the CSRF header for unsafe methods (default true). */
  csrf?: boolean;
}

/** Browser-like client: keeps cookies (respecting their path) and echoes the CSRF cookie. */
export class TestClient {
  readonly cookies = new Map<string, StoredCookie>();
  user: UserDto | null = null;

  constructor(readonly baseUrl: string) {}

  cookieHeader(path = '/api'): string {
    return [...this.cookies.entries()]
      .filter(([, c]) => path.startsWith(c.path))
      .map(([name, c]) => `${name}=${encodeURIComponent(c.value)}`)
      .join('; ');
  }

  cookie(name: string): string | undefined {
    return this.cookies.get(name)?.value;
  }

  private storeCookies(setCookie: string[] | string | undefined): void {
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    for (const raw of list) {
      const [pair, ...attrs] = raw.split(';').map((p) => p.trim());
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq);
      const value = decodeURIComponent(pair!.slice(eq + 1));
      let path = '/';
      let expired = value === '';
      for (const attr of attrs) {
        const [k, v] = attr.split('=');
        const key = k!.toLowerCase();
        if (key === 'path' && v) path = v;
        if (key === 'max-age' && Number(v) <= 0) expired = true;
        if (key === 'expires' && v && new Date(v).getTime() <= Date.now()) expired = true;
      }
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, { value, path });
    }
  }

  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const agent = request(this.baseUrl);
    const m = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    let req = agent[m](path);
    const cookie = this.cookieHeader(path);
    if (cookie) req = req.set('Cookie', cookie);
    const csrf = this.cookie(CSRF_COOKIE);
    if ((options.csrf ?? true) && csrf && !['get', 'head'].includes(m)) req = req.set(CSRF_HEADER, csrf);
    for (const [k, v] of Object.entries(options.headers ?? {})) req = req.set(k, v);
    if (options.query) req = req.query(options.query);
    const res = options.body !== undefined ? await req.send(options.body as object) : await req;
    this.storeCookies(res.headers['set-cookie']);
    return { status: res.status, body: res.body as T, headers: res.headers, text: res.text };
  }

  get<T = unknown>(path: string, options?: RequestOptions) {
    return this.request<T>('GET', path, options);
  }
  post<T = unknown>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('POST', path, { ...options, body });
  }
  patch<T = unknown>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('PATCH', path, { ...options, body });
  }
  put<T = unknown>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('PUT', path, { ...options, body });
  }
  delete<T = unknown>(path: string, options?: RequestOptions) {
    return this.request<T>('DELETE', path, options);
  }

  /** Multipart upload. */
  async upload<T = unknown>(
    path: string,
    file: { buffer: Buffer; filename: string; contentType: string },
    fields: Record<string, string> = {},
    options: { method?: 'post' | 'put'; headers?: Record<string, string> } = {},
  ): Promise<ApiResponse<T>> {
    let req = request(this.baseUrl)[options.method ?? 'post'](path);
    const cookie = this.cookieHeader(path);
    if (cookie) req = req.set('Cookie', cookie);
    const csrf = this.cookie(CSRF_COOKIE);
    if (csrf) req = req.set(CSRF_HEADER, csrf);
    for (const [k, v] of Object.entries(options.headers ?? {})) req = req.set(k, v);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    req = req.attach('file', file.buffer, { filename: file.filename, contentType: file.contentType });
    const res = await req;
    this.storeCookies(res.headers['set-cookie']);
    return { status: res.status, body: res.body as T, headers: res.headers, text: res.text };
  }
}

// ───────────────────────────── Mailpit ─────────────────────────────

interface MailpitSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  Created: string;
}

export async function findEmails(to: string): Promise<MailpitSummary[]> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`);
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  const data = (await res.json()) as { messages: MailpitSummary[] };
  return data.messages;
}

/** Waits for an email to `to` whose subject contains `subject`; returns its plain-text body. */
export async function waitForEmail(to: string, subject: string, timeoutMs = 10_000): Promise<{ subject: string; text: string; html: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = await findEmails(to);
    const match = messages.find((m) => m.Subject.includes(subject));
    if (match) {
      const res = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      const msg = (await res.json()) as { Subject: string; Text: string; HTML: string };
      return { subject: msg.Subject, text: msg.Text, html: msg.HTML };
    }
    if (Date.now() > deadline) throw new Error(`No email "${subject}" for ${to}`);
    await sleep(150);
  }
}

export function tokenFromText(text: string, pattern: RegExp = /token=([A-Za-z0-9_-]+)/): string {
  const m = pattern.exec(text);
  if (!m) throw new Error(`No token in email:\n${text}`);
  return decodeURIComponent(m[1]!);
}

// ───────────────────────────── accounts ─────────────────────────────

export const PASSWORD = 'correct-horse-42';

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.test`.toLowerCase();
}

/** Registers, verifies via the emailed link and returns a signed-in client. */
export async function signUp(baseUrl: string, name = 'Test User', email = uniqueEmail()): Promise<TestClient> {
  const client = new TestClient(baseUrl);
  await client.get('/api/auth/csrf');
  const reg = await client.post<{ user: UserDto; requiresVerification: boolean }>('/api/auth/register', {
    email,
    password: PASSWORD,
    name,
  });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${reg.text}`);
  const mail = await waitForEmail(email, 'Verify your email');
  const verify = await client.post<{ user: UserDto }>('/api/auth/verify-email', { token: tokenFromText(mail.text) });
  if (verify.status !== 200) throw new Error(`verify failed: ${verify.status} ${verify.text}`);
  client.user = verify.body.user;
  return client;
}

export async function personalWorkspace(client: TestClient): Promise<WorkspaceDto> {
  const res = await client.get<WorkspaceDto[]>('/api/workspaces');
  return res.body[0]!;
}

export async function createBoard(client: TestClient, body: Record<string, unknown> = {}): Promise<{ id: string; workspaceId: string }> {
  const workspaceId = (body.workspaceId as string | undefined) ?? (await personalWorkspace(client)).id;
  const res = await client.post<{ id: string; workspaceId: string }>('/api/boards', { workspaceId, title: 'Test board', ...body });
  if (res.status !== 201) throw new Error(`create board failed: ${res.status} ${res.text}`);
  return res.body;
}

// ───────────────────────────── scene helpers ─────────────────────────────

let opCounter = 0;

export function element<T extends ElementType>(type: T, props: NewElementProps<T> = {}): SceneElement {
  return createElement(type, { x: 10, y: 20, width: 100, height: 50, ...props } as NewElementProps<T>);
}

export function op(clientId: string, body: Record<string, unknown>, baseVersion: number | null = null): Operation {
  opCounter++;
  return {
    opId: `op-${randomUUID()}`,
    clientId,
    clientSeq: opCounter,
    timestamp: Date.now(),
    baseVersion,
    ...body,
  } as Operation;
}

export const createOp = (clientId: string, el: SceneElement) => op(clientId, { type: 'CREATE_ELEMENT', element: el });
export const moveOp = (clientId: string, elementId: string, x: number, y: number) =>
  op(clientId, { type: 'MOVE_ELEMENT', elementId, x, y });

// ───────────────────────────── WebSocket client ─────────────────────────────

export class TestSocket {
  readonly messages: ServerMessage[] = [];
  private waiters: { predicate: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  readonly opened: Promise<void>;

  constructor(readonly ws: WebSocket) {
    this.opened = new Promise((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    this.closed = new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(msg);
      for (const w of [...this.waiters]) {
        if (w.predicate(msg)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(msg);
        }
      }
    });
  }

  send(msg: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolves with the first (already received or future) message matching the predicate. */
  next<T extends ServerMessage['t']>(
    t: T,
    predicate: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true,
    timeoutMs = 5_000,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const test = (m: ServerMessage) => m.t === t && predicate(m as Extract<ServerMessage, { t: T }>);
    const existing = this.messages.find(test);
    if (existing) {
      this.messages.splice(this.messages.indexOf(existing), 1);
      return Promise.resolve(existing as Extract<ServerMessage, { t: T }>);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== done);
        reject(new Error(`Timed out waiting for "${t}" (got: ${this.messages.map((m) => m.t).join(', ')})`));
      }, timeoutMs);
      const done = (m: ServerMessage) => {
        clearTimeout(timer);
        const idx = this.messages.indexOf(m);
        if (idx >= 0) this.messages.splice(idx, 1);
        resolve(m as Extract<ServerMessage, { t: T }>);
      };
      this.waiters.push({ predicate: test, resolve: done });
    });
  }

  /** Asserts that no matching message arrives within `ms`. */
  async expectNone(t: ServerMessage['t'], ms = 400): Promise<void> {
    await sleep(ms);
    const found = this.messages.find((m) => m.t === t);
    if (found) throw new Error(`Unexpected "${t}" message: ${JSON.stringify(found)}`);
  }

  close(): void {
    this.ws.close();
  }
}

export function openSocket(wsUrl: string, params: { boardId: string; st?: string; cookie?: string; origin?: string }): TestSocket {
  const url = new URL(wsUrl);
  url.searchParams.set('boardId', params.boardId);
  if (params.st) url.searchParams.set('st', params.st);
  const headers: Record<string, string> = {};
  if (params.cookie) headers.cookie = params.cookie;
  if (params.origin) headers.origin = params.origin;
  return new TestSocket(new WebSocket(url, { headers }));
}

/** Opens a socket, says hello and waits for the welcome. */
export async function joinBoard(
  wsUrl: string,
  params: { boardId: string; st?: string; cookie?: string; clientId?: string; lastSeq?: number },
): Promise<{ socket: TestSocket; welcome: Extract<ServerMessage, { t: 'welcome' }>; clientId: string }> {
  const socket = openSocket(wsUrl, params);
  await socket.opened;
  const clientId = params.clientId ?? `client-${randomUUID()}`;
  socket.send({ t: 'hello', protocol: 1, boardId: params.boardId, clientId, lastSeq: params.lastSeq ?? 0 });
  const welcome = await socket.next('welcome');
  return { socket, welcome, clientId };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until `fn` returns a truthy value. */
export async function eventually<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('Condition not met in time');
    await sleep(100);
  }
}

/** A tiny, valid 1×1 PNG. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
