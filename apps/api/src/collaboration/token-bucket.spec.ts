import { describe, expect, it } from 'vitest';
import { TokenBucket } from './token-bucket';

describe('TokenBucket', () => {
  it('allows bursts up to capacity and refills over time', () => {
    let now = 0;
    const bucket = new TokenBucket(3, 2, () => now);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    now += 500; // +1 token
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    now += 10_000;
    expect(bucket.available).toBe(3);
  });
});
