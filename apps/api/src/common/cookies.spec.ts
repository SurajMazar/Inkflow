import { describe, expect, it } from 'vitest';
import { clearCookieOptions, cookieOptions, parseCookieHeader } from './cookies';

const env = { COOKIE_SECURE: false, COOKIE_DOMAIN: undefined, ACCESS_TOKEN_TTL_SECONDS: 900, REFRESH_TOKEN_TTL_DAYS: 30 };

describe('cookie options', () => {
  it('scopes the access, refresh, CSRF and OAuth cookies', () => {
    expect(cookieOptions(env, 'access')).toEqual({ secure: false, sameSite: 'lax', httpOnly: true, path: '/', maxAge: 900_000 });
    expect(cookieOptions(env, 'refresh')).toMatchObject({ httpOnly: true, path: '/api/auth', maxAge: 30 * 86_400_000 });
    expect(cookieOptions(env, 'csrf')).toMatchObject({ httpOnly: false, path: '/' });
    expect(cookieOptions(env, 'oauth')).toMatchObject({ httpOnly: true, path: '/api/auth/oauth', maxAge: 600_000 });
  });

  it('honours COOKIE_SECURE and COOKIE_DOMAIN', () => {
    const prod = { ...env, COOKIE_SECURE: true, COOKIE_DOMAIN: 'inkflow.app' };
    expect(cookieOptions(prod, 'access')).toMatchObject({ secure: true, domain: 'inkflow.app', sameSite: 'lax' });
    expect(clearCookieOptions(prod, 'refresh')).toEqual({ secure: true, sameSite: 'lax', domain: 'inkflow.app', httpOnly: true, path: '/api/auth' });
  });

  it('parses cookie headers', () => {
    expect(parseCookieHeader('a=1; b=hello%20world; c="quoted"; a=ignored')).toEqual({ a: '1', b: 'hello world', c: 'quoted' });
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader('broken; =x; ok=1')).toEqual({ ok: '1' });
  });
});
