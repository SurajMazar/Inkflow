import { describe, expect, it } from 'vitest';
import { generateKeyBetween, generateNKeysBetween, isValidOrderKey } from '../src';

describe('fractional indexing', () => {
  it('generates keys between bounds', () => {
    const a = generateKeyBetween(null, null);
    const b = generateKeyBetween(a, null);
    const mid = generateKeyBetween(a, b);
    expect(a < mid && mid < b).toBe(true);
    const before = generateKeyBetween(null, a);
    expect(before < a).toBe(true);
  });

  it('supports many successive insertions at the same spot', () => {
    let lo = generateKeyBetween(null, null);
    const hi = generateKeyBetween(lo, null);
    for (let i = 0; i < 200; i++) {
      const k = generateKeyBetween(lo, hi);
      expect(k > lo && k < hi).toBe(true);
      expect(isValidOrderKey(k)).toBe(true);
      lo = k;
    }
  });

  it('generates n sorted keys', () => {
    const keys = generateNKeysBetween('a0', 'a5', 25);
    expect(keys).toHaveLength(25);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(25);
    expect(keys[0]! > 'a0' && keys[24]! < 'a5').toBe(true);
  });

  it('rejects invalid ranges', () => {
    expect(() => generateKeyBetween('a5', 'a1')).toThrow();
  });
});
