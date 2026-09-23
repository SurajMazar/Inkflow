import { describe, expect, it } from 'vitest';
import { createElement, type ConnectorElement, type NodeElement } from '@inkflow/elements';
import { Scene } from '@inkflow/scene';
import { autoLayout, createConnector, createNode, selectConnectedComponent, type AutoLayoutKind } from '../src';

function graph(n: number, edges: [number, number][], seed = 0) {
  const nodes: NodeElement[] = [];
  for (let i = 0; i < n; i++) {
    nodes.push(createNode(i % 3 === 0 ? 'rectangle' : 'ellipse', { x: ((i * 37 + seed) % 11) * 50, y: ((i * 53 + seed) % 7) * 40, width: 80 + (i % 4) * 20, height: 40 + (i % 3) * 15 }));
  }
  const conns: ConnectorElement[] = edges.map(([a, b]) => createConnector(nodes[a]!, nodes[b]!));
  return { nodes, conns };
}

function assertNoOverlap(nodes: readonly NodeElement[], pos: Map<string, { x: number; y: number }>) {
  const boxes = nodes.map((n) => ({ ...pos.get(n.id)!, w: n.width, h: n.height }));
  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const overlap = a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
      if (overlap) overlaps.push(`${i}/${j}`);
    }
  }
  expect(overlaps).toEqual([]);
}

const TREE_EDGES: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [2, 6], [3, 7], [3, 8], [3, 9], [7, 10], [7, 11],
];
const DAG_EDGES: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [1, 4], [0, 4], [4, 5], [5, 6], [2, 6], [6, 1],
];

describe('autoLayout', () => {
  const kinds: AutoLayoutKind[] = ['hierarchical', 'tree', 'grid', 'horizontal', 'vertical', 'force'];
  it.each(kinds)('%s: no overlaps, deterministic, anchored at the original top-left', (kind) => {
    const { nodes, conns } = graph(12, kind === 'tree' ? TREE_EDGES : DAG_EDGES);
    const a = autoLayout(nodes, conns, kind);
    const b = autoLayout(nodes, conns, kind);
    expect([...a.entries()]).toEqual([...b.entries()]);
    expect(a.size).toBe(nodes.length);
    assertNoOverlap(nodes, a);
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    expect(Math.min(...[...a.values()].map((p) => p.x))).toBeCloseTo(minX, 1);
    expect(Math.min(...[...a.values()].map((p) => p.y))).toBeCloseTo(minY, 1);
  });

  it('hierarchical ranks respect edge direction (except broken cycle edges) in every direction', () => {
    const edges: [number, number][] = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [0, 4], [4, 5], [2, 5]];
    const { nodes, conns } = graph(6, edges);
    for (const direction of ['TB', 'BT', 'LR', 'RL'] as const) {
      const pos = autoLayout(nodes, conns, 'hierarchical', { direction });
      assertNoOverlap(nodes, pos);
      for (const [s, t] of edges) {
        const ps = pos.get(nodes[s]!.id)!;
        const pt = pos.get(nodes[t]!.id)!;
        const cs = { x: ps.x + nodes[s]!.width / 2, y: ps.y + nodes[s]!.height / 2 };
        const ct = { x: pt.x + nodes[t]!.width / 2, y: pt.y + nodes[t]!.height / 2 };
        if (direction === 'TB') expect(ct.y).toBeGreaterThan(cs.y);
        if (direction === 'BT') expect(ct.y).toBeLessThan(cs.y);
        if (direction === 'LR') expect(ct.x).toBeGreaterThan(cs.x);
        if (direction === 'RL') expect(ct.x).toBeLessThan(cs.x);
      }
    }
  });

  it('hierarchical handles cycles and disconnected components', () => {
    const { nodes, conns } = graph(8, [[0, 1], [1, 2], [2, 0], [4, 5]]);
    const pos = autoLayout(nodes, conns, 'hierarchical');
    expect(pos.size).toBe(8);
    assertNoOverlap(nodes, pos);
  });

  it('tree places parents above children and centres them over their subtree', () => {
    const { nodes, conns } = graph(12, TREE_EDGES);
    const pos = autoLayout(nodes, conns, 'tree', { direction: 'TB' });
    for (const [p, c] of TREE_EDGES) {
      const pp = pos.get(nodes[p]!.id)!;
      const pc = pos.get(nodes[c]!.id)!;
      expect(pp.y + nodes[p]!.height).toBeLessThan(pc.y);
    }
    const centre = (i: number) => pos.get(nodes[i]!.id)!.x + nodes[i]!.width / 2;
    expect(centre(1)).toBeCloseTo((centre(4) + centre(5)) / 2, 5);
  });

  it('tree LR is a mind map with children on both sides', () => {
    const { nodes, conns } = graph(7, [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [3, 6]]);
    const pos = autoLayout(nodes, conns, 'tree', { direction: 'LR' });
    assertNoOverlap(nodes, pos);
    const cx = (i: number) => pos.get(nodes[i]!.id)!.x + nodes[i]!.width / 2;
    const kids = [1, 2, 3, 4].map(cx);
    expect(kids.some((x) => x > cx(0))).toBe(true);
    expect(kids.some((x) => x < cx(0))).toBe(true);
    const plain = autoLayout(nodes, conns, 'tree', { direction: 'LR', mindMap: false });
    expect([1, 2, 3, 4].every((i) => plain.get(nodes[i]!.id)!.x > plain.get(nodes[0]!.id)!.x)).toBe(true);
  });

  it('grid, horizontal and vertical preserve reading order', () => {
    const nodes = [0, 1, 2, 3].map((i) => createNode('rectangle', { x: [300, 0, 150, 450][i]!, y: 0, width: 100, height: 50 }));
    const h = autoLayout(nodes, [], 'horizontal', { nodeSpacing: 20 });
    const xs = nodes.map((n) => h.get(n.id)!.x);
    expect(xs).toEqual([240, 0, 120, 360]);
    const v = autoLayout(nodes, [], 'vertical', { nodeSpacing: 10 });
    expect(nodes.map((n) => v.get(n.id)!.y)).toEqual([120, 0, 60, 180]);
    const g = autoLayout(nodes, [], 'grid');
    const order = [...nodes].sort((a, b) => g.get(a.id)!.y - g.get(b.id)!.y || g.get(a.id)!.x - g.get(b.id)!.x).map((n) => n.x);
    expect(order).toEqual([0, 150, 300, 450]);
  });

  it('force layout depends only on the seed', () => {
    const { nodes, conns } = graph(20, DAG_EDGES);
    const a = autoLayout(nodes, conns, 'force', { seed: 7 });
    const b = autoLayout(nodes, conns, 'force', { seed: 7 });
    const c = autoLayout(nodes, conns, 'force', { seed: 8 });
    expect([...a.values()]).toEqual([...b.values()]);
    expect([...a.values()]).not.toEqual([...c.values()]);
    assertNoOverlap(nodes, c);
  });

  it('handles 500-node selections within generous time limits', () => {
    const n = 500;
    const edges: [number, number][] = [];
    for (let i = 1; i < n; i++) edges.push([Math.floor((i - 1) / 3), i]);
    for (let i = 0; i < 120; i++) edges.push([(i * 7) % n, (i * 13 + 5) % n]);
    const { nodes, conns } = graph(n, edges.filter(([a, b]) => a !== b));
    let t = performance.now();
    const h = autoLayout(nodes, conns, 'hierarchical');
    const hierarchicalMs = performance.now() - t;
    t = performance.now();
    const f = autoLayout(nodes, conns, 'force');
    const forceMs = performance.now() - t;
    t = performance.now();
    autoLayout(nodes, conns, 'tree');
    const treeMs = performance.now() - t;
    expect(h.size).toBe(n);
    expect(f.size).toBe(n);
    expect(hierarchicalMs).toBeLessThan(300);
    expect(forceMs).toBeLessThan(800);
    expect(treeMs).toBeLessThan(300);
    assertNoOverlap(nodes, h);
    assertNoOverlap(nodes, f);
  });
});

describe('selectConnectedComponent', () => {
  it('collects nodes and edges reachable through bindings', () => {
    const a = createNode('rectangle');
    const b = createNode('rectangle', { x: 300 });
    const c = createNode('rectangle', { x: 600 });
    const d = createNode('rectangle', { x: 900 });
    const ab = createConnector(a, b);
    const bc = createConnector(b, c);
    const loose = createElement('arrow');
    const scene = new Scene([a, b, c, d, ab, bc, loose]);
    const ids = selectConnectedComponent(scene, [a.id]);
    expect(new Set(ids)).toEqual(new Set([a.id, b.id, c.id, ab.id, bc.id]));
    expect(selectConnectedComponent(scene, [bc.id]).length).toBe(5);
    expect(selectConnectedComponent(scene, [d.id])).toEqual([d.id]);
  });
});
