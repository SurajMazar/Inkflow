import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { parseApiEnv } from '@inkflow/config';
import { AppConfig } from '../config/app-config';
import type { RedisService } from '../redis/redis.service';
import { TokensService } from './tokens.service';

const env = parseApiEnv({
  DATABASE_URL: 'postgresql://x',
  JWT_SECRET: 'j'.repeat(40),
  SESSION_SECRET: 's'.repeat(40),
  S3_ACCESS_KEY: 'a',
  S3_SECRET_KEY: 'b',
  ACCESS_TOKEN_TTL_SECONDS: '900',
});

function fakeRedis() {
  const store = new Map<string, string>();
  const client = {
    exists: async (key: string) => (store.has(key) ? 1 : 0),
    pipeline: () => {
      const ops: [string, string][] = [];
      const p = {
        set: (k: string, v: string) => {
          ops.push([k, v]);
          return p;
        },
        exec: async () => ops.map(([k, v]) => store.set(k, v)),
      };
      return p;
    },
  };
  return { client } as unknown as RedisService;
}

describe('TokensService', () => {
  const tokens = new TokensService(new AppConfig(env), fakeRedis());

  it('signs and verifies HS256 access tokens', () => {
    const token = tokens.signAccessToken('user-1', 'session-1');
    expect(jwt.decode(token, { complete: true })?.header.alg).toBe('HS256');
    expect(tokens.verifyAccessToken(token)).toEqual({ status: 'valid', claims: { sub: 'user-1', sid: 'session-1' } });
  });

  it('rejects expired, foreign and tampered tokens', () => {
    const expired = jwt.sign({ sid: 's', typ: 'access' }, env.JWT_SECRET, {
      subject: 'u',
      issuer: 'inkflow',
      audience: 'inkflow-api',
      expiresIn: -10,
    });
    expect(tokens.verifyAccessToken(expired).status).toBe('expired');
    const foreign = jwt.sign({ sid: 's', typ: 'access' }, 'another-secret-another-secret-another', { subject: 'u', issuer: 'inkflow', audience: 'inkflow-api' });
    expect(tokens.verifyAccessToken(foreign).status).toBe('invalid');
    const none = jwt.sign({ sid: 's', typ: 'access', sub: 'u', iss: 'inkflow', aud: 'inkflow-api' }, '', { algorithm: 'none' });
    expect(tokens.verifyAccessToken(none).status).toBe('invalid');
    const wrongType = jwt.sign({ sid: 's', typ: 'refresh' }, env.JWT_SECRET, { subject: 'u', issuer: 'inkflow', audience: 'inkflow-api' });
    expect(tokens.verifyAccessToken(wrongType).status).toBe('invalid');
  });

  it('issues signed CSRF tokens', () => {
    const token = tokens.createCsrfToken();
    expect(tokens.isValidCsrfToken(token)).toBe(true);
    expect(tokens.isValidCsrfToken(`${token}x`)).toBe(false);
    expect(tokens.isValidCsrfToken('abc.def')).toBe(false);
    expect(tokens.isValidCsrfToken(undefined)).toBe(false);
  });

  it('tracks revoked sessions', async () => {
    expect(await tokens.isSessionRevoked('fam-1')).toBe(false);
    await tokens.markSessionsRevoked(['fam-1']);
    expect(await tokens.isSessionRevoked('fam-1')).toBe(true);
  });
});
