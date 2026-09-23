import { describe, expect, it, vi } from 'vitest';
import { clearShareToken, getShareToken, setShareToken } from './share-token';

describe('share-token storage', () => {
  it('stores tokens per board in sessionStorage', () => {
    setShareToken('b1', 'token-1');
    setShareToken('b2', 'token-2');
    expect(getShareToken('b1')).toBe('token-1');
    expect(getShareToken('b2')).toBe('token-2');
    expect(window.sessionStorage.getItem('inkflow:share-token:b1')).toBe('token-1');
    expect(window.localStorage.length).toBe(0);
  });

  it('returns null for unknown boards and after clearing', () => {
    expect(getShareToken('nope')).toBeNull();
    setShareToken('b1', 'token-1');
    clearShareToken('b1');
    expect(getShareToken('b1')).toBeNull();
  });

  it('degrades gracefully when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(() => setShareToken('b1', 'x')).not.toThrow();
    expect(getShareToken('b1')).toBeNull();
    expect(() => clearShareToken('b1')).not.toThrow();
    spy.mockRestore();
    setSpy.mockRestore();
  });
});
