import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@inkflow/shared';
import { apiError, installFetchMock } from '@/test/fetch-mock';
import { makeUser } from '@/test/fixtures';
import { __resetClientStateForTests, onSessionExpired, onSessionRefreshed, request } from './client';
import { api } from './endpoints';

function setCsrfCookie(value: string) {
  document.cookie = `inkflow_csrf=${value}; path=/`;
}

beforeEach(() => {
  __resetClientStateForTests();
});

afterEach(() => {
  __resetClientStateForTests();
});

describe('CSRF handling', () => {
  it('echoes the CSRF cookie in x-csrf-token on mutating requests only', async () => {
    setCsrfCookie('cookie-token');
    const mock = installFetchMock([
      { method: 'GET', path: '/workspaces', respond: { body: [] } },
      { method: 'POST', path: '/workspaces', respond: { body: { id: 'w1' } } },
    ]);
    await api.workspaces.list();
    await api.workspaces.create({ name: 'Acme' });

    const [get, post] = mock.calls;
    expect(get!.headers.get('x-csrf-token')).toBeNull();
    expect(post!.headers.get('x-csrf-token')).toBe('cookie-token');
    expect(post!.headers.get('content-type')).toBe('application/json');
    expect(post!.body).toEqual({ name: 'Acme' });
    expect(mock.fetchMock.mock.calls[1]![1]).toMatchObject({ credentials: 'include', method: 'POST' });
  });

  it('fetches a token from /auth/csrf when no cookie is readable', async () => {
    const mock = installFetchMock([
      { method: 'GET', path: '/auth/csrf', respond: { body: { csrfToken: 'fetched-token' } } },
      { method: 'DELETE', path: '/boards/b1', respond: { body: { ok: true } } },
    ]);
    await api.boards.remove('b1');
    expect(mock.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /auth/csrf', 'DELETE /boards/b1']);
    expect(mock.calls[1]!.headers.get('x-csrf-token')).toBe('fetched-token');
  });

  it('re-fetches the token and retries once on 403 CSRF_INVALID', async () => {
    let csrfCalls = 0;
    const mock = installFetchMock([
      {
        method: 'GET',
        path: '/auth/csrf',
        respond: () => ({ body: { csrfToken: `token-${++csrfCalls}` } }),
      },
      {
        method: 'POST',
        path: '/boards/b1/duplicate',
        respond: (_call, index) => (index === 0 ? apiError(403, 'CSRF_INVALID') : { body: { id: 'b2' } }),
      },
    ]);
    await expect(api.boards.duplicate('b1')).resolves.toEqual({ id: 'b2' });
    const posts = mock.callsTo('POST', '/boards/b1/duplicate');
    expect(posts).toHaveLength(2);
    expect(posts[1]!.headers.get('x-csrf-token')).toBe('token-2');
  });
});

describe('401 handling', () => {
  it('refreshes once (single-flight) for concurrent 401s and retries every request', async () => {
    setCsrfCookie('t');
    const user = makeUser();
    let authorized = false;
    const mock = installFetchMock([
      {
        method: 'POST',
        path: '/auth/refresh',
        respond: async () => {
          await new Promise((r) => setTimeout(r, 10));
          authorized = true;
          return { body: { user } };
        },
      },
      {
        method: 'GET',
        path: /^\/(workspaces|notifications)$/,
        respond: (call) =>
          authorized ? { body: call.path === '/workspaces' ? [] : { items: [], unreadCount: 0 } } : apiError(401, 'UNAUTHORIZED'),
      },
    ]);
    const refreshed = vi.fn();
    onSessionRefreshed(refreshed);

    const [workspaces, notifications] = await Promise.all([api.workspaces.list(), api.notifications.list()]);

    expect(workspaces).toEqual([]);
    expect(notifications).toEqual({ items: [], unreadCount: 0 });
    expect(mock.callsTo('POST', '/auth/refresh')).toHaveLength(1);
    expect(mock.callsTo('GET', '/workspaces')).toHaveLength(2);
    expect(mock.callsTo('GET', '/notifications')).toHaveLength(2);
    expect(refreshed).toHaveBeenCalledWith(user);
  });

  it('signs out (notifies listeners) when the refresh is rejected', async () => {
    setCsrfCookie('t');
    const mock = installFetchMock([
      { method: 'POST', path: '/auth/refresh', respond: apiError(401, 'SESSION_EXPIRED', 'Session expired') },
      { method: 'GET', path: '/boards', respond: apiError(401, 'SESSION_EXPIRED', 'Session expired') },
    ]);
    const expired = vi.fn();
    onSessionExpired(expired);

    const error = await api.boards.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('SESSION_EXPIRED');
    expect(expired).toHaveBeenCalledTimes(1);
    expect(mock.callsTo('GET', '/boards')).toHaveLength(1);

    // Once signed out, further 401s do not hammer the refresh endpoint.
    await api.boards.list().catch(() => undefined);
    expect(mock.callsTo('POST', '/auth/refresh')).toHaveLength(1);
  });

  it('does not refresh for credential errors on auth endpoints', async () => {
    setCsrfCookie('t');
    const mock = installFetchMock([
      { method: 'POST', path: '/auth/login', respond: apiError(401, 'INVALID_CREDENTIALS', 'Wrong password') },
    ]);
    await expect(api.auth.login({ email: 'a@b.co', password: 'x' })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(mock.callsTo('POST', '/auth/refresh')).toHaveLength(0);
  });
});

describe('error mapping', () => {
  it('maps API error bodies to ApiError', async () => {
    installFetchMock([
      {
        method: 'GET',
        path: '/boards/missing',
        respond: { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Board not found', requestId: 'r1' } } },
      },
    ]);
    const error = (await api.boards.get('missing').catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'Board not found' });
  });

  it('maps network failures to SERVICE_UNAVAILABLE with a friendly message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = (await api.health().catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('SERVICE_UNAVAILABLE');
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/can't reach inkflow/i);
  });

  it('maps non-JSON gateway errors by status', async () => {
    installFetchMock([{ method: 'GET', path: '/health', respond: { status: 502, body: '<html>Bad gateway</html>' } }]);
    await expect(api.health()).rejects.toMatchObject({ status: 502, code: 'SERVICE_UNAVAILABLE' });
  });

  it('keeps Retry-After for rate-limited responses', async () => {
    installFetchMock([
      {
        method: 'GET',
        path: '/search',
        respond: { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, headers: { 'retry-after': '12' } },
      },
    ]);
    const error = (await api.search({ q: 'x' }).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.details).toEqual({ retryAfterSeconds: 12 });
  });

  it('propagates aborts untouched', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      }),
    );
    const promise = request('GET', '/boards', { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('request building', () => {
  it('serializes query parameters (skipping empty values) and sends share tokens', async () => {
    const mock = installFetchMock([{ method: 'GET', path: '/boards', respond: { body: [] } }]);
    await api.boards.list({ workspaceId: 'w1', filter: 'favorites', q: undefined }, { shareToken: 'share-123' });
    const call = mock.calls[0]!;
    expect(call.query.get('workspaceId')).toBe('w1');
    expect(call.query.get('filter')).toBe('favorites');
    expect(call.query.has('q')).toBe(false);
    expect(call.headers.get('x-share-token')).toBe('share-123');
  });

  it('builds content and thumbnail URLs with the st query parameter', () => {
    expect(api.files.contentUrl('f1')).toBe('/api/files/f1/content');
    expect(api.files.contentUrl('f1', 'tok')).toBe('/api/files/f1/content?st=tok');
    expect(api.boards.thumbnailUrl('b 1')).toBe('/api/boards/b%201/thumbnail');
  });

  it('resolves empty 204 responses to undefined', async () => {
    setCsrfCookie('t');
    installFetchMock([{ method: 'PUT', path: '/boards/b1/favorite', respond: { status: 204 } }]);
    await expect(api.boards.favorite('b1')).resolves.toBeUndefined();
  });
});
