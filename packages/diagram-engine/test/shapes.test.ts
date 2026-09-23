import { describe, expect, it } from 'vitest';
import { createElement, createLabel } from '@inkflow/elements';
import { flattenPath, parseSvgPath, pathBounds, type Path } from '@inkflow/geometry';
import {
  BUILTIN_ICONS,
  IconRegistry,
  ShapeRegistry,
  getNodeGeometry,
  iconRegistry,
  shapeRegistry,
  type NodeShapeDefinition,
} from '../src';

const REQUIRED_SHAPES = [
  'rectangle', 'rounded-rectangle', 'circle', 'ellipse', 'diamond', 'parallelogram', 'trapezoid', 'hexagon',
  'triangle', 'database', 'document', 'multi-document', 'cloud', 'server', 'actor', 'user', 'component', 'package',
  'note', 'sticky', 'process', 'predefined-process', 'terminator', 'delay', 'manual-input', 'off-page-connector',
  'queue', 'cache', 'load-balancer', 'firewall', 'router', 'container', 'browser', 'mobile', 'api-gateway',
  'function', 'storage-bucket', 'cdn', 'lock', 'state', 'initial-state', 'final-state', 'fork-join', 'decision',
  'use-case', 'system-boundary', 'swimlane', 'org-card', 'mind-map-topic', 'custom',
];

function expectClosedWithin(path: Path, w: number, h: number, label: string) {
  expect(path.length, label).toBeGreaterThan(1);
  const subpaths = flattenPath(path);
  expect(subpaths.length, label).toBeGreaterThan(0);
  for (const s of subpaths) expect(s.closed, `${label} subpath closed`).toBe(true);
  const b = pathBounds(path);
  const eps = 1e-6;
  expect(b.minX, label).toBeGreaterThanOrEqual(-eps);
  expect(b.minY, label).toBeGreaterThanOrEqual(-eps);
  expect(b.maxX, label).toBeLessThanOrEqual(w + eps);
  expect(b.maxY, label).toBeLessThanOrEqual(h + eps);
}

function expectWithin(path: Path, w: number, h: number, label: string) {
  const b = pathBounds(path);
  const eps = 1e-6;
  expect(b.minX, label).toBeGreaterThanOrEqual(-eps);
  expect(b.minY, label).toBeGreaterThanOrEqual(-eps);
  expect(b.maxX, label).toBeLessThanOrEqual(w + eps);
  expect(b.maxY, label).toBeLessThanOrEqual(h + eps);
}

describe('shape registry', () => {
  it('contains every required shape with sane metadata', () => {
    for (const key of REQUIRED_SHAPES) expect(shapeRegistry.has(key), key).toBe(true);
    expect(shapeRegistry.list().length).toBeGreaterThanOrEqual(50);
    for (const def of shapeRegistry.list()) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.keywords.length).toBeGreaterThan(0);
      expect(def.defaultSize.width).toBeGreaterThan(0);
      expect(def.defaultSize.height).toBeGreaterThan(0);
    }
  });

  it('filters by category and registers custom definitions', () => {
    const flow = shapeRegistry.list('flowchart');
    expect(flow.length).toBeGreaterThan(5);
    expect(flow.every((d) => d.category === 'flowchart')).toBe(true);
    const reg = new ShapeRegistry();
    const def: NodeShapeDefinition = {
      key: 'my-shape',
      label: 'Mine',
      category: 'misc',
      keywords: ['x'],
      defaultSize: { width: 10, height: 10 },
      geometry: (w, h) => ({ outline: parseSvgPath(`M0 0 L${w} 0 L${w} ${h} Z`) }),
    };
    reg.register(def);
    expect(reg.get('my-shape')).toBe(def);
    expect(reg.has('nope')).toBe(false);
    expect(() => reg.register({ ...def, key: 'Bad Key' })).toThrow();
  });

  it.each(shapeRegistry.list().map((d) => [d.key, d] as const))('%s geometry is closed and within bounds', (key, def) => {
    for (const [w, h] of [
      [def.defaultSize.width, def.defaultSize.height],
      [240, 90],
      [60, 160],
    ] as const) {
      const node = createElement('node', { shape: key, width: w, height: h, customPath: key === 'custom' ? 'M50 0 L100 100 L0 100 Z' : null });
      const g = getNodeGeometry(node);
      expectClosedWithin(g.outline, w, h, `${key} outline ${w}x${h}`);
      if (g.connectionOutline) expectClosedWithin(g.connectionOutline, w, h, `${key} connection`);
      for (const d of g.details ?? []) expectWithin(d, w, h, `${key} detail`);
      for (const f of g.fills ?? []) expectClosedWithin(f, w, h, `${key} fill`);
      const lb = g.labelBox!;
      expect(lb.width).toBeGreaterThanOrEqual(0);
      expect(lb.height).toBeGreaterThanOrEqual(0);
      expect(lb.x).toBeGreaterThanOrEqual(-1e-6);
      expect(lb.y).toBeGreaterThanOrEqual(-1e-6);
      expect(lb.x + lb.width).toBeLessThanOrEqual(w + 1e-6);
      expect(lb.y + lb.height).toBeLessThanOrEqual(h + 1e-6);
    }
  });

  it('falls back to rectangle for unknown shapes and scales custom paths', () => {
    const unknown = getNodeGeometry(createElement('node', { shape: 'does-not-exist', width: 100, height: 50, roundness: 'sharp' }));
    expect(pathBounds(unknown.outline)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
    const custom = getNodeGeometry(createElement('node', { shape: 'custom', width: 200, height: 50, customPath: 'M0 0 L100 0 L50 100 Z' }));
    const b = pathBounds(custom.outline);
    expect(b.maxX).toBeCloseTo(200);
    expect(b.maxY).toBeCloseTo(50);
    const broken = getNodeGeometry(createElement('node', { shape: 'custom', width: 80, height: 40, customPath: 'M0 0 L1' }));
    expect(pathBounds(broken.outline)).toEqual({ minX: 0, minY: 0, maxX: 80, maxY: 40 });
  });

  it('respects roundness on rectangles and mirrors flipped geometry', () => {
    const sharp = getNodeGeometry(createElement('node', { shape: 'rectangle', width: 100, height: 60, roundness: 'sharp' }));
    const round = getNodeGeometry(createElement('node', { shape: 'rectangle', width: 100, height: 60, roundness: 'round' }));
    expect(sharp.outline.some((c) => c.type === 'C')).toBe(false);
    expect(round.outline.some((c) => c.type === 'C')).toBe(true);
    const tri = createElement('node', { shape: 'manual-input', width: 100, height: 60 });
    const normal = getNodeGeometry(tri);
    const flipped = getNodeGeometry({ ...tri, flipX: true });
    const first = normal.outline[0] as { x: number; y: number };
    const firstFlipped = flipped.outline[0] as { x: number; y: number };
    expect(firstFlipped.x).toBeCloseTo(100 - first.x);
    expect(firstFlipped.y).toBeCloseTo(first.y);
  });

  it('reserves an icon box above the label when a node has an icon', () => {
    const node = createElement('node', {
      shape: 'rounded-rectangle',
      width: 160,
      height: 100,
      icon: 'server',
      label: createLabel('API'),
    });
    const g = getNodeGeometry(node);
    expect(g.iconBox).toBeDefined();
    expect(g.iconBox!.y + g.iconBox!.height).toBeLessThanOrEqual(g.labelBox!.y);
  });
});

describe('icon registry', () => {
  it('has at least 50 icons whose paths parse inside the 24×24 box', () => {
    expect(BUILTIN_ICONS.length).toBeGreaterThanOrEqual(50);
    const keys = new Set<string>();
    for (const icon of iconRegistry.list()) {
      expect(keys.has(icon.key)).toBe(false);
      keys.add(icon.key);
      for (const d of [...icon.paths, ...(icon.fills ?? [])]) {
        const p = parseSvgPath(d);
        expect(p.length).toBeGreaterThan(0);
        const b = pathBounds(p);
        expect(b.minX).toBeGreaterThanOrEqual(0);
        expect(b.minY).toBeGreaterThanOrEqual(0);
        expect(b.maxX).toBeLessThanOrEqual(24);
        expect(b.maxY).toBeLessThanOrEqual(24);
      }
    }
    for (const key of ['server', 'database', 'cloud', 'api', 'queue', 'cache', 'lock', 'user', 'users', 'globe', 'kubernetes', 'function', 'firewall', 'git-branch', 'terminal']) {
      expect(iconRegistry.get(key), key).toBeDefined();
    }
  });

  it('lists by category, searches and validates registrations', () => {
    const cat = iconRegistry.list()[0]!.category;
    expect(iconRegistry.list(cat).every((i) => i.category === cat)).toBe(true);
    expect(iconRegistry.search('lambda').some((i) => i.key === 'function')).toBe(true);
    const reg = new IconRegistry();
    expect(() => reg.register({ key: 'bad', label: 'Bad', category: 'misc', keywords: [], paths: ['<script>'] })).toThrow();
    reg.register({ key: 'ok', label: 'Ok', category: 'misc', keywords: [], paths: ['M2 2 L22 22'] });
    expect(reg.get('ok')?.label).toBe('Ok');
  });
});
