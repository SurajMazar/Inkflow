/**
 * Low-level HTTP client for the Inkflow API.
 *
 * - Sends cookies (`credentials: 'include'`) and the double-submit CSRF header on every non-GET
 *   request (token read from the `inkflow_csrf` cookie, or fetched from `GET /auth/csrf`).
 * - On `401 UNAUTHORIZED | SESSION_EXPIRED` it performs a single-flight `POST /auth/refresh` and
 *   retries the request once. When the refresh is rejected the session is considered over and
 *   `onSessionExpired` listeners are notified (the auth provider signs the user out).
 * - Every failure is an `ApiError`; network failures map to `SERVICE_UNAVAILABLE`.
 */
import {
  ApiError,
  CSRF_COOKIE,
  CSRF_HEADER,
  SHARE_TOKEN_HEADER,
  isApiErrorBody,
  type AuthResponse,
  type CsrfResponse,
  type ErrorCode,
  type UserDto,
} from '@inkflow/shared';

const envBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
/** Base URL of the API (defaults to the same-origin `/api` prefix proxied by Vite / nginx). */
export const API_BASE_URL: string = envBase ? envBase.replace(/\/+$/, '') : '/api';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type QueryPrimitive = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryPrimitive | readonly QueryPrimitive[]>;

/** Options accepted by every endpoint helper. */
export interface CallOptions {
  /** Share-link token granting access to a board (sent as `x-share-token`). */
  shareToken?: string | null;
  signal?: AbortSignal;
}

export interface RequestOptions extends CallOptions {
  /** JSON body (serialized with `JSON.stringify`). */
  body?: unknown;
  query?: QueryParams;
  /** Multipart body; takes precedence over `body`. */
  formData?: FormData;
  headers?: Record<string, string>;
  /** Expected response type (default: JSON, `undefined` for empty responses). */
  responseType?: 'json' | 'blob' | 'text';
  /** Disable the automatic refresh-and-retry on 401 (used by auth endpoints). */
  skipAuthRefresh?: boolean;
}

export const NETWORK_ERROR_MESSAGE =
  "Can't reach Inkflow right now. Check your connection and try again.";

/* ───────────────────────────── session state ───────────────────────────── */

type SessionState = 'unknown' | 'active' | 'none';
let sessionState: SessionState = 'unknown';

type ExpiredListener = () => void;
type RefreshedListener = (user: UserDto) => void;
const expiredListeners = new Set<ExpiredListener>();
const refreshedListeners = new Set<RefreshedListener>();

/** Subscribe to "the session is gone" (refresh rejected). Returns an unsubscribe function. */
export function onSessionExpired(listener: ExpiredListener): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

/** Subscribe to successful token refreshes (receives the fresh user). */
export function onSessionRefreshed(listener: RefreshedListener): () => void {
  refreshedListeners.add(listener);
  return () => refreshedListeners.delete(listener);
}

/** Records that the browser holds a valid session (after login, register, verify, me…). */
export function markSessionActive(): void {
  sessionState = 'active';
  // Sign-in re-issues the CSRF cookie; drop a cached token that the browser can't read back.
  if (!readCsrfCookie()) csrfToken = null;
}

/** Records that there is no session (after logout); 401s will no longer trigger refreshes. */
export function markSessionEnded(): void {
  sessionState = 'none';
}

function notifySessionExpired(): void {
  sessionState = 'none';
  for (const listener of [...expiredListeners]) {
    try {
      listener();
    } catch (error) {
      console.error('[api] session-expired listener failed', error);
    }
  }
}

/* ───────────────────────────────── CSRF ───────────────────────────────── */

let csrfToken: string | null = null;
let csrfPromise: Promise<string | null> | null = null;

/** Reads the readable CSRF cookie set by the API. */
export function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${CSRF_COOKIE}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length);
      try {
        return decodeURIComponent(value) || null;
      } catch {
        return value || null;
      }
    }
  }
  return null;
}

/** Current CSRF token (cookie first — it is the source of truth for the double submit). */
export function getCsrfToken(): string | null {
  return readCsrfCookie() ?? csrfToken;
}

/**
 * Returns a CSRF token, fetching one from `GET /auth/csrf` when none is known (or when `force`).
 * Concurrent callers share one request.
 */
export function ensureCsrfToken(force = false): Promise<string | null> {
  if (!force) {
    const known = getCsrfToken();
    if (known) return Promise.resolve(known);
  }
  if (csrfPromise) return csrfPromise;
  const promise = (async (): Promise<string | null> => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/csrf`, {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return getCsrfToken();
      const data = (await res.json()) as CsrfResponse;
      csrfToken = data.csrfToken;
      return readCsrfCookie() ?? data.csrfToken;
    } catch {
      return getCsrfToken();
    }
  })();
  csrfPromise = promise;
  void promise.finally(() => {
    if (csrfPromise === promise) csrfPromise = null;
  });
  return promise;
}

/* ─────────────────────────────── refresh ─────────────────────────────── */

export type RefreshOutcome = 'ok' | 'expired' | 'network';
let refreshPromise: Promise<RefreshOutcome> | null = null;

/**
 * Single-flight `POST /auth/refresh`. Resolves `ok` (new cookies set), `expired` (refresh token
 * rejected — the user must sign in again) or `network` (API unreachable; session untouched).
 */
export function refreshSession(): Promise<RefreshOutcome> {
  if (refreshPromise) return refreshPromise;
  const promise = (async (): Promise<RefreshOutcome> => {
    try {
      const csrf = await ensureCsrfToken();
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { accept: 'application/json', ...(csrf ? { [CSRF_HEADER]: csrf } : {}) },
      });
      if (res.status >= 500 || res.status === 429) return 'network';
      if (!res.ok) return 'expired';
      markSessionActive();
      const data = (await safeJson(res)) as AuthResponse | undefined;
      if (data?.user) {
        for (const listener of [...refreshedListeners]) listener(data.user);
      }
      return 'ok';
    } catch {
      return 'network';
    }
  })();
  refreshPromise = promise;
  void promise.finally(() => {
    if (refreshPromise === promise) refreshPromise = null;
  });
  return promise;
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

/** Auth endpoints where a 401 means "bad credentials", never "refresh and retry". */
const NO_REFRESH_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
  '/auth/csrf',
  '/auth/providers',
  '/auth/verify-email',
  '/auth/resend-verification',
  '/auth/forgot-password',
  '/auth/reset-password',
];

export function buildUrl(path: string, query?: QueryParams): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  let url = `${API_BASE_URL}${normalized}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values as QueryPrimitive[]) {
        if (v === undefined || v === null || v === '') continue;
        params.append(key, String(v));
      }
    }
    const qs = params.toString();
    if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`;
  }
  return url;
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  410: 'NOT_FOUND',
  422: 'VALIDATION_FAILED',
  502: 'SERVICE_UNAVAILABLE',
  503: 'SERVICE_UNAVAILABLE',
  504: 'SERVICE_UNAVAILABLE',
};

export function codeForStatus(status: number): ErrorCode {
  return STATUS_CODES[status] ?? 'INTERNAL';
}

export function networkError(cause?: unknown): ApiError {
  const error = new ApiError(0, 'SERVICE_UNAVAILABLE', NETWORK_ERROR_MESSAGE);
  if (cause !== undefined) (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

/** Builds an `ApiError` from a status and a (possibly non-standard) response body. */
export function toApiError(status: number, body: unknown, retryAfter?: string | null): ApiError {
  const retryAfterSeconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
  if (isApiErrorBody(body)) {
    const details =
      body.error.details === undefined && Number.isFinite(retryAfterSeconds)
        ? { retryAfterSeconds }
        : body.error.details;
    return new ApiError(status, body.error.code, body.error.message, details);
  }
  const code = codeForStatus(status);
  const message =
    typeof body === 'string' &&
    body.length > 0 &&
    body.length < 300 &&
    !body.trimStart().startsWith('<')
      ? body
      : `Request failed (${status})`;
  return new ApiError(
    status,
    code,
    message,
    Number.isFinite(retryAfterSeconds) ? { retryAfterSeconds } : undefined,
  );
}

/** Seconds to wait before retrying a rate-limited request, when the server said so. */
export function retryAfterSeconds(error: ApiError): number | null {
  const details = error.details as { retryAfterSeconds?: unknown } | undefined;
  return details && typeof details.retryAfterSeconds === 'number'
    ? details.retryAfterSeconds
    : null;
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function isMutating(method: HttpMethod): boolean {
  return method !== 'GET';
}

/** Whether a 401 for this path should trigger a refresh-and-retry. */
export function shouldRefreshOn401(path: string, code: ErrorCode | undefined): boolean {
  if (NO_REFRESH_PATHS.some((p) => path === p || path.startsWith(`${p}?`))) return false;
  if (sessionState === 'none') return false;
  return code === undefined || code === 'UNAUTHORIZED' || code === 'SESSION_EXPIRED';
}

/**
 * Handles a 401 on a request that may be retried: refreshes the session once.
 * Returns `true` when the caller should retry, otherwise throws/returns false.
 */
export async function recoverFrom401(): Promise<boolean> {
  const outcome = await refreshSession();
  if (outcome === 'ok') return true;
  if (outcome === 'network') throw networkError();
  notifySessionExpired();
  return false;
}

/* ─────────────────────────────── request ─────────────────────────────── */

/**
 * Performs an API request and resolves with the typed response body.
 *
 * @example
 *   const boards = await request<BoardSummaryDto[]>('GET', '/boards', { query: { filter: 'recent' } });
 */
export async function request<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  return send<T>(method, path, options, { refreshed: false, csrfRetried: false });
}

interface Attempt {
  refreshed: boolean;
  csrfRetried: boolean;
}

async function send<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions,
  attempt: Attempt,
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (isMutating(method)) {
    const csrf = await ensureCsrfToken();
    if (csrf) headers[CSRF_HEADER] = csrf;
  }
  if (options.shareToken) headers[SHARE_TOKEN_HEADER] = options.shareToken;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) throw error;
    throw networkError(error);
  }

  if (!res.ok) {
    const payload = await safeJson(res).catch(() => undefined);
    const error = toApiError(res.status, payload, res.headers.get('retry-after'));

    const refreshable =
      res.status === 401 &&
      !options.skipAuthRefresh &&
      !attempt.refreshed &&
      shouldRefreshOn401(path, isApiErrorBody(payload) ? error.code : undefined);
    if (refreshable) {
      if (await recoverFrom401())
        return send<T>(method, path, options, { ...attempt, refreshed: true });
      throw error;
    }
    if (res.status === 403 && error.code === 'CSRF_INVALID' && !attempt.csrfRetried) {
      await ensureCsrfToken(true);
      return send<T>(method, path, options, { ...attempt, csrfRetried: true });
    }
    throw error;
  }

  if (res.status === 204 || res.status === 205) return undefined as T;
  if (options.responseType === 'blob') return (await res.blob()) as T;
  if (options.responseType === 'text') return (await res.text()) as T;
  return (await safeJson(res)) as T;
}

/** Test helper: resets module state (CSRF cache, session state, pending refresh). */
export function __resetClientStateForTests(): void {
  csrfToken = null;
  csrfPromise = null;
  refreshPromise = null;
  sessionState = 'unknown';
  expiredListeners.clear();
  refreshedListeners.clear();
}
