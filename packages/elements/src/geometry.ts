import {
  boundsFromPoints,
  catmullRomToBeziers,
  distanceToEllipseOutline,
  distanceToPolyline,
  flattenCubic,
  pointInEllipse,
  pointInPolygon,
  regularPolygonPoints,
  rotatePoint,
  rotatedRectBounds,
  starPoints,
  type Bounds,
  type Point,
  type Rect,
} from '@inkflow/geometry';
import { isLinearElement } from './guards';
import type { FreedrawElement, LinearElement, LocalPoint, SceneElement } from './types';

export const getElementRect = (el: SceneElement): Rect => ({ x: el.x, y: el.y, width: el.width, height: el.height });

export const getElementCenter = (el: SceneElement): Point => ({ x: el.x + el.width / 2, y: el.y + el.height / 2 });

/** Converts a world point into the element's unrotated coordinate space (still world units). */
export function toElementSpace(el: SceneElement, p: Point): Point {
  return el.angle === 0 ? p : rotatePoint(p, getElementCenter(el), -el.angle);
}

/** Converts a point in the element's unrotated space into world space. */
export function fromElementSpace(el: SceneElement, p: Point): Point {
  return el.angle === 0 ? p : rotatePoint(p, getElementCenter(el), el.angle);
}

/** Outline vertices (unrotated, world units) for polygonal shapes, honoring flips. */
export function getPolygonOutline(el: SceneElement): Point[] | null {
  const { x, y, width: w, height: h } = el;
  let pts: Point[] | null = null;
  switch (el.type) {
    case 'diamond':
      pts = [
        { x: x + w / 2, y },
        { x: x + w, y: y + h / 2 },
        { x: x + w / 2, y: y + h },
        { x, y: y + h / 2 },
      ];
      break;
    case 'triangle':
      pts = [
        { x: x + w / 2, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ];
      break;
    case 'polygon':
      pts = regularPolygonPoints(x, y, w, h, el.sides);
      break;
    case 'star':
      pts = starPoints(x, y, w, h, el.spikes, el.innerRatio);
      break;
    default:
      return null;
  }
  if (el.flipX || el.flipY) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    pts = pts.map((p) => ({ x: el.flipX ? 2 * cx - p.x : p.x, y: el.flipY ? 2 * cy - p.y : p.y }));
  }
  return pts;
}

/** Linear element points in world space (rotation applied). */
export function getLinearWorldPoints(el: LinearElement | FreedrawElement): Point[] {
  const c = getElementCenter(el);
  return el.points.map((p) => {
    const wp = { x: el.x + p[0], y: el.y + p[1] };
    return el.angle === 0 ? wp : rotatePoint(wp, c, el.angle);
  });
}

/** Flattened path (world space) actually drawn for a linear element. */
export function getLinearPath(el: LinearElement): Point[] {
  const pts = getLinearWorldPoints(el);
  if (pts.length < 2) return pts;
  const curved =
    (el.type !== 'connector' && el.pathStyle === 'curved') || (el.type === 'connector' && el.routing === 'curved');
  if (el.type === 'connector' && el.routing === 'bezier' && pts.length === 4) {
    return flattenCubic({ p0: pts[0]!, c1: pts[1]!, c2: pts[2]!, p1: pts[3]! }, 32);
  }
  if (curved && pts.length > 2) {
    const out: Point[] = [];
    catmullRomToBeziers(pts).forEach((b, i) => {
      const seg = flattenCubic(b, 12);
      out.push(...(i === 0 ? seg : seg.slice(1)));
    });
    return out;
  }
  return pts;
}

/** Axis-aligned world bounds of an element including rotation. */
export function getElementBounds(el: SceneElement): Bounds {
  if (isLinearElement(el)) {
    const path = getLinearPath(el);
    return path.length ? boundsFromPoints(path) : { minX: el.x, minY: el.y, maxX: el.x, maxY: el.y };
  }
  if (el.type === 'freedraw') {
    const pts = getLinearWorldPoints(el);
    const b = boundsFromPoints(pts);
    const pad = el.strokeWidth * 2;
    return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
  }
  return rotatedRectBounds(getElementRect(el), el.angle);
}

export function getCommonBounds(elements: readonly SceneElement[]): Bounds | null {
  if (elements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    const b = getElementBounds(el);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

/** Recomputes x/y/width/height so the minimum local point is [0, 0]. */
export function normalizeLinearPoints<P extends LocalPoint | [number, number, number]>(
  x: number,
  y: number,
  points: readonly P[],
): { x: number; y: number; width: number; height: number; points: P[] } {
  if (points.length === 0) return { x, y, width: 0, height: 0, points: [] };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  const shifted = points.map((p) => {
    const copy = [...p] as unknown as P;
    copy[0] = p[0] - minX;
    copy[1] = p[1] - minY;
    return copy;
  });
  return { x: x + minX, y: y + minY, width: maxX - minX, height: maxY - minY, points: shifted };
}

function isTransparent(color: string): boolean {
  return color === 'transparent' || color === '' || /^#[0-9a-f]{6}00$/i.test(color) || /rgba\([^)]*,\s*0\)$/.test(color);
}

export function isFilled(el: SceneElement): boolean {
  return !isTransparent(el.backgroundColor);
}

export interface HitTestOptions {
  /** Tolerance in world units (usually a constant screen distance divided by zoom). */
  tolerance: number;
  /** When true, transparent shapes are hit by their whole area rather than only the outline. */
  areaHitForTransparent?: boolean;
}

const FRAME_TITLE_HEIGHT = 24;

/** Precise hit test of a world point against an element's rendered geometry. */
export function hitTestElement(el: SceneElement, worldPoint: Point, options: HitTestOptions): boolean {
  const tol = options.tolerance + el.strokeWidth / 2;
  if (isLinearElement(el)) {
    const closed = el.type === 'line' && el.closed;
    const path = getLinearPath(el);
    if (distanceToPolyline(worldPoint, path, closed) <= tol) return true;
    if (closed && isFilled(el) && pointInPolygon(worldPoint, path)) return true;
    return false;
  }
  if (el.type === 'freedraw') {
    const pts = getLinearWorldPoints(el);
    const width = el.brush === 'highlighter' ? el.strokeWidth * 4 : el.strokeWidth * 1.5;
    return distanceToPolyline(worldPoint, pts) <= options.tolerance + width / 2;
  }

  const p = toElementSpace(el, worldPoint);
  const { x, y, width: w, height: h } = el;
  const inBox = p.x >= x - tol && p.x <= x + w + tol && p.y >= y - tol && p.y <= y + h + tol;
  if (!inBox) return false;

  if (el.type === 'frame') {
    const onTitle = p.y >= y - FRAME_TITLE_HEIGHT && p.y <= y && p.x >= x && p.x <= x + w;
    if (onTitle) return true;
    const nearEdge =
      Math.abs(p.x - x) <= tol || Math.abs(p.x - (x + w)) <= tol || Math.abs(p.y - y) <= tol || Math.abs(p.y - (y + h)) <= tol;
    return nearEdge;
  }

  const area = isFilled(el) || options.areaHitForTransparent === true || hasVisibleLabel(el);

  if (el.type === 'ellipse') {
    const c = { x: x + w / 2, y: y + h / 2 };
    if (area && pointInEllipse(p, c, w / 2 + tol, h / 2 + tol)) return true;
    return distanceToEllipseOutline(p, c, w / 2, h / 2) <= tol;
  }

  const polygon = getPolygonOutline(el);
  if (polygon) {
    if (area && pointInPolygon(p, polygon)) return true;
    return distanceToPolyline(p, polygon, true) <= tol;
  }

  if (el.type === 'rectangle') {
    if (area) return true;
    return (
      Math.abs(p.x - x) <= tol ||
      Math.abs(p.x - (x + w)) <= tol ||
      Math.abs(p.y - y) <= tol ||
      Math.abs(p.y - (y + h)) <= tol
    );
  }
  // text, image, node, table, uml-class, sequence: whole box
  return true;
}

function hasVisibleLabel(el: SceneElement): boolean {
  return 'label' in el && !!el.label && el.label.text.trim().length > 0 && !isLinearElement(el);
}

/** True when the element's bounds are fully contained in the given world bounds. */
export function isElementInsideBounds(el: SceneElement, bounds: Bounds): boolean {
  const b = getElementBounds(el);
  return b.minX >= bounds.minX && b.maxX <= bounds.maxX && b.minY >= bounds.minY && b.maxY <= bounds.maxY;
}

/** True when any part of the element's rendered geometry intersects the bounds (eraser, lasso). */
export function elementIntersectsBounds(el: SceneElement, bounds: Bounds): boolean {
  const b = getElementBounds(el);
  return b.minX <= bounds.maxX && b.maxX >= bounds.minX && b.minY <= bounds.maxY && b.maxY >= bounds.minY;
}

export { FRAME_TITLE_HEIGHT };
