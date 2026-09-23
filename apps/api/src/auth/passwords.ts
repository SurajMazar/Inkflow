import { hash, verify, type Algorithm } from '@node-rs/argon2';

/** argon2id (the `Algorithm` const enum cannot be referenced at runtime from a declaration file). */
const ARGON2ID = 2 as Algorithm;

/** OWASP-recommended argon2id parameters (19 MiB, t=2, p=1). */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Burns the same amount of work as a real verification, so responses for unknown emails and
 * OAuth-only accounts are indistinguishable by timing.
 */
export async function verifyDummyPassword(password: string): Promise<false> {
  dummyHash ??= hashPassword('inkflow-dummy-password-for-timing-equalization');
  await verifyPassword(await dummyHash, password);
  return false;
}
