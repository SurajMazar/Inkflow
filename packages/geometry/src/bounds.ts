import { rotatePoint, type Point } from './vec';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const EMPTY_BOUNDS: Bounds = Object.freeze({
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
});

export const isEmptyBounds = (b: Bounds) => b.minX > b.maxX || b.minY > b.maxY;

export const rectToBounds = (r: Rect): Bounds => ({
  minX: Math.min(r.x, r.x + r.width),
  minY: Math.min(r.y, r.y + r.height),
  maxX: Math.max(r.x, r.x + r.width),
  maxY: Math.max(r.y, r.y + r.height),
});

export const boundsToRect = (b: Bounds): Rect => ({
  x: b.minX,
  y: b.minY,
  width: b.maxX - b.minX,
  height: b.maxY - b.minY,
});

export const boundsWidth = (b: Bounds) => b.maxX - b.minX;
export const boundsHeight = (b: Bounds) => b.maxY - b.minY;
export const boundsCenter = (b: Bounds): Point => ({
  x: (b.minX + b.maxX) / 2,
  y: (b.minY + b.maxY) / 2,
});
export const rectCenter = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export function boundsFromPoints(points: readonly Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBounds(...list: Bounds[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of list) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

export function expandBounds(b: Bounds, amount: number): Bounds {
  return {
    minX: b.minX - amount,
    minY: b.minY - amount,
    maxX: b.maxX + amount,
    maxY: b.maxY + amount,
  };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** True when `inner` lies completely inside `outer`. */
export function boundsContain(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  );
}

export function pointInBounds(p: Point, b: Bounds, tolerance = 0): boolean {
  return (
    p.x >= b.minX - tolerance &&
    p.x <= b.maxX + tolerance &&
    p.y >= b.minY - tolerance &&
    p.y <= b.maxY + tolerance
  );
}

/** Corners of a rect rotated by `angle` around its center: [tl, tr, br, bl]. */
export function rotatedRectCorners(r: Rect, angle: number): [Point, Point, Point, Point] {
  const c = rectCenter(r);
  const corners: [Point, Point, Point, Point] = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
  if (angle === 0) return corners;
  return corners.map((p) => rotatePoint(p, c, angle)) as [Point, Point, Point, Point];
}

/** Axis-aligned bounds of a rect rotated around its center. */
export function rotatedRectBounds(r: Rect, angle: number): Bounds {
  if (angle === 0) return rectToBounds(r);
  return boundsFromPoints(rotatedRectCorners(r, angle));
}

export function normalizeRect(r: Rect): Rect {
  return boundsToRect(rectToBounds(r));
}

export function boundsEqual(a: Bounds, b: Bounds, epsilon = 1e-6): boolean {
  return (
    Math.abs(a.minX - b.minX) <= epsilon &&
    Math.abs(a.minY - b.minY) <= epsilon &&
    Math.abs(a.maxX - b.maxX) <= epsilon &&
    Math.abs(a.maxY - b.maxY) <= epsilon
  );
}
