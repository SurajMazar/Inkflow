import { DEFAULT_USER_PREFERENCES, type UserPreferences } from '@inkflow/shared';
import { readJson, STORAGE_KEYS, writeJson } from '@/lib/storage';

/** A partial update: nested groups may be partial (they are merged); `shortcuts` is replaced. */
export type PreferencesPatch = {
  [K in keyof UserPreferences]?: K extends 'shortcuts'
    ? UserPreferences[K]
    : UserPreferences[K] extends object
      ? Partial<UserPreferences[K]>
      : UserPreferences[K];
};

const GROUP_KEYS = ['grid', 'snapping', 'canvas', 'defaultStyles', 'notifications'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Fills missing keys from `DEFAULT_USER_PREFERENCES` (tolerates partial server/local data). */
export function normalizePreferences(raw: unknown): UserPreferences {
  const base = DEFAULT_USER_PREFERENCES;
  if (!isRecord(raw)) return structuredClone(base);
  const result: UserPreferences = {
    theme: raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system' ? raw.theme : base.theme,
    highContrast: typeof raw.highContrast === 'boolean' ? raw.highContrast : base.highContrast,
    reduceMotion: typeof raw.reduceMotion === 'boolean' ? raw.reduceMotion : base.reduceMotion,
    grid: { ...base.grid, ...(isRecord(raw.grid) ? raw.grid : {}) } as UserPreferences['grid'],
    snapping: { ...base.snapping, ...(isRecord(raw.snapping) ? raw.snapping : {}) } as UserPreferences['snapping'],
    canvas: { ...base.canvas, ...(isRecord(raw.canvas) ? raw.canvas : {}) } as UserPreferences['canvas'],
    defaultStyles: {
      ...base.defaultStyles,
      ...(isRecord(raw.defaultStyles) ? raw.defaultStyles : {}),
    } as UserPreferences['defaultStyles'],
    notifications: {
      ...base.notifications,
      ...(isRecord(raw.notifications) ? raw.notifications : {}),
    } as UserPreferences['notifications'],
    shortcuts: isRecord(raw.shortcuts)
      ? Object.fromEntries(Object.entries(raw.shortcuts).filter(([, v]) => typeof v === 'string')) as Record<string, string>
      : {},
  };
  return result;
}

/**
 * Applies a patch and returns `{ next, body }` where `body` contains every changed top-level key
 * with its FULL value (the server merges top-level keys, so nested groups are sent whole).
 */
export function applyPreferencesPatch(
  current: UserPreferences,
  patch: PreferencesPatch,
): { next: UserPreferences; body: Partial<UserPreferences> } {
  const next: UserPreferences = { ...current };
  const body: Partial<UserPreferences> = {};
  const target = next as unknown as Record<string, unknown>;
  const out = body as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const merged =
      (GROUP_KEYS as readonly string[]).includes(key) && isRecord(value)
        ? { ...(current as unknown as Record<string, Record<string, unknown>>)[key], ...value }
        : value;
    target[key] = merged;
    out[key] = merged;
  }
  return { next, body };
}

/* Anonymous (signed-out) preferences live in localStorage and are shared across hooks. */

type Listener = () => void;
const listeners = new Set<Listener>();
let anonymousCache: UserPreferences | null = null;

export function getAnonymousPreferences(): UserPreferences {
  if (!anonymousCache) anonymousCache = normalizePreferences(readJson(STORAGE_KEYS.anonymousPreferences));
  return anonymousCache;
}

export function setAnonymousPreferences(next: UserPreferences): void {
  anonymousCache = next;
  writeJson(STORAGE_KEYS.anonymousPreferences, next);
  for (const listener of [...listeners]) listener();
}

export function subscribeAnonymousPreferences(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test helper. */
export function __resetAnonymousPreferencesForTests(): void {
  anonymousCache = null;
  listeners.clear();
}
