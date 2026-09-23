const ALPHABET = 'useandom26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict';

function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('Secure random number generator is not available in this environment');
  }
  return c;
}

/** URL-safe, collision-resistant random identifier (≈126 bits of entropy at the default size). */
export function generateId(size = 21): string {
  const bytes = new Uint8Array(size);
  getCrypto().getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < size; i++) {
    id += ALPHABET[bytes[i]! & 63];
  }
  return id;
}

/** Random 31-bit positive integer, used for element seeds and version nonces. */
export function randomInteger(): number {
  const buf = new Uint32Array(1);
  getCrypto().getRandomValues(buf);
  return (buf[0]! >>> 1) || 1;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
