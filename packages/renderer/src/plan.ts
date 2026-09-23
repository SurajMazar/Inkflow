import { getElementBounds, type FrameElement, type SceneElement } from '@inkflow/elements';
import {
  boundsIntersect,
  expandBounds,
  rotatedRectBounds,
  type Bounds,
  type Rect,
} from '@inkflow/geometry';
import { measureRenderPadding } from './padding';

export interface RenderPlan {
  /** Visible frames in scene order (drawn first: backgrounds sit under content). */
  frames: FrameElement[];
  /** Visible non-frame elements in scene order. */
  content: SceneElement[];
  /** Frame to clip each content element to (only for frames with `clip`). */
  clipFrames: Map<string, FrameElement>;
  /** Elements eligible for drawing (not deleted/hidden/skipped). */
  considered: number;
  /** Eligible elements rejected by culling. */
  culled: number;
}

export interface PlanOptions {
  getElement: (id: string) => SceneElement | undefined;
  skipIds?: ReadonlySet<string>;
  /** World rectangle to cull against (null = no culling). */
  view?: Bounds | null;
  /** Extra world-space margin above frames for their names (e.g. title height / zoom). */
  frameTitleHeight?: number;
  /** Render bounds provider (defaults to geometric bounds + render padding). */
  boundsOf?: (el: SceneElement) => Bounds;
}

/** Geometric bounds expanded by the render padding (stroke, jitter, arrowheads, labels). */
export function getRenderBounds(el: SceneElement): Bounds {
  return expandBounds(getElementBounds(el), measureRenderPadding(el));
}

export function frameRect(frame: FrameElement): Rect {
  return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
}

/**
 * Splits elements into the draw passes (frames first, then content) with frame clipping and
 * viewport culling. Deleted, hidden and skipped elements are dropped.
 */
export function planRender(elements: readonly SceneElement[], options: PlanOptions): RenderPlan {
  const boundsOf = options.boundsOf ?? getRenderBounds;
  const view = options.view ?? null;
  const local = new Map<string, FrameElement>();
  for (const el of elements) if (el.type === 'frame') local.set(el.id, el);
  const frameById = (id: string): FrameElement | null => {
    const f = local.get(id) ?? options.getElement(id);
    return f && f.type === 'frame' && !f.isDeleted ? f : null;
  };
  const frames: FrameElement[] = [];
  const content: SceneElement[] = [];
  const clipFrames = new Map<string, FrameElement>();
  let considered = 0;
  let culled = 0;
  const titleH = options.frameTitleHeight ?? 0;
  for (const el of elements) {
    if (el.isDeleted || el.hidden) continue;
    if (options.skipIds?.has(el.id)) continue;
    considered++;
    if (el.type === 'frame') {
      if (view) {
        const b = boundsOf(el);
        const withTitle = titleH > 0 ? { ...b, minY: b.minY - titleH } : b;
        if (!boundsIntersect(withTitle, view)) {
          culled++;
          continue;
        }
      }
      frames.push(el);
      continue;
    }
    const frame = el.frameId ? frameById(el.frameId) : null;
    const clip = frame && frame.clip ? frame : null;
    if (view) {
      const b = boundsOf(el);
      if (!boundsIntersect(b, view)) {
        culled++;
        continue;
      }
      if (clip && !boundsIntersect(b, rotatedRectBounds(frameRect(clip), clip.angle))) {
        culled++;
        continue;
      }
      if (clip && !boundsIntersect(rotatedRectBounds(frameRect(clip), clip.angle), view)) {
        culled++;
        continue;
      }
    }
    if (clip) clipFrames.set(el.id, clip);
    content.push(el);
  }
  return { frames, content, clipFrames, considered, culled };
}

/** Viewport rectangle in world coordinates. */
export function viewportWorldBounds(viewport: {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}): Bounds {
  const z = Math.max(1e-6, viewport.zoom);
  return {
    minX: viewport.x,
    minY: viewport.y,
    maxX: viewport.x + viewport.width / z,
    maxY: viewport.y + viewport.height / z,
  };
}
