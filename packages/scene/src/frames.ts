import { getElementBounds, type FrameElement, type SceneElement } from '@inkflow/elements';
import { boundsCenter, pointInBounds, rotatedRectBounds, type Bounds } from '@inkflow/geometry';

export function frameBounds(frame: FrameElement): Bounds {
  return rotatedRectBounds(
    { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
    frame.angle,
  );
}

/**
 * Frame an element belongs to after being moved or created: the top-most frame containing the
 * element's center. Frames never nest.
 */
export function frameForElement(el: SceneElement, frames: readonly FrameElement[]): string | null {
  if (el.type === 'frame') return null;
  const center = boundsCenter(getElementBounds(el));
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]!;
    if (!f.isDeleted && pointInBounds(center, frameBounds(f))) return f.id;
  }
  return null;
}

/**
 * Computes frameId patches for the given elements. Grouped elements share one frame decided by
 * the group's combined center so a group is never split across frames.
 */
export function computeFrameMembership(
  elements: readonly SceneElement[],
  frames: readonly FrameElement[],
): (readonly [string, { frameId: string | null }])[] {
  const patches: (readonly [string, { frameId: string | null }])[] = [];
  const groupFrame = new Map<string, string | null>();
  for (const el of elements) {
    if (el.type === 'frame') continue;
    let target: string | null;
    const group = el.groupIds.at(-1);
    if (group) {
      if (!groupFrame.has(group)) {
        const members = elements.filter((e) => e.groupIds.includes(group));
        const b = members.map(getElementBounds);
        const union = {
          minX: Math.min(...b.map((x) => x.minX)),
          minY: Math.min(...b.map((x) => x.minY)),
          maxX: Math.max(...b.map((x) => x.maxX)),
          maxY: Math.max(...b.map((x) => x.maxY)),
        };
        const c = boundsCenter(union);
        let found: string | null = null;
        for (let i = frames.length - 1; i >= 0; i--) {
          if (!frames[i]!.isDeleted && pointInBounds(c, frameBounds(frames[i]!))) {
            found = frames[i]!.id;
            break;
          }
        }
        groupFrame.set(group, found);
      }
      target = groupFrame.get(group) ?? null;
    } else {
      target = frameForElement(el, frames);
    }
    if (target !== el.frameId) patches.push([el.id, { frameId: target }] as const);
  }
  return patches;
}

/** Frames in presentation order: explicit order first, then remaining frames top-to-bottom, left-to-right. */
export function orderedFrames(
  frames: readonly FrameElement[],
  explicitOrder: readonly string[],
): FrameElement[] {
  const live = frames.filter((f) => !f.isDeleted);
  const byId = new Map(live.map((f) => [f.id, f]));
  const ordered: FrameElement[] = [];
  for (const id of explicitOrder) {
    const f = byId.get(id);
    if (f) {
      ordered.push(f);
      byId.delete(id);
    }
  }
  const rest = [...byId.values()].sort((a, b) =>
    Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x,
  );
  return [...ordered, ...rest];
}
