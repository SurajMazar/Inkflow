import type { CookieOptions } from 'express';
import type { ApiEnv } from '@inkflow/config';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '@inkflow/shared';

export { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE };
export const OAUTH_STATE_COOKIE = 'inkflow_oauth';

/** Path the refresh cookie is scoped to, so it is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/auth';
export const OAUTH_COOKIE_PATH = '/api/auth/oauth';
export const OAUTH_STATE_TTL_SECONDS = 600;

export type CookieKind = 'access' | 'refresh' | 'csrf' | 'oauth';

type CookieEnv = Pick<
  ApiEnv,
  'COOKIE_SECURE' | 'COOKIE_DOMAIN' | 'ACCESS_TOKEN_TTL_SECONDS' | 'REFRESH_TOKEN_TTL_DAYS'
>;

/** Options used when setting each cookie. */
export function cookieOptions(env: CookieEnv, kind: CookieKind): CookieOptions {
  const base: CookieOptions = {
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
  switch (kind) {
    case 'access':
      return { ...base, httpOnly: true, path: '/', maxAge: env.ACCESS_TOKEN_TTL_SECONDS * 1000 };
    case 'refresh':
      return {
        ...base,
        httpOnly: true,
        path: REFRESH_COOKIE_PATH,
        maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
      };
    case 'csrf':
      // Readable by the web app (double-submit); it carries no authority on its own.
      return {
        ...base,
        httpOnly: false,
        path: '/',
        maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
      };
    case 'oauth':
      return {
        ...base,
        httpOnly: true,
        path: OAUTH_COOKIE_PATH,
        maxAge: OAUTH_STATE_TTL_SECONDS * 1000,
      };
  }
}

/** Options for clearing a cookie (must match path/domain of the original). */
export function clearCookieOptions(env: CookieEnv, kind: CookieKind): CookieOptions {
  const { maxAge: _maxAge, ...rest } = cookieOptions(env, kind);
  return rest;
}

/** Minimal RFC 6265 cookie header parser (used for WebSocket upgrades). */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!name || name in out) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}
