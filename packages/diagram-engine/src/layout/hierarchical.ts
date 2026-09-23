import type { LayoutDirection } from '../types';
import { connectedComponents, placeWithSeparation, type LayoutGraph } from './graph';

interface Vertex {
  /** Index into the layout graph nodes, or −1 for dummy vertices. */
  node: number;
  layer: number;
  along: number;
  across: number;
  up: number[];
  down: number[];
}

const DUMMY_WIDTH = 2;

/** Sugiyama layered layout; returns centres keyed by node index. */
export function hierarchicalLayout(
  graph: LayoutGraph,
  direction: LayoutDirection,
  nodeSpacing: number,
  rankSpacing: number,
): Map<number, { x: number; y: number }> {
  const horizontal = direction === 'LR' || direction === 'RL';
  const along = (i: number) => (horizontal ? graph.nodes[i]!.height : graph.nodes[i]!.width);
  const across = (i: number) => (horizontal ? graph.nodes[i]!.width : graph.nodes[i]!.height);
  const result = new Map<number, { x: number; y: number }>();
  let offsetU = 0;
  for (const comp of connectedComponents(graph.nodes.length, graph.edges)) {
    const inComp = new Set(comp);
    const edges = graph.edges.filter(([a]) => inComp.has(a));
    const placed = layoutComponent(comp, edges, along, across, nodeSpacing, rankSpacing);
    let minU = Infinity;
    let maxU = -Infinity;
    for (const [i, p] of placed) {
      minU = Math.min(minU, p.u - along(i) / 2);
      maxU = Math.max(maxU, p.u + along(i) / 2);
    }
    for (const [i, p] of placed) {
      const u = p.u - minU + offsetU;
      const v = p.v;
      result.set(i, mapAxes(u, v, direction));
    }
    offsetU += maxU - minU + nodeSpacing * 2;
  }
  return result;
}

function mapAxes(u: number, v: number, direction: LayoutDirection): { x: number; y: number } {
  switch (direction) {
    case 'TB':
      return { x: u, y: v };
    case 'BT':
      return { x: u, y: -v };
    case 'LR':
      return { x: v, y: u };
    case 'RL':
      return { x: -v, y: u };
  }
}

/** Depth-first cycle breaking: back edges are reversed (Eades et al. DFS heuristic). */
export function breakCycles(nodes: readonly number[], edges: readonly [number, number][]): [number, number][] {
  const out = new Map<number, number[]>();
  for (const n of nodes) out.set(n, []);
  edges.forEach(([a], k) => out.get(a)!.push(k));
  const state = new Map<number, 0 | 1 | 2>();
  const reversed = new Set<number>();
  for (const root of nodes) {
    if (state.get(root)) continue;
    const stack: { node: number; next: number }[] = [{ node: root, next: 0 }];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const list = out.get(top.node)!;
      if (top.next >= list.length) {
        state.set(top.node, 2);
        stack.pop();
        continue;
      }
      const k = list[top.next++]!;
      const target = edges[k]![1];
      const s = state.get(target) ?? 0;
      if (s === 1) reversed.add(k);
      else if (s === 0) {
        state.set(target, 1);
        stack.push({ node: target, next: 0 });
      }
    }
  }
  return edges.map(([a, b], k) => (reversed.has(k) ? [b, a] : [a, b]));
}

/** Longest-path layering (sources at layer 0), then sources pulled down next to their successors. */
export function assignLayers(nodes: readonly number[], dag: readonly [number, number][]): Map<number, number> {
  const preds = new Map<number, number[]>();
  const succs = new Map<number, number[]>();
  for (const n of nodes) {
    preds.set(n, []);
    succs.set(n, []);
  }
  for (const [a, b] of dag) {
    succs.get(a)!.push(b);
    preds.get(b)!.push(a);
  }
  const indeg = new Map(nodes.map((n) => [n, preds.get(n)!.length]));
  const order: number[] = [];
  const queue = nodes.filter((n) => indeg.get(n) === 0);
  while (queue.length) {
    queue.sort((a, b) => a - b);
    const n = queue.shift()!;
    order.push(n);
    for (const s of succs.get(n)!) {
      const d = indeg.get(s)! - 1;
      indeg.set(s, d);
      if (d === 0) queue.push(s);
    }
  }
  const layer = new Map<number, number>();
  for (const n of order) {
    let l = 0;
    for (const p of preds.get(n)!) l = Math.max(l, layer.get(p)! + 1);
    layer.set(n, l);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i]!;
    const s = succs.get(n)!;
    if (preds.get(n)!.length === 0 && s.length > 0) {
      layer.set(n, Math.min(...s.map((x) => layer.get(x)!)) - 1);
    }
  }
  const min = Math.min(...[...layer.values()]);
  for (const [n, l] of layer) layer.set(n, l - min);
  return layer;
}

/** Number of crossings between two adjacent layers (inversion count with a Fenwick tree). */
function countCrossings(upper: readonly number[], lower: readonly number[], vertices: readonly Vertex[], pos: Int32Array): number {
  const pairs: [number, number][] = [];
  for (const v of upper) for (const w of vertices[v]!.down) pairs.push([pos[v]!, pos[w]!]);
  if (pairs.length < 2) return 0;
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const size = lower.length + 1;
  const tree = new Int32Array(size + 1);
  let crossings = 0;
  for (let k = 0; k < pairs.length; k++) {
    const p = pairs[k]![1] + 1;
    // count of previously inserted with position > p
    let le = 0;
    for (let i = p; i > 0; i -= i & -i) le += tree[i]!;
    crossings += k - le;
    for (let i = p; i <= size; i += i & -i) tree[i] = tree[i]! + 1;
  }
  return crossings;
}

function layoutComponent(
  comp: readonly number[],
  edges: readonly [number, number][],
  along: (i: number) => number,
  across: (i: number) => number,
  nodeSpacing: number,
  rankSpacing: number,
): Map<number, { u: number; v: number }> {
  const dag = breakCycles(comp, edges);
  const layerOf = assignLayers(comp, dag);
  const vertices: Vertex[] = [];
  const vertexOf = new Map<number, number>();
  for (const n of comp) {
    vertexOf.set(n, vertices.length);
    vertices.push({ node: n, layer: layerOf.get(n)!, along: along(n), across: across(n), up: [], down: [] });
  }
  for (const [a, b] of dag) {
    let prev = vertexOf.get(a)!;
    const la = layerOf.get(a)!;
    const lb = layerOf.get(b)!;
    for (let l = la + 1; l < lb; l++) {
      const d = vertices.length;
      vertices.push({ node: -1, layer: l, along: DUMMY_WIDTH, across: 0, up: [prev], down: [] });
      vertices[prev]!.down.push(d);
      prev = d;
    }
    const target = vertexOf.get(b)!;
    vertices[prev]!.down.push(target);
    vertices[target]!.up.push(prev);
  }
  const layerCount = Math.max(...vertices.map((v) => v.layer)) + 1;
  const layers: number[][] = Array.from({ length: layerCount }, () => []);
  vertices.forEach((v, i) => layers[v.layer]!.push(i));

  // Initial order: breadth-first from the top layer so connected vertices start close together.
  const pos = new Int32Array(vertices.length);
  const orderKey = new Float64Array(vertices.length);
  for (let l = 0; l < layerCount; l++) {
    const layer = layers[l]!;
    for (const v of layer) {
      const vert = vertices[v]!;
      orderKey[v] = l === 0 || vert.up.length === 0 ? (vert.node >= 0 ? vert.node : v) : average(vert.up.map((u) => pos[u]!)) * 1e6 + v;
    }
    layer.sort((a, b) => orderKey[a]! - orderKey[b]! || a - b);
    layer.forEach((v, i) => (pos[v] = i));
  }

  // Crossing minimization: alternating barycenter sweeps, keeping the best ordering seen.
  const totalCrossings = () => {
    let c = 0;
    for (let l = 0; l < layerCount - 1; l++) c += countCrossings(layers[l]!, layers[l + 1]!, vertices, pos);
    return c;
  };
  let best = totalCrossings();
  let bestLayers = layers.map((l) => l.slice());
  let stale = 0;
  const bary = new Float64Array(vertices.length);
  for (let iter = 0; iter < 24 && best > 0 && stale < 6; iter++) {
    const downward = iter % 2 === 0;
    const range = downward ? rangeUp(1, layerCount) : rangeDown(layerCount - 2, 0);
    for (const l of range) {
      const layer = layers[l]!;
      for (const v of layer) {
        const nb = downward ? vertices[v]!.up : vertices[v]!.down;
        bary[v] = nb.length ? average(nb.map((u) => pos[u]!)) : pos[v]!;
      }
      layer.sort((a, b) => bary[a]! - bary[b]! || pos[a]! - pos[b]!);
      layer.forEach((v, i) => (pos[v] = i));
    }
    const c = totalCrossings();
    if (c < best) {
      best = c;
      bestLayers = layers.map((x) => x.slice());
      stale = 0;
    } else stale++;
  }
  for (let l = 0; l < layerCount; l++) {
    layers[l] = bestLayers[l]!;
    layers[l]!.forEach((v, i) => (pos[v] = i));
  }

  // Coordinate assignment: priority-weighted barycentric placement, solved exactly per layer as a
  // separation-constrained least-squares problem (dummy vertices weigh more so long edges stay straight).
  const sep = (a: Vertex, b: Vertex) => {
    const gap = a.node < 0 && b.node < 0 ? nodeSpacing * 0.25 : a.node < 0 || b.node < 0 ? nodeSpacing * 0.5 : nodeSpacing;
    return (a.along + b.along) / 2 + gap;
  };
  const u = new Float64Array(vertices.length);
  for (const layer of layers) {
    let x = 0;
    layer.forEach((v, i) => {
      if (i > 0) x += sep(vertices[layer[i - 1]!]!, vertices[v]!);
      u[v] = x;
    });
  }
  const priority = (v: Vertex) => (v.node < 0 ? 8 : 1) * Math.max(1, v.up.length + v.down.length);
  const passes = ['down', 'up', 'down', 'up', 'both', 'up', 'both', 'down'] as const;
  for (const pass of passes) {
    const order = pass === 'up' ? rangeDown(layerCount - 1, 0) : rangeUp(0, layerCount);
    for (const l of order) {
      const layer = layers[l]!;
      const desired: number[] = [];
      const weights: number[] = [];
      const gaps: number[] = [];
      layer.forEach((v, i) => {
        const vert = vertices[v]!;
        const nb = pass === 'down' ? vert.up : pass === 'up' ? vert.down : [...vert.up, ...vert.down];
        desired.push(nb.length ? average(nb.map((w) => u[w]!)) : u[v]!);
        weights.push(nb.length ? priority(vert) : 0.01);
        if (i > 0) gaps.push(sep(vertices[layer[i - 1]!]!, vert));
      });
      const placed = placeWithSeparation(desired, weights, gaps);
      layer.forEach((v, i) => (u[v] = placed[i]!));
    }
  }

  // Rank coordinates: each layer is as thick as its thickest node.
  const thickness = layers.map((layer) => Math.max(0, ...layer.map((v) => vertices[v]!.across)));
  const centerV: number[] = [];
  for (let l = 0; l < layerCount; l++) {
    centerV.push(l === 0 ? thickness[0]! / 2 : centerV[l - 1]! + thickness[l - 1]! / 2 + rankSpacing + thickness[l]! / 2);
  }
  const out = new Map<number, { u: number; v: number }>();
  vertices.forEach((vert, i) => {
    if (vert.node >= 0) out.set(vert.node, { u: u[i]!, v: centerV[vert.layer]! });
  });
  return out;
}

function average(values: readonly number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function rangeUp(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(i);
  return out;
}

function rangeDown(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i >= to; i--) out.push(i);
  return out;
}
