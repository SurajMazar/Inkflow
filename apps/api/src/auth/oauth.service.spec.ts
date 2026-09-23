import { describe, expect, it } from 'vitest';
import { parseApiEnv } from '@inkflow/config';
import { AppConfig } from '../config/app-config';
import { pkceChallenge, verifySignedPayload, deriveKey } from '../common/crypto';
import { AppError } from '../common/errors';
import { OAuthService, type OAuthStateCookie } from './oauth.service';

const env = parseApiEnv({
  DATABASE_URL: 'postgresql://x',
  JWT_SECRET: 'j'.repeat(40),
  SESSION_SECRET: 's'.repeat(40),
  S3_ACCESS_KEY: 'a',
  S3_SECRET_KEY: 'b',
  PUBLIC_API_URL: 'https://app.test/api',
  GOOGLE_CLIENT_ID: 'google-id',
  GOOGLE_CLIENT_SECRET: 'google-secret',
});

function service() {
  return new OAuthService(new AppConfig(env), {} as never, {} as never, {} as never);
}

describe('OAuthService', () => {
  it('reports configuration per provider', () => {
    const oauth = service();
    expect(oauth.isConfigured('google')).toBe(true);
    expect(oauth.isConfigured('github')).toBe(false);
    expect(() => oauth.begin('github', '/')).toThrow(AppError);
  });

  it('builds an authorization URL with state and a PKCE S256 challenge', () => {
    const { url, cookie } = service().begin('google', '/boards/1');
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(parsed.searchParams.get('client_id')).toBe('google-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.test/api/auth/oauth/google/callback');
    expect(parsed.searchParams.get('scope')).toBe('openid email profile');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    const state = verifySignedPayload<OAuthStateCookie>(deriveKey(env.SESSION_SECRET, 'oauth-state'), cookie)!;
    expect(state).toMatchObject({ provider: 'google', next: '/boards/1' });
    expect(parsed.searchParams.get('state')).toBe(state.state);
    expect(parsed.searchParams.get('code_challenge')).toBe(pkceChallenge(state.verifier));
  });

  it('validates the callback state against the signed cookie', () => {
    const oauth = service();
    const { url, cookie } = oauth.begin('google', 'https://evil.example');
    const state = new URL(url).searchParams.get('state')!;
    expect(oauth.verifyState('google', cookie, state).next).toBe('/');
    expect(() => oauth.verifyState('google', cookie, 'forged')).toThrow(/state/);
    expect(() => oauth.verifyState('github', cookie, state)).toThrow();
    expect(() => oauth.verifyState('google', `${cookie}x`, state)).toThrow();
    expect(() => oauth.verifyState('google', undefined, state)).toThrow();
  });
});
