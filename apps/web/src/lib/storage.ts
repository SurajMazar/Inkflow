/**
 * Exception-safe wrappers around Web Storage. Storage can be unavailable (private mode, disabled
 * cookies, sandboxed iframes) — every access is guarded and failures degrade to "no value".
 */
type StorageKind = 'local' | 'session';

function getStorage(kind: StorageKind): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStorage(key: string, kind: StorageKind = 'local'): string | null {
  try {
    return getStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string, kind: StorageKind = 'local'): void {
  try {
    getStorage(kind)?.setItem(key, value);
  } catch {
    /* quota exceeded or unavailable */
  }
}

export function removeStorage(key: string, kind: StorageKind = 'local'): void {
  try {
    getStorage(kind)?.removeItem(key);
  } catch {
    /* unavailable */
  }
}

export function readJson<T>(key: string, kind: StorageKind = 'local'): T | null {
  const raw = readStorage(key, kind);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown, kind: StorageKind = 'local'): void {
  writeStorage(key, JSON.stringify(value), kind);
}

/** Storage keys used by the web app (kept in one place to avoid collisions). */
export const STORAGE_KEYS = {
  appearance: 'inkflow:appearance',
  anonymousPreferences: 'inkflow:preferences',
  lastWorkspace: 'inkflow:last-workspace',
  boardViewMode: 'inkflow:board-view-mode',
  shareTokenPrefix: 'inkflow:share-token:',
} as const;
