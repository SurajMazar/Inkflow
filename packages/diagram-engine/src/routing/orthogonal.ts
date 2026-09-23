import type { Bounds, Point } from '@inkflow/geometry';

/** Axis direction indices: 0 = +x, 1 = −x, 2 = +y, 3 = −y. */
const DX = [1, -1, 0, 0] as const;
const DY = [0, 0, 1, -1] as const;
const OPPOSITE = [1, 0, 3, 2] as const;

export interface OrthogonalOptions {
  /** Cost of one bend, in world units of path length. */
  bendPenalty: number;
  /** Extra free space kept around the searched region (lets routes pass outside obstacles). */
  regionPadding: number;
  /** Safety limit on grid size; larger problems return null (caller falls back). */
  maxGridNodes?: number;
}

export function dirIndex(d: Point): number {
  if (Math.abs(d.x) >= Math.abs(d.y)) return d.x >= 0 ? 0 : 1;
  return d.y >= 0 ? 2 : 3;
}

export function dirVector(i: number): Point {
  return { x: DX[i]!, y: DY[i]! };
}

/** Binary min-heap keyed by (f, h, seq) for deterministic A*. */
class Heap {
  private readonly keys: number[] = [];
  private readonly f: number[] = [];
  private readonly h: number[] = [];
  private readonly seq: number[] = [];
  private counter = 0;

  get size(): number {
    return this.keys.length;
  }

  private less(a: number, b: number): boolean {
    if (this.f[a]! !== this.f[b]!) return this.f[a]! < this.f[b]!;
    if (this.h[a]! !== this.h[b]!) return this.h[a]! < this.h[b]!;
    return this.seq[a]! < this.seq[b]!;
  }

  private swap(a: number, b: number) {
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
    [this.f[a], this.f[b]] = [this.f[b]!, this.f[a]!];
    [this.h[a], this.h[b]] = [this.h[b]!, this.h[a]!];
    [this.seq[a], this.seq[b]] = [this.seq[b]!, this.seq[a]!];
  }

  push(key: number, f: number, h: number) {
    this.keys.push(key);
    this.f.push(f);
    this.h.push(h);
    this.seq.push(this.counter++);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  peekF(): number {
    return this.f[0]!;
  }

  pop(): number {
    const top = this.keys[0]!;
    const last = this.keys.length - 1;
    if (last > 0) this.swap(0, last);
    this.keys.pop();
    this.f.pop();
    this.h.pop();
    this.seq.pop();
    let i = 0;
    const n = this.keys.length;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
}

function uniqueSorted(values: number[]): number[] {
  values.sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of values) if (out.length === 0 || v - out[out.length - 1]! > 1e-6) out.push(v);
  return out;
}

function indexOfCoord(coords: readonly number[], v: number): number {
  let lo = 0;
  let hi = coords.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = coords[mid]!;
    if (Math.abs(c - v) <= 1e-6) return mid;
    if (c < v) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * Obstacle-avoiding orthogonal path from `from` to `to` on a sparse orthogonal visibility grid.
 *
 * The grid lines are the (already inflated) obstacle edges, the endpoint coordinates, their
 * midpoint and a padded outer frame. An edge between two neighbouring grid nodes is blocked when it
 * runs through the interior of an obstacle (edges along obstacle borders are allowed, since the
 * borders are already a margin away from the real shapes). A* searches states (node, heading) with
 * cost = length + bendPenalty × bends, forbids U-turns, and uses Manhattan distance plus a lower
 * bound on the remaining bends as an admissible heuristic. `startDir` fixes the initial heading
 * (null = free); `endDir` is the heading the path must have when it arrives at `to` (null = free).
 * Returns the corner points (including both ends) or null when no path exists.
 */
export function findOrthogonalPath(
  from: Point,
  to: Point,
  startDir: number | null,
  endDir: number | null,
  obstacles: readonly Bounds[],
  options: OrthogonalOptions,
): Point[] | null {
  const pad = options.regionPadding;
  let minX = Math.min(from.x, to.x);
  let minY = Math.min(from.y, to.y);
  let maxX = Math.max(from.x, to.x);
  let maxY = Math.max(from.y, to.y);
  const xsRaw: number[] = [from.x, to.x, (from.x + to.x) / 2];
  const ysRaw: number[] = [from.y, to.y, (from.y + to.y) / 2];
  for (const b of obstacles) {
    xsRaw.push(b.minX, b.maxX);
    ysRaw.push(b.minY, b.maxY);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  xsRaw.push(minX - pad, maxX + pad);
  ysRaw.push(minY - pad, maxY + pad);
  const xs = uniqueSorted(xsRaw);
  const ys = uniqueSorted(ysRaw);
  const nx = xs.length;
  const ny = ys.length;
  const total = nx * ny;
  if (total > (options.maxGridNodes ?? 400_000)) return null;

  // Edge blocking: h[j*nx+i] blocks (i,j)→(i+1,j); v[j*nx+i] blocks (i,j)→(i,j+1).
  const hBlocked = new Uint8Array(total);
  const vBlocked = new Uint8Array(total);
  for (const b of obstacles) {
    const i0 = indexOfCoord(xs, b.minX);
    const i1 = indexOfCoord(xs, b.maxX);
    const j0 = indexOfCoord(ys, b.minY);
    const j1 = indexOfCoord(ys, b.maxY);
    if (i0 < 0 || i1 < 0 || j0 < 0 || j1 < 0) continue;
    for (let j = j0 + 1; j < j1; j++) {
      const row = j * nx;
      for (let i = i0; i < i1; i++) hBlocked[row + i] = 1;
    }
    for (let j = j0; j < j1; j++) {
      const row = j * nx;
      for (let i = i0 + 1; i < i1; i++) vBlocked[row + i] = 1;
    }
  }

  const si = indexOfCoord(xs, from.x);
  const sj = indexOfCoord(ys, from.y);
  const gi = indexOfCoord(xs, to.x);
  const gj = indexOfCoord(ys, to.y);
  if (si < 0 || sj < 0 || gi < 0 || gj < 0) return null;
  const startNode = sj * nx + si;
  const goalNode = gj * nx + gi;
  const bend = options.bendPenalty;

  const g = new Float64Array(total * 4).fill(Infinity);
  const parent = new Int32Array(total * 4).fill(-1);
  const closed = new Uint8Array(total * 4);
  const heap = new Heap();
  const gx = xs[gi]!;
  const gy = ys[gj]!;

  const heuristic = (node: number, dir: number): number => {
    const x = xs[node % nx]!;
    const y = ys[(node / nx) | 0]!;
    const dx = gx - x;
    const dy = gy - y;
    let h = Math.abs(dx) + Math.abs(dy);
    const needX = Math.abs(dx) > 1e-9;
    const needY = Math.abs(dy) > 1e-9;
    if (needX && needY) h += bend;
    else if (needX) {
      if (!(dir === (dx > 0 ? 0 : 1))) h += bend;
    } else if (needY) {
      if (!(dir === (dy > 0 ? 2 : 3))) h += bend;
    }
    return h;
  };

  const arrivalPenalty = (dir: number): number => {
    if (endDir === null) return 0;
    if (dir === endDir) return 0;
    if (dir === OPPOSITE[endDir]) return Infinity;
    return bend;
  };

  const starts = startDir === null ? [0, 1, 2, 3] : [startDir];
  for (const d of starts) {
    const s = startNode * 4 + d;
    g[s] = 0;
    heap.push(s, heuristic(startNode, d), 0);
  }

  let bestState = -1;
  let bestCost = Infinity;
  if (startNode === goalNode) {
    for (const d of starts) {
      const c = arrivalPenalty(d);
      if (c < bestCost) {
        bestCost = c;
        bestState = startNode * 4 + d;
      }
    }
  }

  while (heap.size > 0) {
    if (heap.peekF() >= bestCost) break;
    const state = heap.pop();
    if (closed[state]) continue;
    closed[state] = 1;
    const node = (state / 4) | 0;
    const dir = state % 4;
    const cost = g[state]!;
    const i = node % nx;
    const j = (node / nx) | 0;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === OPPOSITE[dir] && !(startDir === null && node === startNode)) continue;
      let ni = i;
      let nj = j;
      if (nd === 0) {
        if (i + 1 >= nx || hBlocked[j * nx + i]) continue;
        ni = i + 1;
      } else if (nd === 1) {
        if (i - 1 < 0 || hBlocked[j * nx + i - 1]) continue;
        ni = i - 1;
      } else if (nd === 2) {
        if (j + 1 >= ny || vBlocked[j * nx + i]) continue;
        nj = j + 1;
      } else {
        if (j - 1 < 0 || vBlocked[(j - 1) * nx + i]) continue;
        nj = j - 1;
      }
      const next = nj * nx + ni;
      const length = Math.abs(xs[ni]! - xs[i]!) + Math.abs(ys[nj]! - ys[j]!);
      const turn = nd !== dir && !(startDir === null && node === startNode) ? bend : 0;
      const ng = cost + length + turn;
      const ns = next * 4 + nd;
      if (ng < g[ns]! - 1e-9) {
        g[ns] = ng;
        parent[ns] = state;
        if (next === goalNode) {
          const totalCost = ng + arrivalPenalty(nd);
          if (totalCost < bestCost - 1e-9) {
            bestCost = totalCost;
            bestState = ns;
          }
        }
        const h = heuristic(next, nd);
        heap.push(ns, ng + h, h);
      }
    }
  }
  if (bestState < 0) return null;

  const nodes: Point[] = [];
  for (let s = bestState; s >= 0; s = parent[s]!) {
    const node = (s / 4) | 0;
    nodes.push({ x: xs[node % nx]!, y: ys[(node / nx) | 0]! });
    if (parent[s]! < 0) break;
  }
  nodes.reverse();
  return simplifyOrthogonal(nodes);
}

/** Removes duplicate and collinear intermediate points. */
export function simplifyOrthogonal(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    out.push({ x: p.x, y: p.y });
    while (out.length >= 3) {
      const a = out[out.length - 3]!;
      const b = out[out.length - 2]!;
      const c = out[out.length - 1]!;
      const collinear = (Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6) || (Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6);
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (collinear || Math.abs(cross) < 1e-9) out.splice(out.length - 2, 1);
      else break;
    }
  }
  return out;
}
