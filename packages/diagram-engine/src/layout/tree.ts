import type { LayoutDirection } from '../types';
import type { LayoutGraph } from './graph';

/** Node of the tidy-tree algorithm (Walker's algorithm in Buchheim, Jünger & Leipert's O(n) form). */
interface TNode {
  node: number;
  along: number;
  across: number;
  children: TNode[];
  parent: TNode | null;
  /** Index among siblings. */
  number: number;
  depth: number;
  prelim: number;
  mod: number;
  shift: number;
  change: number;
  thread: TNode | null;
  ancestor: TNode;
  x: number;
}

function makeNode(
  node: number,
  along: number,
  across: number,
  parent: TNode | null,
  number: number,
  depth: number,
): TNode {
  const t = {
    node,
    along,
    across,
    children: [],
    parent,
    number,
    depth,
    prelim: 0,
    mod: 0,
    shift: 0,
    change: 0,
    thread: null,
    x: 0,
  } as unknown as TNode;
  t.ancestor = t;
  return t;
}

const leftSibling = (v: TNode): TNode | null =>
  v.parent && v.number > 0 ? v.parent.children[v.number - 1]! : null;
const leftmostSibling = (v: TNode): TNode | null =>
  v.parent && v.number > 0 ? v.parent.children[0]! : null;
const nextLeft = (v: TNode): TNode | null => v.children[0] ?? v.thread;
const nextRight = (v: TNode): TNode | null => v.children[v.children.length - 1] ?? v.thread;

class Tidy {
  constructor(private readonly spacing: number) {}

  private distance(a: TNode, b: TNode): number {
    const siblings = a.parent !== null && a.parent === b.parent;
    return (a.along + b.along) / 2 + (siblings ? this.spacing : this.spacing * 1.25);
  }

  layout(root: TNode): void {
    this.firstWalk(root);
    this.secondWalk(root, -root.prelim);
  }

  private firstWalk(v: TNode): void {
    if (v.children.length === 0) {
      const w = leftSibling(v);
      v.prelim = w ? w.prelim + this.distance(w, v) : 0;
      return;
    }
    let defaultAncestor = v.children[0]!;
    for (const w of v.children) {
      this.firstWalk(w);
      defaultAncestor = this.apportion(w, defaultAncestor);
    }
    this.executeShifts(v);
    const midpoint = (v.children[0]!.prelim + v.children[v.children.length - 1]!.prelim) / 2;
    const w = leftSibling(v);
    if (w) {
      v.prelim = w.prelim + this.distance(w, v);
      v.mod = v.prelim - midpoint;
    } else {
      v.prelim = midpoint;
    }
  }

  private apportion(v: TNode, defaultAncestor: TNode): TNode {
    const w = leftSibling(v);
    if (!w) return defaultAncestor;
    let vip: TNode = v;
    let vop: TNode = v;
    let vim: TNode = w;
    let vom: TNode = leftmostSibling(vip)!;
    let sip = vip.mod;
    let sop = vop.mod;
    let sim = vim.mod;
    let som = vom.mod;
    while (nextRight(vim) && nextLeft(vip)) {
      vim = nextRight(vim)!;
      vip = nextLeft(vip)!;
      vom = nextLeft(vom)!;
      vop = nextRight(vop)!;
      vop.ancestor = v;
      const shift = vim.prelim + sim - (vip.prelim + sip) + this.distance(vim, vip);
      if (shift > 0) {
        const anc = vim.ancestor.parent === v.parent ? vim.ancestor : defaultAncestor;
        this.moveSubtree(anc, v, shift);
        sip += shift;
        sop += shift;
      }
      sim += vim.mod;
      sip += vip.mod;
      som += vom.mod;
      sop += vop.mod;
    }
    if (nextRight(vim) && !nextRight(vop)) {
      vop.thread = nextRight(vim);
      vop.mod += sim - sop;
    }
    if (nextLeft(vip) && !nextLeft(vom)) {
      vom.thread = nextLeft(vip);
      vom.mod += sip - som;
      defaultAncestor = v;
    }
    return defaultAncestor;
  }

  private moveSubtree(wm: TNode, wp: TNode, shift: number): void {
    const subtrees = wp.number - wm.number;
    if (subtrees <= 0) return;
    wp.change -= shift / subtrees;
    wp.shift += shift;
    wm.change += shift / subtrees;
    wp.prelim += shift;
    wp.mod += shift;
  }

  private executeShifts(v: TNode): void {
    let shift = 0;
    let change = 0;
    for (let i = v.children.length - 1; i >= 0; i--) {
      const w = v.children[i]!;
      w.prelim += shift;
      w.mod += shift;
      change += w.change;
      shift += w.shift + change;
    }
  }

  private secondWalk(root: TNode, m: number): void {
    const stack: [TNode, number][] = [[root, m]];
    while (stack.length) {
      const [v, mod] = stack.pop()!;
      v.x = v.prelim + mod;
      for (const c of v.children) stack.push([c, mod + v.mod]);
    }
  }
}

function collect(root: TNode): TNode[] {
  const out: TNode[] = [];
  const stack = [root];
  while (stack.length) {
    const v = stack.pop()!;
    out.push(v);
    for (const c of v.children) stack.push(c);
  }
  return out;
}

/** Spanning forest: roots are nodes without incoming edges (cycles fall back to the first unvisited node). */
function buildForest(
  graph: LayoutGraph,
  alongOf: (i: number) => number,
  acrossOf: (i: number) => number,
  orderOf: (i: number) => number,
): TNode[] {
  const n = graph.nodes.length;
  const indeg = new Array<number>(n).fill(0);
  const out: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of graph.edges) {
    out[a]!.push(b);
    indeg[b]!++;
  }
  const visited = new Uint8Array(n);
  const roots: TNode[] = [];
  const grow = (rootIndex: number) => {
    const root = makeNode(rootIndex, alongOf(rootIndex), acrossOf(rootIndex), null, 0, 0);
    visited[rootIndex] = 1;
    const queue = [root];
    while (queue.length) {
      const t = queue.shift()!;
      const kids = out[t.node]!.filter((c) => !visited[c]).sort(
        (a, b) => orderOf(a) - orderOf(b) || a - b,
      );
      for (const c of kids) {
        if (visited[c]) continue;
        visited[c] = 1;
        const child = makeNode(c, alongOf(c), acrossOf(c), t, t.children.length, t.depth + 1);
        t.children.push(child);
        queue.push(child);
      }
    }
    roots.push(root);
  };
  const candidates = graph.nodes.map((_, i) => i).sort((a, b) => orderOf(a) - orderOf(b) || a - b);
  for (const i of candidates) if (indeg[i] === 0 && !visited[i]) grow(i);
  for (const i of candidates) if (!visited[i]) grow(i);
  return roots;
}

/** Depth offsets (centre of each level) from level thicknesses. */
function levelCenters(
  nodes: readonly TNode[],
  rankSpacing: number,
  rootThickness?: number,
): number[] {
  const thick: number[] = [];
  for (const v of nodes) thick[v.depth] = Math.max(thick[v.depth] ?? 0, v.across);
  if (rootThickness !== undefined) thick[0] = rootThickness;
  const centers: number[] = [];
  for (let d = 0; d < thick.length; d++) {
    const t = thick[d] ?? 0;
    centers.push(d === 0 ? t / 2 : centers[d - 1]! + (thick[d - 1] ?? 0) / 2 + rankSpacing + t / 2);
  }
  return centers;
}

function extent(nodes: readonly TNode[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of nodes) {
    min = Math.min(min, v.x - v.along / 2);
    max = Math.max(max, v.x + v.along / 2);
  }
  return { min, max };
}

/**
 * Tidy tree layout (Reingold–Tilford / Walker, linear-time variant) for a forest. Direction TB/BT
 * places depth along y; LR/RL along x. With `mindMap`, each root's subtrees are split between the
 * right and left sides (balanced by subtree size) and the root sits in the middle.
 */
export function treeLayout(
  graph: LayoutGraph,
  direction: LayoutDirection,
  nodeSpacing: number,
  rankSpacing: number,
  mindMap: boolean,
): Map<number, { x: number; y: number }> {
  const horizontal = direction === 'LR' || direction === 'RL';
  const alongOf = (i: number) => (horizontal ? graph.nodes[i]!.height : graph.nodes[i]!.width);
  const acrossOf = (i: number) => (horizontal ? graph.nodes[i]!.width : graph.nodes[i]!.height);
  const orderOf = (i: number) => (horizontal ? graph.nodes[i]!.cy : graph.nodes[i]!.cx);
  const roots = buildForest(graph, alongOf, acrossOf, orderOf);
  const tidy = new Tidy(nodeSpacing);
  const result = new Map<number, { x: number; y: number }>();
  const sign = direction === 'BT' || direction === 'RL' ? -1 : 1;
  const place = (u: number, v: number) => (horizontal ? { x: v, y: u } : { x: u, y: v });
  let offset = 0;

  for (const root of roots) {
    if (mindMap && horizontal && root.children.length > 1) {
      const size = (t: TNode): number => collect(t).length;
      const right: TNode[] = [];
      const left: TNode[] = [];
      let rs = 0;
      let ls = 0;
      for (const c of root.children) {
        const s = size(c);
        if (rs <= ls) {
          right.push(c);
          rs += s;
        } else {
          left.push(c);
          ls += s;
        }
      }
      const sides: [TNode[], number][] = [
        [right, 1],
        [left, -1],
      ];
      let minU = Infinity;
      let maxU = -Infinity;
      const placed: [number, number, number][] = [];
      for (const [kids, s] of sides) {
        if (kids.length === 0) continue;
        const virtual = makeNode(root.node, root.along, root.across, null, 0, 0);
        virtual.children = kids.map((k, i) => Object.assign(k, { parent: virtual, number: i }));
        for (const t of collect(virtual)) {
          t.prelim = t.mod = t.shift = t.change = 0;
          t.thread = null;
          t.ancestor = t;
        }
        tidy.layout(virtual);
        const nodes = collect(virtual);
        const rootX = virtual.x;
        const centers = levelCenters(nodes, rankSpacing, root.across);
        for (const t of nodes) {
          if (t === virtual) continue;
          const u = t.x - rootX;
          const v = s * (centers[t.depth]! - centers[0]!);
          placed.push([t.node, u, v]);
          minU = Math.min(minU, u - t.along / 2);
          maxU = Math.max(maxU, u + t.along / 2);
        }
      }
      placed.push([root.node, 0, 0]);
      minU = Math.min(minU, -root.along / 2);
      maxU = Math.max(maxU, root.along / 2);
      for (const [node, u, v] of placed) result.set(node, place(u - minU + offset, v));
      offset += maxU - minU + nodeSpacing * 2;
      continue;
    }
    tidy.layout(root);
    const nodes = collect(root);
    const { min, max } = extent(nodes);
    const centers = levelCenters(nodes, rankSpacing);
    for (const t of nodes) result.set(t.node, place(t.x - min + offset, sign * centers[t.depth]!));
    offset += max - min + nodeSpacing * 2;
  }
  return result;
}
