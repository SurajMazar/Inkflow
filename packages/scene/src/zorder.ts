import type { SceneElement } from '@inkflow/elements';
import { generateKeyBetween, generateNKeysBetween } from './fractional-index';

export type ZOrderAction = 'bringForward' | 'sendBackward' | 'bringToFront' | 'sendToBack';

/**
 * Assigns fresh fractional indices to `movedIds` so that the elements appear in the order given
 * by `desired`. Only moved elements receive new keys; everyone else keeps theirs, which keeps
 * concurrent reorders by collaborators conflict-free.
 */
export function reindexForOrder(desired: readonly SceneElement[], movedIds: ReadonlySet<string>): Map<string, string> {
  const result = new Map<string, string>();
  let i = 0;
  let prevKey: string | null = null;
  while (i < desired.length) {
    const el = desired[i]!;
    if (!movedIds.has(el.id)) {
      if (prevKey !== null && el.index <= prevKey) {
        // Ordering conflict (e.g. duplicate keys from concurrent inserts): re-key this element too.
        const key = generateKeyBetween(prevKey, null);
        result.set(el.id, key);
        prevKey = key;
      } else {
        prevKey = el.index;
      }
      i++;
      continue;
    }
    let j = i;
    while (j < desired.length && movedIds.has(desired[j]!.id)) j++;
    let nextKey: string | null = null;
    for (let k = j; k < desired.length; k++) {
      const candidate = desired[k]!.index;
      if (prevKey === null || candidate > prevKey) {
        nextKey = candidate;
        break;
      }
    }
    const keys = generateNKeysBetween(prevKey, nextKey, j - i);
    for (let k = i; k < j; k++) result.set(desired[k]!.id, keys[k - i]!);
    prevKey = keys[keys.length - 1]!;
    i = j;
  }
  return result;
}

/** Computes new indices for a z-order action on the selected ids (ordered = scene z-order). */
export function computeZOrder(
  ordered: readonly SceneElement[],
  selectedIds: ReadonlySet<string>,
  action: ZOrderAction,
): Map<string, string> {
  const live = ordered.filter((e) => !e.isDeleted);
  const selected = live.filter((e) => selectedIds.has(e.id));
  if (selected.length === 0) return new Map();
  const rest = live.filter((e) => !selectedIds.has(e.id));
  let desired: SceneElement[];
  switch (action) {
    case 'bringToFront':
      desired = [...rest, ...selected];
      break;
    case 'sendToBack':
      desired = [...selected, ...rest];
      break;
    case 'bringForward': {
      desired = live.slice();
      let i = desired.length - 1;
      while (i >= 0) {
        if (!selectedIds.has(desired[i]!.id)) {
          i--;
          continue;
        }
        let start = i;
        while (start - 1 >= 0 && selectedIds.has(desired[start - 1]!.id)) start--;
        if (i + 1 < desired.length) {
          // Move the selected run above the first unselected element on top of it.
          const run = desired.splice(start, i - start + 1);
          desired.splice(start + 1, 0, ...run);
        }
        i = start - 1;
      }
      break;
    }
    case 'sendBackward': {
      desired = live.slice();
      let i = 0;
      while (i < desired.length) {
        if (!selectedIds.has(desired[i]!.id)) {
          i++;
          continue;
        }
        let end = i;
        while (end + 1 < desired.length && selectedIds.has(desired[end + 1]!.id)) end++;
        if (i > 0) {
          const run = desired.splice(i, end - i + 1);
          desired.splice(i - 1, 0, ...run);
        }
        i = end + 1;
      }
      break;
    }
  }
  const currentPos = new Map(live.map((e, i) => [e.id, i]));
  const moved = new Set<string>();
  desired.forEach((e, i) => {
    if (selectedIds.has(e.id) && currentPos.get(e.id) !== i) moved.add(e.id);
  });
  if (moved.size === 0) return new Map();
  // Treat the whole selection as moved so its internal order is preserved with fresh keys.
  return reindexForOrder(desired, new Set(selected.map((e) => e.id)));
}

/** Index for a new element placed on top of everything. */
export function indexAbove(ordered: readonly SceneElement[]): string {
  const last = ordered.at(-1);
  return generateKeyBetween(last ? last.index : null, null);
}

/** `n` indices for new elements placed on top of everything. */
export function indicesAbove(ordered: readonly SceneElement[], n: number): string[] {
  const last = ordered.at(-1);
  return generateNKeysBetween(last ? last.index : null, null, n);
}
