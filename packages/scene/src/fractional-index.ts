/**
 * Fractional indexing (base-62 order keys). Keys compare correctly with plain string
 * comparison (code-unit order, i.e. PostgreSQL `COLLATE "C"`), and a key can always be
 * generated between any two keys, so concurrent reorders never require renumbering.
 * Algorithm after David Greenspan / rocicorp "fractional-indexing".
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0]!;
const SMALLEST_INTEGER = 'A' + ZERO.repeat(26);

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`fractional index: ${a} >= ${b}`);
  if (a.slice(-1) === ZERO || (b && b.slice(-1) === ZERO)) throw new Error('fractional index: trailing zero');
  if (b) {
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (digitB - digitA > 1) {
    return DIGITS[Math.round(0.5 * (digitA + digitB))]!;
  }
  if (b && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error(`fractional index: invalid head ${head}`);
}

function integerPart(key: string): string {
  const len = integerLength(key[0]!);
  if (len > key.length) throw new Error(`fractional index: invalid key ${key}`);
  return key.slice(0, len);
}

export function isValidOrderKey(key: string): boolean {
  try {
    validateOrderKey(key);
    return true;
  } catch {
    return false;
  }
}

function validateOrderKey(key: string): void {
  if (key === SMALLEST_INTEGER) throw new Error(`fractional index: invalid key ${key}`);
  if (!/^[0-9A-Za-z]+$/.test(key)) throw new Error(`fractional index: invalid characters in ${key}`);
  const i = integerPart(key);
  const f = key.slice(i.length);
  if (f.slice(-1) === ZERO) throw new Error(`fractional index: trailing zero in ${key}`);
}

function incrementInteger(x: string): string | null {
  const [head, ...digs] = x.split('') as [string, ...string[]];
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]!) + 1;
    if (d === DIGITS.length) {
      digs[i] = ZERO;
    } else {
      digs[i] = DIGITS[d]!;
      carry = false;
    }
  }
  if (carry) {
    if (head === 'Z') return 'a' + ZERO;
    if (head === 'z') return null;
    const h = String.fromCharCode(head.charCodeAt(0) + 1);
    if (h > 'a') digs.push(ZERO);
    else digs.pop();
    return h + digs.join('');
  }
  return head + digs.join('');
}

function decrementInteger(x: string): string | null {
  const [head, ...digs] = x.split('') as [string, ...string[]];
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]!) - 1;
    if (d === -1) {
      digs[i] = DIGITS.slice(-1);
    } else {
      digs[i] = DIGITS[d]!;
      borrow = false;
    }
  }
  if (borrow) {
    if (head === 'a') return 'Z' + DIGITS.slice(-1);
    if (head === 'A') return null;
    const h = String.fromCharCode(head.charCodeAt(0) - 1);
    if (h < 'Z') digs.push(DIGITS.slice(-1));
    else digs.pop();
    return h + digs.join('');
  }
  return head + digs.join('');
}

/** Generates a key strictly between `a` and `b` (either may be null for open ends). */
export function generateKeyBetween(a: string | null, b: string | null): string {
  if (a !== null) validateOrderKey(a);
  if (b !== null) validateOrderKey(b);
  if (a !== null && b !== null && a >= b) throw new Error(`fractional index: ${a} >= ${b}`);
  if (a === null) {
    if (b === null) return 'a' + ZERO;
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb);
    if (ib < b) return ib;
    const res = decrementInteger(ib);
    if (res === null) throw new Error('fractional index: cannot decrement');
    return res;
  }
  if (b === null) {
    const ia = integerPart(a);
    const fa = a.slice(ia.length);
    const i = incrementInteger(ia);
    return i === null ? ia + midpoint(fa, null) : i;
  }
  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i === null) throw new Error('fractional index: cannot increment');
  if (i < b) return i;
  return ia + midpoint(fa, null);
}

/** Generates `n` ordered keys strictly between `a` and `b`. */
export function generateNKeysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [generateKeyBetween(a, b)];
  if (b === null) {
    let c = generateKeyBetween(a, b);
    const result = [c];
    for (let i = 0; i < n - 1; i++) {
      c = generateKeyBetween(c, b);
      result.push(c);
    }
    return result;
  }
  if (a === null) {
    let c = generateKeyBetween(a, b);
    const result = [c];
    for (let i = 0; i < n - 1; i++) {
      c = generateKeyBetween(a, c);
      result.push(c);
    }
    return result.reverse();
  }
  const mid = Math.floor(n / 2);
  const c = generateKeyBetween(a, b);
  return [...generateNKeysBetween(a, c, mid), c, ...generateNKeysBetween(c, b, n - mid - 1)];
}

/** Total order used everywhere elements are sorted: by index, then id as a tie-breaker. */
export function compareOrder(a: { index: string; id: string }, b: { index: string; id: string }): number {
  if (a.index < b.index) return -1;
  if (a.index > b.index) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
