import type { SceneElement } from '@inkflow/elements';
import { generateId } from '@inkflow/shared';

/** Outermost group of an element, or null. */
export const outermostGroupId = (el: SceneElement): string | null => el.groupIds.at(-1) ?? null;

/**
 * Group an element selects as when clicked. While the user is "inside" `editingGroupId`
 * (double-clicked into a group), selection targets the next nested level.
 */
export function selectionGroupFor(el: SceneElement, editingGroupId: string | null): string | null {
  if (el.groupIds.length === 0) return null;
  if (!editingGroupId) return outermostGroupId(el);
  const idx = el.groupIds.indexOf(editingGroupId);
  if (idx === -1) return outermostGroupId(el);
  return idx > 0 ? el.groupIds[idx - 1]! : null;
}

/** Expands a set of element ids to include every member of the groups they select as. */
export function expandSelectionToGroups(
  ids: readonly string[],
  elements: readonly SceneElement[],
  editingGroupId: string | null,
): Set<string> {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const result = new Set<string>();
  const groups = new Set<string>();
  for (const id of ids) {
    const el = byId.get(id);
    if (!el) continue;
    result.add(id);
    const g = selectionGroupFor(el, editingGroupId);
    if (g) groups.add(g);
  }
  if (groups.size) {
    for (const el of elements) {
      if (!el.isDeleted && el.groupIds.some((g) => groups.has(g))) result.add(el.id);
    }
  }
  return result;
}

/** Patches that wrap the given elements in a new outermost group. */
export function groupElementsPatches(elements: readonly SceneElement[], groupId = generateId()) {
  return {
    groupId,
    patches: elements.map((el) => [el.id, { groupIds: [...el.groupIds, groupId] }] as const),
  };
}

/** Patches that remove the outermost group shared by the selection. */
export function ungroupElementsPatches(elements: readonly SceneElement[]) {
  const patches: (readonly [string, { groupIds: string[] }])[] = [];
  const removed = new Set<string>();
  for (const el of elements) {
    const g = outermostGroupId(el);
    if (!g) continue;
    removed.add(g);
  }
  for (const el of elements) {
    const next = el.groupIds.filter((g) => !removed.has(g) || g !== outermostGroupId(el));
    if (next.length !== el.groupIds.length) patches.push([el.id, { groupIds: next }] as const);
  }
  return { removedGroupIds: [...removed], patches };
}

/** Distinct outermost units in a selection: each group counts once, loose elements individually. */
export function selectionUnits(
  elements: readonly SceneElement[],
  editingGroupId: string | null = null,
): SceneElement[][] {
  const units = new Map<string, SceneElement[]>();
  for (const el of elements) {
    const key = selectionGroupFor(el, editingGroupId) ?? `el:${el.id}`;
    const list = units.get(key);
    if (list) list.push(el);
    else units.set(key, [el]);
  }
  return [...units.values()];
}
