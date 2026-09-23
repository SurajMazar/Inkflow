import { vi } from 'vitest';

export interface RecordedCall {
  method: string;
  url: string;
  /** Path without the `/api` prefix, e.g. `/boards/b1`. */
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: unknown;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface MockRoute {
  method: string;
  path: string | RegExp;
  /** Static response or a function of the call (and its 0-based index for this route). */
  respond: MockResponse | ((call: RecordedCall, index: number) => MockResponse | Promise<MockResponse>);
}

function toResponse({ status = 200, body, headers = {} }: MockResponse): Response {
  if (status === 204) return new Response(null, { status, headers });
  const isString = typeof body === 'string';
  return new Response(body === undefined ? '' : isString ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': isString ? 'text/plain' : 'application/json', ...headers },
  });
}

export const apiError = (status: number, code: string, message = code) => ({
  status,
  body: { error: { code, message } },
});

/**
 * Replaces `fetch` with a router of mock responses (the network boundary). Unmatched requests
 * return a 404 `NOT_FOUND` error body and are recorded in `unmatched`.
 */
export function installFetchMock(initialRoutes: MockRoute[] = []) {
  const routes: MockRoute[] = [...initialRoutes];
  const calls: RecordedCall[] = [];
  const unmatched: RecordedCall[] = [];
  const counters = new Map<MockRoute, number>();

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(rawUrl, 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* keep text */
      }
    }
    const call: RecordedCall = {
      method,
      url: rawUrl,
      path: url.pathname.replace(/^\/api/, ''),
      query: url.searchParams,
      headers: new Headers(init?.headers),
      body,
    };
    calls.push(call);
    const route = routes.find(
      (r) => r.method === method && (typeof r.path === 'string' ? r.path === call.path : r.path.test(call.path)),
    );
    if (!route) {
      unmatched.push(call);
      return toResponse(apiError(404, 'NOT_FOUND', `No mock for ${method} ${call.path}`));
    }
    const index = counters.get(route) ?? 0;
    counters.set(route, index + 1);
    const result = typeof route.respond === 'function' ? await route.respond(call, index) : route.respond;
    return toResponse(result);
  });

  vi.stubGlobal('fetch', fetchMock);

  return {
    fetchMock,
    calls,
    unmatched,
    /** Adds routes with priority over existing ones. */
    use(...extra: MockRoute[]) {
      routes.unshift(...extra);
    },
    callsTo(method: string, path: string | RegExp) {
      return calls.filter((c) => c.method === method && (typeof path === 'string' ? c.path === path : path.test(c.path)));
    },
  };
}

export type FetchMock = ReturnType<typeof installFetchMock>;
