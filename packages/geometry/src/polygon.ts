import type { Point } from './vec';

/** Vertices of a regular polygon inscribed in the ellipse of the given box, starting at the top. */
export function regularPolygonPoints(
  x: number,
  y: number,
  width: number,
  height: number,
  sides: number,
): Point[] {
  const n = Math.max(3, Math.floor(sides));
  const cx = x + width / 2;
  const cy = y + height / 2;
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push({ x: cx + (Math.cos(a) * width) / 2, y: cy + (Math.sin(a) * height) / 2 });
  }
  return pts;
}

/** Star vertices alternating outer/inner radius. `innerRatio` in (0,1). */
export function starPoints(
  x: number,
  y: number,
  width: number,
  height: number,
  spikes: number,
  innerRatio: number,
): Point[] {
  const n = Math.max(3, Math.floor(spikes));
  const cx = x + width / 2;
  const cy = y + height / 2;
  const pts: Point[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? 1 : innerRatio;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    pts.push({ x: cx + (Math.cos(a) * width * r) / 2, y: cy + (Math.sin(a) * height * r) / 2 });
  }
  return pts;
}

export function polygonArea(points: readonly Point[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j]!.x + points[i]!.x) * (points[j]!.y - points[i]!.y);
  }
  return Math.abs(area / 2);
}

export function polygonCentroid(points: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** Andrew's monotone chain convex hull. */
export function convexHull(points: readonly Point[]): Point[] {
  if (points.length < 3) return points.slice();
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const crossP = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossP(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && crossP(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
