import { SeededRandom } from '@inkflow/geometry';
import type { LayoutGraph } from './graph';

/**
 * Fruchterman–Reingold force-directed layout: seeded random initial positions, repulsion k²/d
 * between every pair, attraction d²/k along edges, weak gravity toward the centre (keeps
 * disconnected components together), displacement capped by a linearly cooling temperature.
 * Followed by overlap removal. Ideal distance k grows with the average node size.
 */
export function forceLayout(
  graph: LayoutGraph,
  nodeSpacing: number,
  seed: number,
  iterationsOverride?: number,
): Map<number, { x: number; y: number }> {
  const n = graph.nodes.length;
  const result = new Map<number, { x: number; y: number }>();
  if (n === 0) return result;
  let avg = 0;
  for (const v of graph.nodes) avg += Math.max(v.width, v.height);
  avg /= n;
  const k = avg + nodeSpacing;
  const k2 = k * k;
  const rand = new SeededRandom(seed);
  const side = k * Math.sqrt(n) * 1.2;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = rand.range(-side / 2, side / 2);
    y[i] = rand.range(-side / 2, side / 2);
  }
  const iterations = iterationsOverride ?? (n <= 100 ? 300 : n <= 300 ? 180 : 120);
  const t0 = Math.max(k, side * 0.1);
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const gravity = 0.02;
  for (let it = 0; it < iterations; it++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      const xi = x[i]!;
      const yi = y[i]!;
      for (let j = i + 1; j < n; j++) {
        let ddx = xi - x[j]!;
        let ddy = yi - y[j]!;
        let d2 = ddx * ddx + ddy * ddy;
        if (d2 < 1e-6) {
          // Coincident: separate deterministically.
          ddx = ((i * 31 + j * 17) % 7) - 3 || 1;
          ddy = ((i * 13 + j * 29) % 5) - 2 || 1;
          d2 = ddx * ddx + ddy * ddy;
        }
        const f = k2 / d2; // (k²/d) / d → multiply by the vector (ddx, ddy)
        dx[i] = dx[i]! + ddx * f;
        dy[i] = dy[i]! + ddy * f;
        dx[j] = dx[j]! - ddx * f;
        dy[j] = dy[j]! - ddy * f;
      }
    }
    for (const [a, b] of graph.edges) {
      const ddx = x[a]! - x[b]!;
      const ddy = y[a]! - y[b]!;
      const d = Math.sqrt(ddx * ddx + ddy * ddy) || 1e-3;
      const f = d / k; // (d²/k) / d
      dx[a] = dx[a]! - ddx * f;
      dy[a] = dy[a]! - ddy * f;
      dx[b] = dx[b]! + ddx * f;
      dy[b] = dy[b]! + ddy * f;
    }
    const t = t0 * (1 - it / iterations) + 0.5;
    for (let i = 0; i < n; i++) {
      const gx = dx[i]! - x[i]! * gravity * k * 0.01;
      const gy = dy[i]! - y[i]! * gravity * k * 0.01;
      const len = Math.sqrt(gx * gx + gy * gy);
      if (len < 1e-9) continue;
      const step = Math.min(len, t);
      x[i] = x[i]! + (gx / len) * step;
      y[i] = y[i]! + (gy / len) * step;
    }
  }
  removeOverlaps(
    graph.nodes.map((v) => v.width),
    graph.nodes.map((v) => v.height),
    x,
    y,
    nodeSpacing / 2,
  );
  for (let i = 0; i < n; i++) result.set(i, { x: x[i]!, y: y[i]! });
  return result;
}

/**
 * Iterative overlap removal: every overlapping pair (boxes grown by `gap`) is pushed apart along
 * the axis of least penetration, half each, until no pair overlaps. Candidate pairs come from a
 * sweep over x-sorted boxes. Deterministic (fixed processing order).
 */
export function removeOverlaps(w: readonly number[], h: readonly number[], x: Float64Array, y: Float64Array, gap: number): void {
  const n = w.length;
  const order = Array.from({ length: n }, (_, i) => i);
  for (let pass = 0; pass < 1000; pass++) {
    let moved = false;
    order.sort((a, b) => x[a]! - w[a]! / 2 - (x[b]! - w[b]! / 2) || a - b);
    for (let oi = 0; oi < n; oi++) {
      const i = order[oi]!;
      for (let oj = oi + 1; oj < n; oj++) {
        const j = order[oj]!;
        if (x[j]! - w[j]! / 2 >= x[i]! + w[i]! / 2 + gap) break;
        const ox = (w[i]! + w[j]!) / 2 + gap - Math.abs(x[i]! - x[j]!);
        const oy = (h[i]! + h[j]!) / 2 + gap - Math.abs(y[i]! - y[j]!);
        if (ox <= 1e-6 || oy <= 1e-6) continue;
        moved = true;
        if (ox < oy) {
          const s = x[i]! < x[j]! || (x[i] === x[j] && i < j) ? -1 : 1;
          x[i] = x[i]! + (s * ox) / 2;
          x[j] = x[j]! - (s * ox) / 2;
        } else {
          const s = y[i]! < y[j]! || (y[i] === y[j] && i < j) ? -1 : 1;
          y[i] = y[i]! + (s * oy) / 2;
          y[j] = y[j]! - (s * oy) / 2;
        }
      }
    }
    if (!moved) return;
  }
}
