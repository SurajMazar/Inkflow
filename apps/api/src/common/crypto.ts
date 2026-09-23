import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** SHA-256 of a string as lowercase hex (64 chars). Used to store tokens at rest. */
export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Cryptographically random, URL-safe token (default 32 bytes → 43 chars). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Constant-time string comparison (false for different lengths without leaking content). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still spend comparable time so length mismatches are not trivially distinguishable.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Derives a 32-byte subkey from a master secret for a specific purpose (HKDF-SHA256). */
export function deriveKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from('inkflow', 'utf8'), purpose, 32));
}

export function hmacSha256(key: Buffer | string, value: string): string {
  return createHmac('sha256', key).update(value).digest('base64url');
}

const CIPHER_VERSION = 'v1';

/** AES-256-GCM encryption; output `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encryptString(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [CIPHER_VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/** Decrypts `encryptString` output; returns null when tampered with or encrypted with another key. */
export function decryptString(key: Buffer, payload: string): string | null {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== CIPHER_VERSION) return null;
  try {
    const iv = Buffer.from(parts[1]!, 'base64url');
    const tag = Buffer.from(parts[2]!, 'base64url');
    const ciphertext = Buffer.from(parts[3]!, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Signs a JSON payload: `<base64url(json)>.<hmac>`. */
export function signPayload(key: Buffer, payload: unknown): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${hmacSha256(key, body)}`;
}

/** Verifies `signPayload` output and returns the parsed payload, or null. */
export function verifySignedPayload<T>(key: Buffer, value: string | undefined | null): T | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!safeEqual(signature, hmacSha256(key, body))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

/** PKCE (RFC 7636) S256 code challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
