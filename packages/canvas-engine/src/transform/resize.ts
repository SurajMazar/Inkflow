import {
  isLinearElement,
  measureTextElement,
  type ElementPatch,
  type SceneElement,
} from '@inkflow/elements';
import { rotatePoint, type Point } from '@inkflow/geometry';
import type { ResizeHandle, SelectionFrame } from './handles';

export interface ResizeModifiers {
  /** Keep aspect ratio (Shift, or elements that prefer it). */
  keepAspect: boolean;
  /** Resize symmetrically around the center (Alt). */
  fromCenter: boolean;
}

export interface ResizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Set when the drag crossed the anchor on that axis. */
  flippedX: boolean;
  flippedY: boolean;
}

const MIN_SIZE = 1;

/**
 * Resizes a (possibly rotated) box by dragging `handle` to `pointer` (world coordinates), keeping
 * the opposite handle fixed in world space (or the center when `fromCenter`).
 */
export function resizeBox(frame: SelectionFrame, handle: ResizeHandle, pointer: Point, mods: ResizeModifiers): ResizedBox {
  const c = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  const p = rotatePoint(pointer, c, -frame.angle);
  let x0 = frame.x;
  let y0 = frame.y;
  let x1 = frame.x + frame.width;
  let y1 = frame.y + frame.height;
  const movesW = handle.includes('w');
  const movesE = handle.includes('e');
  const movesN = handle.includes('n');
  const movesS = handle.includes('s');

  if (movesE) x1 = p.x;
  if (movesW) x0 = p.x;
  if (movesS) y1 = p.y;
  if (movesN) y0 = p.y;
  if (mods.fromCenter) {
    if (movesE) x0 = 2 * c.x - x1;
    if (movesW) x1 = 2 * c.x - x0;
    if (movesS) y0 = 2 * c.y - y1;
    if (movesN) y1 = 2 * c.y - y0;
  }

  if (mods.keepAspect && frame.width > 0 && frame.height > 0) {
    const ratio = frame.width / frame.height;
    let w = x1 - x0;
    let h = y1 - y0;
    const corner = (movesE || movesW) && (movesN || movesS);
    if (corner) {
      const sx = Math.abs(w) / frame.width;
      const sy = Math.abs(h) / frame.height;
      const s = Math.max(sx, sy);
      const nw = frame.width * s * Math.sign(w || 1);
      const nh = frame.height * s * Math.sign(h || 1);
      if (mods.fromCenter) {
        x0 = c.x - nw / 2;
        x1 = c.x + nw / 2;
        y0 = c.y - nh / 2;
        y1 = c.y + nh / 2;
      } else {
        if (movesE) x1 = x0 + nw;
        else x0 = x1 - nw;
        if (movesS) y1 = y0 + nh;
        else y0 = y1 - nh;
      }
    } else if (movesE || movesW) {
      h = Math.abs(w) / ratio;
      y0 = c.y - h / 2;
      y1 = c.y + h / 2;
    } else {
      w = Math.abs(h) * ratio;
      x0 = c.x - w / 2;
      x1 = c.x + w / 2;
    }
  }

  const flippedX = x1 < x0;
  const flippedY = y1 < y0;
  const lx = Math.min(x0, x1);
  const ly = Math.min(y0, y1);
  const w = Math.max(MIN_SIZE, Math.abs(x1 - x0));
  const h = Math.max(MIN_SIZE, Math.abs(y1 - y0));
  // Rotate the new local center back into world space so the anchor stays put.
  const localCenter = { x: lx + w / 2, y: ly + h / 2 };
  const worldCenter = rotatePoint(localCenter, c, frame.angle);
  return { x: worldCenter.x - w / 2, y: worldCenter.y - h / 2, width: w, height: h, flippedX, flippedY };
}

/**
 * Applies a new box to a single element, scaling type-specific geometry (points, font size…).
 * `original` is the element state at the start of the gesture.
 */
export function applyBoxToElement(
  original: SceneElement,
  box: ResizedBox,
  handle: ResizeHandle,
): ElementPatch {
  const sx = original.width > 0 ? box.width / original.width : 1;
  const sy = original.height > 0 ? box.height / original.height : 1;
  const patch: ElementPatch = { x: box.x, y: box.y, width: box.width, height: box.height };

  if (isLinearElement(original) || original.type === 'freedraw') {
    const fx = box.flippedX ? -1 : 1;
    const fy = box.flippedY ? -1 : 1;
    const w = box.width;
    const h = box.height;
    if (original.type === 'freedraw') {
      patch.points = original.points.map(([px, py, pr]) => [
        fx > 0 ? px * sx : w - px * sx,
        fy > 0 ? py * sy : h - py * sy,
        pr,
      ]) as typeof original.points;
    } else {
      patch.points = original.points.map(([px, py]) => [fx > 0 ? px * sx : w - px * sx, fy > 0 ? py * sy : h - py * sy]);
    }
    return patch;
  }

  if (box.flippedX) patch.flipX = !original.flipX;
  if (box.flippedY) patch.flipY = !original.flipY;

  if (original.type === 'text') {
    const corner = handle.length === 2;
    if (corner) {
      const s = sy;
      const fontSize = Math.max(4, Math.min(400, original.fontSize * s));
      const measured = measureTextElement({ ...original, fontSize, width: original.width * s });
      patch.fontSize = fontSize;
      patch.letterSpacing = original.letterSpacing * s;
      patch.width = original.autoResize ? measured.width : box.width;
      patch.height = measured.height;
    } else if (handle === 'e' || handle === 'w') {
      const measured = measureTextElement({ ...original, autoResize: false, width: box.width });
      patch.autoResize = false;
      patch.height = measured.height;
    } else {
      patch.height = Math.max(box.height, measureTextElement(original).height);
    }
    return patch;
  }

  if (original.type === 'image' && original.crop) {
    // Crop stays in natural pixels; the displayed box scales it.
    return patch;
  }
  return patch;
}

/** Group resize: scales every element relative to the selection box. */
export function resizeMultiple(
  originals: readonly SceneElement[],
  frame: SelectionFrame,
  box: ResizedBox,
  uniform: boolean,
): Map<string, ElementPatch> {
  const result = new Map<string, ElementPatch>();
  let sx = frame.width > 0 ? box.width / frame.width : 1;
  let sy = frame.height > 0 ? box.height / frame.height : 1;
  if (uniform) {
    const s = Math.max(sx, sy);
    sx = s;
    sy = s;
  }
  const flipX = box.flippedX;
  const flipY = box.flippedY;
  const originX = flipX ? box.x + box.width : box.x;
  const originY = flipY ? box.y + box.height : box.y;
  const dirX = flipX ? -1 : 1;
  const dirY = flipY ? -1 : 1;

  for (const el of originals) {
    const cx = (el.x + el.width / 2 - frame.x) * sx * dirX + originX;
    const cy = (el.y + el.height / 2 - frame.y) * sy * dirY + originY;
    const rotated = el.angle !== 0;
    const esx = rotated ? Math.min(sx, sy) : sx;
    const esy = rotated ? Math.min(sx, sy) : sy;
    const width = Math.max(MIN_SIZE, el.width * esx);
    const height = Math.max(MIN_SIZE, el.height * esy);
    const patch: ElementPatch = { x: cx - width / 2, y: cy - height / 2, width, height };
    if (isLinearElement(el)) {
      patch.points = el.points.map(([px, py]) => [
        flipX ? width - px * esx : px * esx,
        flipY ? height - py * esy : py * esy,
      ]);
    } else if (el.type === 'freedraw') {
      patch.points = el.points.map(([px, py, pr]) => [
        flipX ? width - px * esx : px * esx,
        flipY ? height - py * esy : py * esy,
        pr,
      ]) as typeof el.points;
    } else {
      if (flipX) patch.flipX = !el.flipX;
      if (flipY) patch.flipY = !el.flipY;
      if (flipX !== flipY && el.angle !== 0) patch.angle = -el.angle;
    }
    if (el.type === 'text') {
      const s = Math.min(esx, esy);
      patch.fontSize = Math.max(4, Math.min(400, el.fontSize * s));
      patch.letterSpacing = el.letterSpacing * s;
    }
    if ('label' in el && el.label && !isLinearElement(el)) {
      patch.label = { ...el.label, fontSize: Math.max(4, Math.min(400, el.label.fontSize * Math.min(esx, esy))) } as ElementPatch['label'];
    }
    result.set(el.id, patch);
  }
  return result;
}
