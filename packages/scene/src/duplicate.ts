import { isLinearElement, type SceneElement } from '@inkflow/elements';
import { generateId, randomInteger } from '@inkflow/shared';

export interface DuplicateOptions {
  dx?: number;
  dy?: number;
  /** Keep bindings to elements outside the duplicated set (paste-in-place). */
  keepExternalBindings?: boolean;
  /** Target frame ids that still exist; frame membership to others is dropped. */
  existingFrameIds?: ReadonlySet<string>;
}

/**
 * Deep-copies elements with fresh ids while preserving their relationships: groups are remapped
 * consistently (nested groups stay nested), bindings between copied elements point to the copies,
 * and frame children follow copied frames.
 */
export function duplicateElements(elements: readonly SceneElement[], options: DuplicateOptions = {}): {
  elements: SceneElement[];
  idMap: Map<string, string>;
} {
  const dx = options.dx ?? 0;
  const dy = options.dy ?? 0;
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  for (const el of elements) idMap.set(el.id, generateId());
  const mapGroup = (g: string) => {
    let n = groupMap.get(g);
    if (!n) {
      n = generateId();
      groupMap.set(g, n);
    }
    return n;
  };
  const now = Date.now();
  const out = elements.map((el) => {
    const copy = structuredClone(el) as SceneElement;
    copy.id = idMap.get(el.id)!;
    copy.x = el.x + dx;
    copy.y = el.y + dy;
    copy.groupIds = el.groupIds.map(mapGroup);
    copy.seed = randomInteger();
    copy.version = 1;
    copy.versionNonce = randomInteger();
    copy.updated = now;
    copy.isDeleted = false;
    copy.locked = false;
    if (el.frameId) {
      copy.frameId = idMap.get(el.frameId) ?? (options.existingFrameIds?.has(el.frameId) ? el.frameId : null);
    }
    if (isLinearElement(copy) && isLinearElement(el)) {
      const remap = (b: typeof el.startBinding) => {
        if (!b) return null;
        const mapped = idMap.get(b.elementId);
        if (mapped) return { ...b, elementId: mapped };
        return options.keepExternalBindings ? { ...b } : null;
      };
      copy.startBinding = remap(el.startBinding);
      copy.endBinding = remap(el.endBinding);
      if (copy.type === 'connector' && el.type === 'connector') {
        copy.waypoints = el.waypoints.map(([x, y]) => [x + dx, y + dy]);
      }
    }
    return copy;
  });
  return { elements: out, idMap };
}
