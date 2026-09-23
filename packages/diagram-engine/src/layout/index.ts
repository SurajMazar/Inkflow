import { isLinearElement, type LinearElement, type SceneElement } from '@inkflow/elements';
import type { Scene } from '@inkflow/scene';
import type { AutoLayoutKind, AutoLayoutOptions } from '../types';
import { buildLayoutGraph, type LayoutNode } from './graph';
import { forceLayout } from './force';
import { hierarchicalLayout } from './hierarchical';
import { treeLayout } from './tree';

export const DEFAULT_NODE_SPACING = 40;
export const DEFAULT_RANK_SPACING = 70;

/** Reading order: rows (by vertical centre, grouped when they overlap vertically), then left to right. */
export function readingOrder(nodes: readonly LayoutNode[]): LayoutNode[] {
  const sorted = [...nodes].sort((a, b) => a.cy - b.cy || a.cx - b.cx || a.index - b.index);
  const rows: LayoutNode[][] = [];
  for (const n of sorted) {
    const row = rows[rows.length - 1];
    if (row) {
      const ref = row[0]!;
      if (Math.abs(n.cy - ref.cy) <= Math.max(ref.height, n.height) / 2) {
        row.push(n);
        continue;
      }
    }
    rows.push([n]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.cx - b.cx || a.index - b.index));
}

function gridLayout(nodes: readonly LayoutNode[], spacing: number): Map<number, { x: number; y: number }> {
  const ordered = readingOrder(nodes);
  const n = ordered.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);
  const colW = new Array<number>(cols).fill(0);
  const rowH = new Array<number>(rows).fill(0);
  ordered.forEach((v, i) => {
    colW[i % cols] = Math.max(colW[i % cols]!, v.width);
    rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)]!, v.height);
  });
  const colX: number[] = [];
  const rowY: number[] = [];
  let acc = 0;
  for (let c = 0; c < cols; c++) {
    colX.push(acc + colW[c]! / 2);
    acc += colW[c]! + spacing;
  }
  acc = 0;
  for (let r = 0; r < rows; r++) {
    rowY.push(acc + rowH[r]! / 2);
    acc += rowH[r]! + spacing;
  }
  const out = new Map<number, { x: number; y: number }>();
  ordered.forEach((v, i) => out.set(v.index, { x: colX[i % cols]!, y: rowY[Math.floor(i / cols)]! }));
  return out;
}

function lineLayout(nodes: readonly LayoutNode[], spacing: number, horizontal: boolean): Map<number, { x: number; y: number }> {
  const ordered = [...nodes].sort((a, b) =>
    horizontal ? a.cx - b.cx || a.cy - b.cy || a.index - b.index : a.cy - b.cy || a.cx - b.cx || a.index - b.index,
  );
  const thickness = Math.max(0, ...ordered.map((v) => (horizontal ? v.height : v.width)));
  const out = new Map<number, { x: number; y: number }>();
  let acc = 0;
  for (const v of ordered) {
    const size = horizontal ? v.width : v.height;
    const c = acc + size / 2;
    out.set(v.index, horizontal ? { x: c, y: thickness / 2 } : { x: thickness / 2, y: c });
    acc += size + spacing;
  }
  return out;
}

/**
 * Computes new top-left positions for `nodes` (edges are arrows/connectors bound between them).
 * All algorithms are deterministic, honour node sizes (rotated nodes by their bounds) and produce
 * non-overlapping results; the laid-out block is anchored at the original selection's top-left.
 *
 * - `hierarchical`: Sugiyama (DFS cycle breaking, longest-path layering, dummy nodes, barycentric
 *   crossing minimization, priority coordinate assignment), direction TB/BT/LR/RL.
 * - `tree`: tidy tree (Walker / Buchheim) per root; LR defaults to mind-map (both sides).
 * - `grid`: near-square grid in reading order. `horizontal` / `vertical`: one row / column.
 * - `force`: Fruchterman–Reingold with seeded initial positions and overlap removal.
 */
export function autoLayout(
  nodes: readonly SceneElement[],
  edges: readonly LinearElement[],
  kind: AutoLayoutKind,
  options: AutoLayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const layoutNodes = nodes.filter((n) => !isLinearElement(n) && n.type !== 'freedraw' && !n.isDeleted);
  const graph = buildLayoutGraph(layoutNodes, edges);
  const out = new Map<string, { x: number; y: number }>();
  if (graph.nodes.length === 0) return out;
  const spacing = options.nodeSpacing ?? DEFAULT_NODE_SPACING;
  const rankSpacing = options.rankSpacing ?? DEFAULT_RANK_SPACING;
  const direction = options.direction ?? (kind === 'tree' && options.mindMap ? 'LR' : 'TB');
  let centers: Map<number, { x: number; y: number }>;
  switch (kind) {
    case 'hierarchical':
      centers = hierarchicalLayout(graph, direction, spacing, rankSpacing);
      break;
    case 'tree':
      centers = treeLayout(graph, direction, spacing, rankSpacing, options.mindMap ?? direction === 'LR');
      break;
    case 'grid':
      centers = gridLayout(graph.nodes, spacing);
      break;
    case 'horizontal':
      centers = lineLayout(graph.nodes, spacing, true);
      break;
    case 'vertical':
      centers = lineLayout(graph.nodes, spacing, false);
      break;
    case 'force':
      centers = forceLayout(graph, spacing, options.seed ?? 1, options.iterations);
      break;
  }
  // Anchor: the new block's top-left equals the original selection's top-left.
  let oMinX = Infinity;
  let oMinY = Infinity;
  let nMinX = Infinity;
  let nMinY = Infinity;
  for (const v of graph.nodes) {
    oMinX = Math.min(oMinX, v.cx - v.width / 2);
    oMinY = Math.min(oMinY, v.cy - v.height / 2);
    const c = centers.get(v.index)!;
    nMinX = Math.min(nMinX, c.x - v.width / 2);
    nMinY = Math.min(nMinY, c.y - v.height / 2);
  }
  const dx = oMinX - nMinX;
  const dy = oMinY - nMinY;
  const byId = new Map(layoutNodes.map((n) => [n.id, n]));
  for (const v of graph.nodes) {
    const c = centers.get(v.index)!;
    const el = byId.get(v.id)!;
    const x = c.x + dx - el.width / 2;
    const y = c.y + dy - el.height / 2;
    out.set(v.id, { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  }
  return out;
}

/** Nodes and edges reachable from `startIds` through arrow/connector bindings (breadth first). */
export function selectConnectedComponent(scene: Scene, startIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const queue: string[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    const el = scene.getLiveElement(id);
    if (!el) return;
    seen.add(id);
    out.push(id);
    queue.push(id);
  };
  for (const id of startIds) visit(id);
  while (queue.length) {
    const id = queue.shift()!;
    const el = scene.getLiveElement(id)!;
    if (isLinearElement(el)) {
      if (el.startBinding) visit(el.startBinding.elementId);
      if (el.endBinding) visit(el.endBinding.elementId);
    } else {
      for (const l of scene.getBoundLinears(id)) visit(l.id);
    }
  }
  return out;
}
