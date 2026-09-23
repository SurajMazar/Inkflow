import {
  getElementBounds,
  getElementCenter,
  getLinearWorldPoints,
  isLinearElement,
  type SceneElement,
} from '@inkflow/elements';
import { rotatePoint, type Bounds, type Point } from '@inkflow/geometry';
import type { OverlayHandle } from '@inkflow/renderer';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type TransformHandleId = ResizeHandle | 'rotation';

export const RESIZE_HANDLES: readonly ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Screen-space constants for transform chrome. */
export const HANDLE_SIZE = 8;
export const ROTATION_HANDLE_OFFSET = 22;
export const SELECTION_PADDING = 4;
export const TOUCH_HANDLE_SLOP = 10;

/** Normalized position of each handle within the box (0..1). */
const HANDLE_POS: Record<ResizeHandle, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

export interface SelectionFrame {
  /** Unrotated box in world units. */
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
}

/**
 * Transform box for a selection: a single element uses its own rotated box; multiple elements use
 * their common axis-aligned bounds.
 */
export function getSelectionFrame(elements: readonly SceneElement[]): SelectionFrame | null {
  if (elements.length === 0) return null;
  if (elements.length === 1 && !isLinearElement(elements[0]!) && elements[0]!.type !== 'freedraw') {
    const el = elements[0]!;
    return { x: el.x, y: el.y, width: el.width, height: el.height, angle: el.angle };
  }
  let b: Bounds | null = null;
  for (const el of elements) {
    const eb = getElementBounds(el);
    b = b
      ? { minX: Math.min(b.minX, eb.minX), minY: Math.min(b.minY, eb.minY), maxX: Math.max(b.maxX, eb.maxX), maxY: Math.max(b.maxY, eb.maxY) }
      : eb;
  }
  return { x: b!.minX, y: b!.minY, width: b!.maxX - b!.minX, height: b!.maxY - b!.minY, angle: 0 };
}

export function frameCorners(frame: SelectionFrame, padding = 0): Point[] {
  const c = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  const pts = [
    { x: frame.x - padding, y: frame.y - padding },
    { x: frame.x + frame.width + padding, y: frame.y - padding },
    { x: frame.x + frame.width + padding, y: frame.y + frame.height + padding },
    { x: frame.x - padding, y: frame.y + frame.height + padding },
  ];
  return pts.map((p) => rotatePoint(p, c, frame.angle));
}

export interface HandleOptions {
  zoom: number;
  /** Hide rotation (e.g. locked elements, frames). */
  rotatable: boolean;
  resizable: boolean;
  /** Only corner handles (text boxes, small selections). */
  cornersOnly?: boolean;
}

/** Transform handles for a selection frame in world coordinates. */
export function computeTransformHandles(frame: SelectionFrame, options: HandleOptions): OverlayHandle[] {
  const pad = SELECTION_PADDING / options.zoom;
  const c = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  const handles: OverlayHandle[] = [];
  const screenW = frame.width * options.zoom;
  const screenH = frame.height * options.zoom;
  const tiny = screenW < HANDLE_SIZE * 4 || screenH < HANDLE_SIZE * 4;
  if (options.resizable) {
    for (const id of RESIZE_HANDLES) {
      const edge = id.length === 1;
      if (edge && (options.cornersOnly || tiny)) continue;
      const [nx, ny] = HANDLE_POS[id];
      const p = {
        x: frame.x - pad + nx * (frame.width + pad * 2),
        y: frame.y - pad + ny * (frame.height + pad * 2),
      };
      const wp = rotatePoint(p, c, frame.angle);
      handles.push({ id, kind: 'resize', x: wp.x, y: wp.y, angle: frame.angle });
    }
  }
  if (options.rotatable) {
    const p = { x: c.x, y: frame.y - pad - ROTATION_HANDLE_OFFSET / options.zoom };
    const wp = rotatePoint(p, c, frame.angle);
    handles.push({ id: 'rotation', kind: 'rotate', x: wp.x, y: wp.y, angle: frame.angle });
  }
  return handles;
}

/** Point handles (and insertion midpoints) for a single linear element. */
export function computeLinearHandles(el: SceneElement, options: { endpointsOnly: boolean }): OverlayHandle[] {
  if (!isLinearElement(el)) return [];
  const pts = getLinearWorldPoints(el);
  const handles: OverlayHandle[] = [];
  pts.forEach((p, i) => {
    if (options.endpointsOnly && i !== 0 && i !== pts.length - 1) return;
    handles.push({ id: `point:${i}`, kind: 'point', x: p.x, y: p.y, angle: 0 });
  });
  if (!options.endpointsOnly) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      handles.push({ id: `mid:${i}`, kind: 'midpoint', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle: 0 });
    }
  }
  return handles;
}

export function hitTestHandles(
  handles: readonly OverlayHandle[],
  world: Point,
  zoom: number,
  pointerType: 'mouse' | 'pen' | 'touch',
): OverlayHandle | null {
  const slop = pointerType === 'touch' ? TOUCH_HANDLE_SLOP : 2;
  const radius = (HANDLE_SIZE / 2 + slop) / zoom;
  let best: OverlayHandle | null = null;
  let bestD = Infinity;
  // Points take precedence over midpoints; rotation over resize when overlapping.
  for (const h of handles) {
    const d = Math.hypot(h.x - world.x, h.y - world.y);
    const r = h.kind === 'midpoint' ? radius * 0.8 : radius;
    if (d <= r && d < bestD - 1e-9) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/** CSS cursor for a resize handle, accounting for rotation. */
export function cursorForHandle(id: TransformHandleId, angle: number): string {
  if (id === 'rotation') return 'grab';
  const order: ResizeHandle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const cursors = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
  const steps = Math.round(((angle % (Math.PI * 2)) + Math.PI * 2) / (Math.PI / 4)) % 8;
  const idx = (order.indexOf(id) + steps) % 8;
  return cursors[idx % 4]!;
}

export { getElementCenter };
