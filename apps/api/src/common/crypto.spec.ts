import { describe, expect, it } from 'vitest';
import {
  decryptString,
  deriveKey,
  encryptString,
  pkceChallenge,
  randomToken,
  safeEqual,
  sha256Hex,
  signPayload,
  verifySignedPayload,
} from './crypto';

describe('crypto helpers', () => {
  it('hashes tokens with SHA-256 hex', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abc')).toHaveLength(64);
  });

  it('generates URL-safe random tokens of the requested entropy', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(16)).toHaveLength(22);
  });

  it('compares strings in constant time', () => {
    expect(safeEqual('same', 'same')).toBe(true);
    expect(safeEqual('same', 'diff')).toBe(false);
    expect(safeEqual('short', 'longer-value')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('derives distinct keys per purpose', () => {
    const secret = 'x'.repeat(40);
    expect(deriveKey(secret, 'a')).toHaveLength(32);
    expect(deriveKey(secret, 'a').equals(deriveKey(secret, 'a'))).toBe(true);
    expect(deriveKey(secret, 'a').equals(deriveKey(secret, 'b'))).toBe(false);
  });

  it('encrypts with AES-256-GCM and detects tampering or wrong keys', () => {
    const key = deriveKey('s'.repeat(40), 'share');
    const ct = encryptString(key, 'secret-token');
    expect(ct.startsWith('v1.')).toBe(true);
    expect(ct).not.toContain('secret-token');
    expect(encryptString(key, 'secret-token')).not.toBe(ct); // random IV
    expect(decryptString(key, ct)).toBe('secret-token');
    const parts = ct.split('.');
    const tampered = [...parts.slice(0, 3), Buffer.from('other').toString('base64url')].join('.');
    expect(decryptString(key, tampered)).toBeNull();
    expect(decryptString(deriveKey('t'.repeat(40), 'share'), ct)).toBeNull();
    expect(decryptString(key, 'garbage')).toBeNull();
  });

  it('signs and verifies payloads', () => {
    const key = deriveKey('k'.repeat(40), 'state');
    const signed = signPayload(key, { state: 'abc', n: 1 });
    expect(verifySignedPayload(key, signed)).toEqual({ state: 'abc', n: 1 });
    expect(verifySignedPayload(key, `${signed}x`)).toBeNull();
    expect(verifySignedPayload(key, signed.replace(/^./, 'A'))).toBeNull();
    expect(verifySignedPayload(key, undefined)).toBeNull();
  });

  it('computes RFC 7636 S256 challenges', () => {
    // Example from RFC 7636 appendix B.
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
