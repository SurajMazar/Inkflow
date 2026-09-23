import { getCommonBounds, type ElementPatch, type SceneElement } from '@inkflow/elements';
import { selectionUnits } from './groups';

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeMode = 'horizontal' | 'vertical';

type Patch = readonly [string, ElementPatch];

function translateUnit(unit: SceneElement[], dx: number, dy: number): Patch[] {
  if (dx === 0 && dy === 0) return [];
  return unit.map((el) => [el.id, { x: el.x + dx, y: el.y + dy }] as const);
}

/** Aligns selection units (groups move as one) to the selection's common bounds. */
export function alignElements(
  elements: readonly SceneElement[],
  mode: AlignMode,
  editingGroupId: string | null = null,
): Patch[] {
  const units = selectionUnits(elements, editingGroupId);
  const all = getCommonBounds(elements);
  if (!all || units.length < 2) return [];
  const patches: Patch[] = [];
  for (const unit of units) {
    const b = getCommonBounds(unit)!;
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case 'left':
        dx = all.minX - b.minX;
        break;
      case 'right':
        dx = all.maxX - b.maxX;
        break;
      case 'center':
        dx = (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2;
        break;
      case 'top':
        dy = all.minY - b.minY;
        break;
      case 'bottom':
        dy = all.maxY - b.maxY;
        break;
      case 'middle':
        dy = (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2;
        break;
    }
    patches.push(...translateUnit(unit, dx, dy));
  }
  return patches;
}

/** Distributes selection units so the gaps between them are equal. */
export function distributeElements(
  elements: readonly SceneElement[],
  mode: DistributeMode,
  editingGroupId: string | null = null,
): Patch[] {
  const units = selectionUnits(elements, editingGroupId).map((u) => ({
    unit: u,
    bounds: getCommonBounds(u)!,
  }));
  if (units.length < 3) return [];
  const horizontal = mode === 'horizontal';
  units.sort((a, b) =>
    horizontal
      ? a.bounds.minX + a.bounds.maxX - (b.bounds.minX + b.bounds.maxX)
      : a.bounds.minY + a.bounds.maxY - (b.bounds.minY + b.bounds.maxY),
  );
  const size = (b: (typeof units)[number]['bounds']) =>
    horizontal ? b.maxX - b.minX : b.maxY - b.minY;
  const first = units[0]!.bounds;
  const last = units[units.length - 1]!.bounds;
  const span = horizontal ? last.maxX - first.minX : last.maxY - first.minY;
  const totalSize = units.reduce((s, u) => s + size(u.bounds), 0);
  const gap = (span - totalSize) / (units.length - 1);
  const patches: Patch[] = [];
  let cursor = horizontal ? first.minX : first.minY;
  for (const { unit, bounds } of units) {
    const start = horizontal ? bounds.minX : bounds.minY;
    const delta = cursor - start;
    patches.push(...translateUnit(unit, horizontal ? delta : 0, horizontal ? 0 : delta));
    cursor += size(bounds) + gap;
  }
  return patches;
}
