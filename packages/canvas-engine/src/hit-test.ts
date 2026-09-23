import { hitTestElement, type SceneElement } from '@inkflow/elements';
import { pointInPolygon, type Point } from '@inkflow/geometry';
import type { Scene } from '@inkflow/scene';
import { frameCorners, type SelectionFrame } from './transform/handles';

/** Hit tolerance in screen pixels by input type. */
export function hitTolerancePx(pointerType: 'mouse' | 'pen' | 'touch'): number {
  return pointerType === 'touch' ? 14 : pointerType === 'pen' ? 8 : 6;
}

export interface HitTestOptions {
  tolerance: number;
  includeLocked?: boolean;
  includeFrames?: boolean;
  excludeIds?: ReadonlySet<string>;
}

/** All elements under a world point, top-most first. */
export function hitTestAll(scene: Scene, point: Point, options: HitTestOptions): SceneElement[] {
  const candidates = scene.queryPoint(point.x, point.y, options.tolerance * 2);
  const out: SceneElement[] = [];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const el = candidates[i]!;
    if (el.hidden || el.isDeleted) continue;
    if (el.locked && !options.includeLocked) continue;
    if (el.type === 'frame' && options.includeFrames === false) continue;
    if (options.excludeIds?.has(el.id)) continue;
    if (el.frameId) {
      // Children of clipping frames are only hittable inside the frame.
      const frame = scene.getLiveElement(el.frameId);
      if (frame && frame.type === 'frame' && frame.clip && !hitInsideBox(frame, point)) continue;
    }
    if (hitTestElement(el, point, { tolerance: options.tolerance })) out.push(el);
  }
  // Frames sit visually below their content: prefer non-frame hits.
  return out.sort((a, b) => Number(a.type === 'frame') - Number(b.type === 'frame'));
}

export function hitTestTop(scene: Scene, point: Point, options: HitTestOptions): SceneElement | null {
  return hitTestAll(scene, point, options)[0] ?? null;
}

function hitInsideBox(el: SceneElement, p: Point): boolean {
  const frame: SelectionFrame = { x: el.x, y: el.y, width: el.width, height: el.height, angle: el.angle };
  return pointInPolygon(p, frameCorners(frame));
}

export function pointInSelectionFrame(frame: SelectionFrame | null, p: Point, padding: number): boolean {
  if (!frame) return false;
  return pointInPolygon(p, frameCorners(frame, padding));
}
