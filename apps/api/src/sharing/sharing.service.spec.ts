import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../common/crypto';
import { ShareLinkCipher } from './sharing.service';

describe('share link tokens', () => {
  it('stores only a hash and an AES-GCM ciphertext that the server can reveal', () => {
    const cipher = new ShareLinkCipher('session-secret-'.repeat(3));
    const issued = cipher.issue();
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.tokenHash).toBe(sha256Hex(issued.token));
    expect(issued.ciphertext).not.toContain(issued.token);
    expect(cipher.reveal(issued.ciphertext)).toBe(issued.token);
  });

  it('cannot be revealed with another SESSION_SECRET', () => {
    const issued = new ShareLinkCipher('a'.repeat(40)).issue();
    expect(new ShareLinkCipher('b'.repeat(40)).reveal(issued.ciphertext)).toBeNull();
  });
});
