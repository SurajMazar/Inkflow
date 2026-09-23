import { getElementBounds, type LinearElement, type SceneElement } from '@inkflow/elements';

/** Layout node: axis-aligned size and current centre of the element's (rotated) bounds. */
export interface LayoutNode {
  id: string;
  index: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export interface LayoutGraph {
  nodes: LayoutNode[];
  /** Directed edges (source index → target index), deduplicated, without self loops, input order. */
  edges: [number, number][];
}

export function buildLayoutGraph(nodes: readonly SceneElement[], edges: readonly LinearElement[]): LayoutGraph {
  const list: LayoutNode[] = [];
  const byId = new Map<string, number>();
  for (const el of nodes) {
    if (byId.has(el.id)) continue;
    const b = getElementBounds(el);
    byId.set(el.id, list.length);
    list.push({
      id: el.id,
      index: list.length,
      width: Math.max(1, b.maxX - b.minX),
      height: Math.max(1, b.maxY - b.minY),
      cx: (b.minX + b.maxX) / 2,
      cy: (b.minY + b.maxY) / 2,
    });
  }
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const e of edges) {
    const s = e.startBinding ? byId.get(e.startBinding.elementId) : undefined;
    const t = e.endBinding ? byId.get(e.endBinding.elementId) : undefined;
    if (s === undefined || t === undefined || s === t) continue;
    const key = `${s}>${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([s, t]);
  }
  return { nodes: list, edges: out };
}

/** Undirected connected components, each listed in input order, ordered by their first node. */
export function connectedComponents(n: number, edges: readonly [number, number][]): number[][] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  for (const [a, b] of edges) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r) ?? [];
    g.push(i);
    groups.set(r, g);
  }
  return [...groups.values()].sort((a, b) => a[0]! - b[0]!);
}

/**
 * Weighted isotonic regression with minimum separations (pool-adjacent-violators). Minimizes
 * Σ wᵢ (xᵢ − dᵢ)² subject to xᵢ₊₁ − xᵢ ≥ gapᵢ, exactly, in O(n).
 */
export function placeWithSeparation(desired: readonly number[], weights: readonly number[], gaps: readonly number[]): number[] {
  const n = desired.length;
  if (n === 0) return [];
  const offset = new Array<number>(n);
  offset[0] = 0;
  for (let i = 1; i < n; i++) offset[i] = offset[i - 1]! + gaps[i - 1]!;
  // Blocks of pooled values.
  const value: number[] = [];
  const weight: number[] = [];
  const count: number[] = [];
  for (let i = 0; i < n; i++) {
    let v = desired[i]! - offset[i]!;
    let w = Math.max(1e-9, weights[i]!);
    let c = 1;
    while (value.length > 0 && value[value.length - 1]! >= v) {
      const pv = value.pop()!;
      const pw = weight.pop()!;
      const pc = count.pop()!;
      v = (pv * pw + v * w) / (pw + w);
      w += pw;
      c += pc;
    }
    value.push(v);
    weight.push(w);
    count.push(c);
  }
  const out = new Array<number>(n);
  let k = 0;
  for (let b = 0; b < value.length; b++) {
    for (let j = 0; j < count[b]!; j++, k++) out[k] = value[b]! + offset[k]!;
  }
  return out;
}
