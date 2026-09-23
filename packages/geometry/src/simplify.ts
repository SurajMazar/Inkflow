import { distanceToSegment } from './segment';
import { distanceSq, type Point } from './vec';

/** Ramer–Douglas–Peucker polyline simplification. */
export function simplifyRDP<T extends Point>(points: readonly T[], tolerance: number): T[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i]!, points[start]!, points[end]!);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Removes points closer than `minDistance` to their predecessor. */
export function simplifyRadial<T extends Point>(points: readonly T[], minDistance: number): T[] {
  if (points.length <= 2) return points.slice();
  const minSq = minDistance * minDistance;
  const out: T[] = [points[0]!];
  let prev = points[0]!;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    if (distanceSq(p, prev) >= minSq) {
      out.push(p);
      prev = p;
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

export function simplifyPolyline<T extends Point>(points: readonly T[], tolerance: number): T[] {
  return simplifyRDP(simplifyRadial(points, tolerance / 2), tolerance);
}

/**
 * Exponential moving-average smoothing that preserves endpoints; `factor` in [0,1)
 * controls how strongly each point is pulled toward the running average.
 */
export function smoothPoints<T extends Point>(points: readonly T[], factor: number): T[] {
  if (points.length < 3 || factor <= 0) return points.slice();
  const out: T[] = [points[0]!];
  let prev: Point = points[0]!;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const x = prev.x * factor + p.x * (1 - factor);
    const y = prev.y * factor + p.y * (1 - factor);
    out.push({ ...p, x, y });
    prev = { x, y };
  }
  out.push(points[points.length - 1]!);
  return out;
}
