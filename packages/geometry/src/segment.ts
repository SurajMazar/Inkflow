import type { Bounds } from './bounds';
import { cross, distance, sub, type Point } from './vec';

export interface Segment {
  a: Point;
  b: Point;
}

/** Closest point on segment ab to p, and the parameter t ∈ [0, 1]. */
export function closestPointOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { point: { x: a.x, y: a.y }, t: 0 };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { point: { x: a.x + dx * t, y: a.y + dy * t }, t };
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  return distance(p, closestPointOnSegment(p, a, b).point);
}

export function distanceToPolyline(p: Point, points: readonly Point[], closed = false): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return distance(p, points[0]!);
  let min = Infinity;
  const n = points.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const d = distanceToSegment(p, points[i]!, points[(i + 1) % n]!);
    if (d < min) min = d;
  }
  return min;
}

/** Intersection point of segments p1p2 and p3p4, or null. */
export function segmentIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const r = sub(p2, p1);
  const s = sub(p4, p3);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const qp = sub(p3, p1);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * r.x, y: p1.y + t * r.y };
}

/** Intersection of infinite line (p1, p2) with segment (p3, p4). Returns t along the line too. */
export function lineSegmentIntersection(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
): { point: Point; t: number } | null {
  const r = sub(p2, p1);
  const s = sub(p4, p3);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const qp = sub(p3, p1);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  if (u < 0 || u > 1) return null;
  return { point: { x: p1.x + t * r.x, y: p1.y + t * r.y }, t };
}

export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  return segmentIntersection(p1, p2, p3, p4) !== null;
}

export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function segmentIntersectsBounds(a: Point, b: Point, bounds: Bounds): boolean {
  const inside = (p: Point) => p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY;
  if (inside(a) || inside(b)) return true;
  const tl = { x: bounds.minX, y: bounds.minY };
  const tr = { x: bounds.maxX, y: bounds.minY };
  const br = { x: bounds.maxX, y: bounds.maxY };
  const bl = { x: bounds.minX, y: bounds.maxY };
  return (
    segmentsIntersect(a, b, tl, tr) ||
    segmentsIntersect(a, b, tr, br) ||
    segmentsIntersect(a, b, br, bl) ||
    segmentsIntersect(a, b, bl, tl)
  );
}

export function polylineIntersectsBounds(points: readonly Point[], bounds: Bounds, closed = false): boolean {
  const n = points.length;
  if (n === 1) return segmentIntersectsBounds(points[0]!, points[0]!, bounds);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    if (segmentIntersectsBounds(points[i]!, points[(i + 1) % n]!, bounds)) return true;
  }
  return false;
}

export function polylineLength(points: readonly Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += distance(points[i - 1]!, points[i]!);
  return len;
}

/** Point at a normalized distance t ∈ [0,1] along a polyline, with the segment direction angle. */
export function pointAlongPolyline(points: readonly Point[], t: number): { point: Point; angle: number } {
  if (points.length === 0) return { point: { x: 0, y: 0 }, angle: 0 };
  if (points.length === 1) return { point: { ...points[0]! }, angle: 0 };
  const total = polylineLength(points);
  let target = total * Math.max(0, Math.min(1, t));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = distance(a, b);
    if (target <= seg || i === points.length - 1) {
      const k = seg === 0 ? 0 : Math.min(1, target / seg);
      return {
        point: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k },
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      };
    }
    target -= seg;
  }
  const a = points[points.length - 2]!;
  const b = points[points.length - 1]!;
  return { point: { ...b }, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** Nearest parameter t ∈ [0,1] along the polyline to point p. */
export function nearestTOnPolyline(points: readonly Point[], p: Point): number {
  const total = polylineLength(points);
  if (total === 0) return 0;
  let best = Infinity;
  let bestLen = 0;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const { point, t } = closestPointOnSegment(p, a, b);
    const d = distance(point, p);
    const seg = distance(a, b);
    if (d < best) {
      best = d;
      bestLen = acc + seg * t;
    }
    acc += seg;
  }
  return bestLen / total;
}
