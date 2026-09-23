import { boundsFromPoints, type Bounds } from './bounds';
import type { Point } from './vec';

export interface CubicBezier {
  p0: Point;
  c1: Point;
  c2: Point;
  p1: Point;
}

export function cubicPoint(b: CubicBezier, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const c = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  return {
    x: a * b.p0.x + c * b.c1.x + d * b.c2.x + e * b.p1.x,
    y: a * b.p0.y + c * b.c1.y + d * b.c2.y + e * b.p1.y,
  };
}

export function cubicTangent(b: CubicBezier, t: number): Point {
  const mt = 1 - t;
  return {
    x: 3 * mt * mt * (b.c1.x - b.p0.x) + 6 * mt * t * (b.c2.x - b.c1.x) + 3 * t * t * (b.p1.x - b.c2.x),
    y: 3 * mt * mt * (b.c1.y - b.p0.y) + 6 * mt * t * (b.c2.y - b.c1.y) + 3 * t * t * (b.p1.y - b.c2.y),
  };
}

export function quadraticPoint(p0: Point, c: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
  };
}

/** Flattens a cubic bezier into `segments` line segments (segments + 1 points). */
export function flattenCubic(b: CubicBezier, segments = 16): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) pts.push(cubicPoint(b, i / segments));
  return pts;
}

/**
 * Converts a Catmull-Rom spline through `points` into cubic bezier segments.
 * `tension` of 0.5 matches a standard centripetal-looking smooth curve.
 */
export function catmullRomToBeziers(points: readonly Point[], tension = 0.5): CubicBezier[] {
  const out: CubicBezier[] = [];
  if (points.length < 2) return out;
  const k = tension / 3;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    out.push({
      p0: p1,
      c1: { x: p1.x + (p2.x - p0.x) * k * 2, y: p1.y + (p2.y - p0.y) * k * 2 },
      c2: { x: p2.x - (p3.x - p1.x) * k * 2, y: p2.y - (p3.y - p1.y) * k * 2 },
      p1: p2,
    });
  }
  return out;
}

/** Flattens a smooth curve through the given points. */
export function flattenCurveThrough(points: readonly Point[], segmentsPerCurve = 12): Point[] {
  if (points.length < 3) return points.map((p) => ({ ...p }));
  const beziers = catmullRomToBeziers(points);
  const out: Point[] = [];
  beziers.forEach((b, i) => {
    const pts = flattenCubic(b, segmentsPerCurve);
    out.push(...(i === 0 ? pts : pts.slice(1)));
  });
  return out;
}

export function cubicBounds(b: CubicBezier): Bounds {
  return boundsFromPoints(flattenCubic(b, 24));
}
