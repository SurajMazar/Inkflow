import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisService } from '../src/redis/redis.service';
import { startApp, TestClient, uniqueEmail, type TestApp } from './helpers';

let t: TestApp;

beforeAll(async () => {
  t = await startApp({ AUTH_RATE_LIMIT_MAX: '5', RATE_LIMIT_WINDOW_SECONDS: '60' });
  // Other test files share the Redis database: start from clean counters.
  const redis = t.app.get(RedisService).client;
  const keys = await redis.keys('inkflow:rl:*');
  if (keys.length > 0) await redis.del(...keys);
});
afterAll(async () => {
  await t?.close();
});

describe('rate limiting', () => {
  it('limits login attempts per IP and answers 429 with Retry-After', async () => {
    const client = new TestClient(t.url);
    const statuses: number[] = [];
    let limited: { headers: Record<string, unknown>; body: unknown } | null = null;
    for (let i = 0; i < 8; i++) {
      const res = await client.post('/api/auth/login', {
        email: uniqueEmail('rl'),
        password: 'wrong-password-1',
      });
      statuses.push(res.status);
      if (res.status === 429 && !limited) limited = res;
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(5).every((s) => s === 429)).toBe(true);
    expect(limited).not.toBeNull();
    expect(Number(limited!.headers['retry-after'])).toBeGreaterThan(0);
    expect((limited!.body as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });

  it('limits attempts per email address independently of the route limit', async () => {
    // Per-email limit = max(3, ceil(5/2)) = 3; use a separate route (forgot-password) whose IP bucket is fresh.
    const client = new TestClient(t.url);
    const email = uniqueEmail('rl-email');
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++)
      statuses.push((await client.post('/api/auth/forgot-password', { email })).status);
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses[3]).toBe(429);
  });

  it('does not rate-limit health checks', async () => {
    const client = new TestClient(t.url);
    for (let i = 0; i < 10; i++) expect((await client.get('/api/health')).status).toBe(200);
  });
});
