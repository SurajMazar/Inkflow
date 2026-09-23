import { snapToStep, type Bounds, type Point } from '@inkflow/geometry';

/** Snap distance in screen pixels. */
export const SNAP_THRESHOLD_PX = 8;

export interface SnapGuides {
  lines: { from: Point; to: Point }[];
  points: Point[];
}

export interface SnapResult extends SnapGuides {
  dx: number;
  dy: number;
}

export const EMPTY_GUIDES: SnapGuides = { lines: [], points: [] };

const xs = (b: Bounds) => [b.minX, (b.minX + b.maxX) / 2, b.maxX];
const ys = (b: Bounds) => [b.minY, (b.minY + b.maxY) / 2, b.maxY];

interface AxisMatch {
  delta: number;
  value: number;
}

function bestAxisMatch(moving: number[], targets: number[][], threshold: number): AxisMatch | null {
  let best: AxisMatch | null = null;
  for (const m of moving) {
    for (const list of targets) {
      for (const t of list) {
        const d = t - m;
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta)))
          best = { delta: d, value: t };
      }
    }
  }
  return best;
}

/**
 * Snaps a moving selection's edges and center to the edges/centers of candidate bounds.
 * Returns the offset to apply and alignment guides spanning the aligned elements.
 */
export function snapBoundsToObjects(
  moving: Bounds,
  candidates: readonly Bounds[],
  threshold: number,
): SnapResult {
  if (candidates.length === 0) return { dx: 0, dy: 0, lines: [], points: [] };
  const mx = xs(moving);
  const my = ys(moving);
  const bx = bestAxisMatch(mx, candidates.map(xs), threshold);
  const by = bestAxisMatch(my, candidates.map(ys), threshold);
  const dx = bx?.delta ?? 0;
  const dy = by?.delta ?? 0;
  const snapped: Bounds = {
    minX: moving.minX + dx,
    minY: moving.minY + dy,
    maxX: moving.maxX + dx,
    maxY: moving.maxY + dy,
  };
  const lines: { from: Point; to: Point }[] = [];
  const points: Point[] = [];
  const eps = 0.01;
  if (bx) {
    for (const value of new Set(xs(snapped).filter((v) => Math.abs(v - bx.value) < eps))) {
      let minY = snapped.minY;
      let maxY = snapped.maxY;
      for (const c of candidates) {
        if (xs(c).some((v) => Math.abs(v - value) < eps)) {
          minY = Math.min(minY, c.minY);
          maxY = Math.max(maxY, c.maxY);
          points.push({ x: value, y: c.minY }, { x: value, y: c.maxY });
        }
      }
      lines.push({ from: { x: value, y: minY }, to: { x: value, y: maxY } });
      points.push({ x: value, y: snapped.minY }, { x: value, y: snapped.maxY });
    }
  }
  if (by) {
    for (const value of new Set(ys(snapped).filter((v) => Math.abs(v - by.value) < eps))) {
      let minX = snapped.minX;
      let maxX = snapped.maxX;
      for (const c of candidates) {
        if (ys(c).some((v) => Math.abs(v - value) < eps)) {
          minX = Math.min(minX, c.minX);
          maxX = Math.max(maxX, c.maxX);
          points.push({ x: c.minX, y: value }, { x: c.maxX, y: value });
        }
      }
      lines.push({ from: { x: minX, y: value }, to: { x: maxX, y: value } });
      points.push({ x: snapped.minX, y: value }, { x: snapped.maxX, y: value });
    }
  }
  return { dx, dy, lines, points };
}

/** Snaps the top-left corner of moving bounds to the grid. */
export function snapBoundsToGrid(moving: Bounds, gridSize: number): { dx: number; dy: number } {
  return {
    dx: snapToStep(moving.minX, gridSize) - moving.minX,
    dy: snapToStep(moving.minY, gridSize) - moving.minY,
  };
}

export function snapPointToGrid(p: Point, gridSize: number): Point {
  return { x: snapToStep(p.x, gridSize), y: snapToStep(p.y, gridSize) };
}

/** Snaps a single point to candidate edges/centers (used while drawing and resizing). */
export function snapPointToObjects(
  p: Point,
  candidates: readonly Bounds[],
  threshold: number,
): { point: Point } & SnapGuides {
  const res = snapBoundsToObjects(
    { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y },
    candidates,
    threshold,
  );
  return { point: { x: p.x + res.dx, y: p.y + res.dy }, lines: res.lines, points: res.points };
}

/** Constrains a vector from `origin` to the nearest multiple of `step` radians. */
export function snapVectorAngle(origin: Point, p: Point, step = Math.PI / 12): Point {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return p;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: origin.x + Math.cos(angle) * len, y: origin.y + Math.sin(angle) * len };
}
