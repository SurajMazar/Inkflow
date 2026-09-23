import type { ElementPatch, SceneElement } from '@inkflow/elements';

/** Bookkeeping properties that change on every edit and never participate in diffs. */
export const VOLATILE_KEYS: ReadonlySet<string> = new Set(['version', 'versionNonce', 'updated']);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
      return false;
  }
  return true;
}

export interface PropertyDiff {
  before: ElementPatch;
  after: ElementPatch;
}

/** Property-level diff between two versions of the same element (volatile keys excluded). */
export function diffElements(before: SceneElement, after: SceneElement): PropertyDiff | null {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let changed = false;
  for (const key of keys) {
    if (VOLATILE_KEYS.has(key) || key === 'id') continue;
    const vb = (before as unknown as Record<string, unknown>)[key];
    const va = (after as unknown as Record<string, unknown>)[key];
    if (!deepEqual(vb, va)) {
      b[key] = vb;
      a[key] = va;
      changed = true;
    }
  }
  return changed ? { before: b as ElementPatch, after: a as ElementPatch } : null;
}

/** Returns a new element with the patch shallowly merged in. */
export function applyPatch<T extends SceneElement>(el: T, patch: ElementPatch): T {
  return { ...el, ...(patch as Partial<T>), id: el.id, type: el.type };
}

export function patchKeys(patch: ElementPatch): string[] {
  return Object.keys(patch).filter((k) => !VOLATILE_KEYS.has(k));
}
