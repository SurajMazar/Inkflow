import { isLinearElement, type ElementPatch, type SceneElement } from '@inkflow/elements';
import { normalizeAngle, rotatePoint, snapAngle, type Point } from '@inkflow/geometry';

export const ROTATION_SNAP_STEP = Math.PI / 12; // 15°

/** Angle delta between the pointer and the gesture start around `center`, optionally snapped. */
export function rotationDelta(
  center: Point,
  start: Point,
  pointer: Point,
  baseAngle: number,
  snap: boolean,
): number {
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const a1 = Math.atan2(pointer.y - center.y, pointer.x - center.x);
  let next = baseAngle + (a1 - a0);
  if (snap) next = snapAngle(next, ROTATION_SNAP_STEP, ROTATION_SNAP_STEP / 2);
  return normalizeAngle(next) - normalizeAngle(baseAngle);
}

/** Rotates elements around `center` by `delta` radians. */
export function rotateElements(
  originals: readonly SceneElement[],
  center: Point,
  delta: number,
): Map<string, ElementPatch> {
  const out = new Map<string, ElementPatch>();
  for (const el of originals) {
    const c = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
    const nc = rotatePoint(c, center, delta);
    out.set(el.id, {
      x: nc.x - el.width / 2,
      y: nc.y - el.height / 2,
      angle: normalizeAngle(el.angle + delta),
    });
  }
  return out;
}

/** Mirrors elements across the vertical (horizontal flip) or horizontal axis through the selection center. */
export function flipElements(
  originals: readonly SceneElement[],
  axis: 'horizontal' | 'vertical',
  center: Point,
): Map<string, ElementPatch> {
  const out = new Map<string, ElementPatch>();
  const horizontal = axis === 'horizontal';
  for (const el of originals) {
    const c = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
    const nc = horizontal ? { x: 2 * center.x - c.x, y: c.y } : { x: c.x, y: 2 * center.y - c.y };
    const patch: ElementPatch = {
      x: nc.x - el.width / 2,
      y: nc.y - el.height / 2,
      angle: normalizeAngle(-el.angle),
    };
    if (isLinearElement(el)) {
      patch.points = el.points.map(([px, py]) =>
        horizontal ? [el.width - px, py] : [px, el.height - py],
      );
    } else if (el.type === 'freedraw') {
      patch.points = el.points.map(([px, py, pr]) =>
        horizontal ? [el.width - px, py, pr] : [px, el.height - py, pr],
      ) as typeof el.points;
    } else if (horizontal) {
      patch.flipX = !el.flipX;
    } else {
      patch.flipY = !el.flipY;
    }
    out.set(el.id, patch);
  }
  return out;
}
