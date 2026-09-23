import { describe, expect, it } from 'vitest';
import { hashPassword, verifyDummyPassword, verifyPassword } from './passwords';

describe('password hashing', () => {
  it('uses argon2id and verifies correctly', async () => {
    const hash = await hashPassword('correct-horse-42');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('correct-horse-42');
    expect(await verifyPassword(hash, 'correct-horse-42')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
    expect(await verifyDummyPassword('anything')).toBe(false);
  });
});
