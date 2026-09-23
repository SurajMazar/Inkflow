import { describe, expect, it } from 'vitest';
import {
  createBinding,
  createEdgeLabel,
  createLabel,
  createTableColumn,
  type SceneElement,
} from '@inkflow/elements';
import type { PathCommand, Point } from '@inkflow/geometry';
import {
  DrawableCache,
  arrowheadGeometry,
  generateElementDrawable,
  measureRenderPadding,
  type DrawLayer,
  type ShapeLayer,
  type TextLayer,
} from '../src';
import { make } from './fixtures';

function flatLayers(layers: readonly DrawLayer[]): DrawLayer[] {
  return layers.flatMap((l) => (l.kind === 'group' ? [l, ...flatLayers(l.children)] : [l]));
}
const shapes = (layers: readonly DrawLayer[]) =>
  flatLayers(layers).filter((l): l is ShapeLayer => l.kind === 'shape');
const texts = (layers: readonly DrawLayer[]) =>
  flatLayers(layers).filter((l): l is TextLayer => l.kind === 'text');
const pts = (path: PathCommand[]): Point[] =>
  path.flatMap((c) => (c.type === 'Z' ? [] : [{ x: c.x, y: c.y }]));

describe('generateElementDrawable', () => {
  it('draws every element type', () => {
    const elements: SceneElement[] = [
      make('rectangle', { width: 100, height: 60, backgroundColor: '#ffc9c9' }),
      make('ellipse', { width: 100, height: 60 }),
      make('diamond', { width: 100, height: 60, roundness: 'round' }),
      make('triangle', { width: 100, height: 60 }),
      make('polygon', { width: 100, height: 60, sides: 6 }),
      make('star', { width: 100, height: 100, spikes: 5 }),
      make('line', {
        points: [
          [0, 0],
          [50, 20],
          [100, 0],
        ],
        width: 100,
        height: 20,
        pathStyle: 'curved',
      }),
      make('arrow', {
        points: [
          [0, 0],
          [100, 0],
        ],
        width: 100,
        height: 0,
      }),
      make('connector', {
        points: [
          [0, 0],
          [50, 0],
          [50, 50],
          [100, 50],
        ],
        width: 100,
        height: 50,
        routing: 'orthogonal',
        roundness: 'round',
      }),
      make('freedraw', {
        points: [
          [0, 0, 0.5],
          [10, 10, 0.5],
          [20, 5, 0.5],
        ],
        width: 20,
        height: 10,
      }),
      make('text', { text: 'Hello\nworld', width: 80, height: 50 }),
      make('image', { fileId: 'f1', width: 80, height: 50 }),
      make('frame', { width: 300, height: 200, backgroundColor: '#f8f9fa' }),
      make('node', {
        shape: 'database',
        width: 120,
        height: 80,
        label: createLabel('DB'),
        icon: 'database',
      }),
      make('table', {
        name: 'users',
        width: 200,
        height: 120,
        columns: [
          createTableColumn('id', { primaryKey: true }),
          createTableColumn('org_id', { foreignKey: true }),
        ],
      }),
      make('uml-class', {
        name: 'Shape',
        stereotype: 'abstract',
        isAbstract: true,
        attributes: ['+x: number'],
        methods: ['+area(): number*'],
        width: 160,
        height: 120,
      }),
      make('sequence', {
        width: 400,
        height: 300,
        participants: [
          { id: 'a', name: 'User', kind: 'actor' },
          { id: 'b', name: 'API', kind: 'participant' },
          { id: 'c', name: 'DB', kind: 'database' },
          { id: 'd', name: 'UI', kind: 'boundary' },
          { id: 'e', name: 'Ctl', kind: 'control' },
          { id: 'f', name: 'Ent', kind: 'entity' },
        ],
        messages: [
          { id: 'm1', from: 'a', to: 'b', label: 'request', kind: 'sync' },
          { id: 'm2', from: 'b', to: 'b', label: 'validate', kind: 'sync' },
          { id: 'm3', from: 'b', to: 'c', label: 'query', kind: 'async' },
          { id: 'm4', from: 'c', to: 'b', label: 'rows', kind: 'return' },
          { id: 'm5', from: 'b', to: 'f', label: 'new', kind: 'create' },
          { id: 'm6', from: 'b', to: 'f', label: 'drop', kind: 'destroy' },
        ],
        notes: [{ id: 'n1', participants: ['a', 'b'], afterMessage: 0, text: 'A note' }],
      }),
    ];
    for (const el of elements) {
      const d = generateElementDrawable(el);
      expect(d.layers.length, el.type).toBeGreaterThan(0);
      expect(Number.isFinite(d.localBounds.minX), el.type).toBe(true);
      expect(d.complexity, el.type).toBeGreaterThan(0);
    }
  });

  it('draws the UML abstract name in italics and the stereotype', () => {
    const d = generateElementDrawable(
      make('uml-class', {
        name: 'Shape',
        stereotype: 'interface',
        isAbstract: true,
        attributes: ['a'],
        methods: ['b()'],
        width: 160,
        height: 120,
      }),
    );
    const t = texts(d.layers);
    expect(t.some((l) => l.runs[0]!.text === '«interface»')).toBe(true);
    const name = t.find((l) => l.runs[0]!.text === 'Shape')!;
    expect(name.fontStyle).toBe('italic');
    expect(name.fontWeight).toBe('bold');
  });

  it('draws table header, PK/FK badges and type column', () => {
    const d = generateElementDrawable(
      make('table', {
        name: 'orders',
        width: 220,
        height: 110,
        columns: [
          createTableColumn('id', { primaryKey: true, dataType: 'uuid' }),
          createTableColumn('user_id', { foreignKey: true, dataType: 'uuid' }),
        ],
      }),
    );
    const words = texts(d.layers).map((l) => l.runs[0]!.text);
    expect(words).toEqual(expect.arrayContaining(['orders', 'PK', 'FK', 'id', 'user_id']));
  });

  it('sequence diagrams draw dashed lifelines and messages by kind', () => {
    const d = generateElementDrawable(
      make('sequence', {
        width: 300,
        height: 200,
        participants: [
          { id: 'a', name: 'A', kind: 'participant' },
          { id: 'b', name: 'B', kind: 'participant' },
        ],
        messages: [
          { id: 'm1', from: 'a', to: 'b', label: 'call', kind: 'sync' },
          { id: 'm2', from: 'b', to: 'a', label: 'ret', kind: 'return' },
        ],
        notes: [],
      }),
    );
    const s = shapes(d.layers);
    const dashed = s.filter((l) => l.stroke?.dash);
    expect(dashed.length).toBeGreaterThanOrEqual(3); // two lifelines + return message
    const filledHeads = s.filter((l) => l.fill && l.fill === l.stroke?.color);
    expect(filledHeads.length).toBeGreaterThanOrEqual(1); // sync filled arrowhead
    expect(texts(d.layers).map((l) => l.runs[0]!.text)).toEqual(
      expect.arrayContaining(['call', 'ret', 'A', 'B']),
    );
  });

  it('nodes draw outline, details, icon and a label in the label box', () => {
    const d = generateElementDrawable(
      make('node', {
        shape: 'database',
        width: 120,
        height: 90,
        label: createLabel('Postgres'),
        icon: 'database',
      }),
    );
    expect(shapes(d.layers).length).toBeGreaterThanOrEqual(2);
    expect(d.labelLayers).toHaveLength(1);
    const label = d.labelLayers[0] as TextLayer;
    expect(label.runs[0]!.text).toBe('Postgres');
    expect(label.align).toBe('center');
  });

  it('wraps shape labels to the label box and uses label.color ?? strokeColor', () => {
    const el = make('rectangle', {
      width: 120,
      height: 80,
      strokeColor: '#1971c2',
      label: createLabel('a fairly long label that must wrap'),
    });
    const d = generateElementDrawable(el);
    const label = d.labelLayers[0] as TextLayer;
    expect(label.runs.length).toBeGreaterThan(1);
    expect(label.color).toBe('#1971c2');
    for (const r of label.runs) expect(r.width).toBeLessThanOrEqual(120 - 16 + 1e-6);
    const colored = generateElementDrawable({ ...el, label: { ...el.label!, color: '#e03131' } });
    expect((colored.labelLayers[0] as TextLayer).color).toBe('#e03131');
  });

  it('text elements align lines and draw a background box', () => {
    const el = make('text', {
      text: 'one\ntwo',
      width: 200,
      height: 60,
      textAlign: 'right',
      autoResize: false,
      backgroundColor: '#ffec99',
    });
    const d = generateElementDrawable(el);
    expect(shapes(d.layers)[0]!.fill).toBe('#ffec99');
    const t = texts(d.layers)[0]!;
    expect(t.runs.map((r) => r.text)).toEqual(['one', 'two']);
    expect(t.runs[0]!.x).toBe(200);
    expect(t.runs[1]!.y).toBeGreaterThan(t.runs[0]!.y);
  });

  it('strokeStyle dashed/dotted scales the dash with stroke width and uses a single pass', () => {
    const solid = generateElementDrawable(
      make('rectangle', { width: 100, height: 60, strokeStyle: 'solid' }),
    );
    const dashed = generateElementDrawable(
      make('rectangle', { width: 100, height: 60, strokeStyle: 'dashed', strokeWidth: 2 }),
    );
    const dashedThick = generateElementDrawable(
      make('rectangle', { width: 100, height: 60, strokeStyle: 'dashed', strokeWidth: 4 }),
    );
    const dotted = generateElementDrawable(
      make('rectangle', { width: 100, height: 60, strokeStyle: 'dotted' }),
    );
    const layer = (d: typeof solid) => shapes(d.layers)[0]!;
    expect(layer(solid).stroke!.dash).toBeNull();
    expect(layer(dashed).stroke!.dash!.length).toBe(2);
    expect(layer(dashedThick).stroke!.dash![0]!).toBeGreaterThan(layer(dashed).stroke!.dash![0]!);
    expect(layer(dotted).stroke!.dash![0]!).toBeLessThan(1);
    const moves = (d: typeof solid) =>
      layer(d)
        .sets.find((s) => s.type === 'stroke')!
        .path.filter((c) => c.type === 'M').length;
    expect(moves(solid)).toBe(8); // 4 sides × 2 passes
    expect(moves(dashed)).toBe(4);
  });

  it('roughness 0 renders crisp rectangles with rounded corners', () => {
    const d = generateElementDrawable(
      make('rectangle', { width: 100, height: 50, roughness: 0, roundness: 'round' }),
    );
    const stroke = d.sets.find((s) => s.type === 'stroke')!;
    expect(stroke.path.filter((c) => c.type === 'C')).toHaveLength(4);
    expect(stroke.path.filter((c) => c.type === 'M')).toHaveLength(1);
  });

  it('orients arrowheads along the end tangent', () => {
    const tip = { x: 100, y: 0 };
    const g = arrowheadGeometry('triangle', tip, { x: 1, y: 0 }, 16);
    const tri = pts(g.filled[0]!);
    expect(tri[0]).toEqual(tip);
    for (const p of tri.slice(1)) expect(p.x).toBeLessThan(tip.x);
    const up = arrowheadGeometry('arrow', { x: 0, y: 0 }, { x: 0, y: -1 }, 16);
    for (const p of pts(up.strokes[0]!)) expect(p.y).toBeGreaterThanOrEqual(-1e-9);

    const arrow = make('arrow', {
      points: [
        [0, 0],
        [0, 100],
      ],
      width: 0,
      height: 100,
      roughness: 0,
      endArrowhead: 'triangle',
      startArrowhead: 'bar',
    });
    const d = generateElementDrawable(arrow);
    const heads = shapes(d.layers).filter((l) => l.fill === arrow.strokeColor);
    expect(heads).toHaveLength(1);
    const headPts = pts(heads[0]!.sets[0]!.path);
    expect(Math.max(...headPts.map((p) => p.y))).toBeCloseTo(100, 6);
    expect(Math.min(...headPts.map((p) => p.y))).toBeLessThan(100);
    // The shaft is trimmed so it does not poke through the tip.
    const shaft = shapes(d.layers)[0]!.sets.find((s) => s.type === 'stroke')!;
    expect(Math.max(...pts(shaft.path).map((p) => p.y))).toBeLessThan(100);
  });

  it('orients curved arrowheads along the curve tangent', () => {
    const arrow = make('arrow', {
      points: [
        [0, 0],
        [50, -50],
        [100, 0],
      ],
      width: 100,
      height: 50,
      roughness: 0,
      pathStyle: 'curved',
      endArrowhead: 'arrow',
    });
    const d = generateElementDrawable(arrow);
    const head = shapes(d.layers)[1]!;
    const [a, t, b] = pts(head.sets[0]!.path);
    expect(t).toEqual({ x: 100, y: 0 });
    // Arriving downward-right: wings lie up-left of the tip.
    expect((a!.x + b!.x) / 2).toBeLessThan(100);
    expect((a!.y + b!.y) / 2).toBeLessThan(0);
  });

  it('draws ER crow-foot notations with knockout circles', () => {
    for (const kind of [
      'er-one',
      'er-many',
      'er-one-only',
      'er-zero-one',
      'er-one-many',
      'er-zero-many',
    ] as const) {
      const g = arrowheadGeometry(kind, { x: 0, y: 0 }, { x: 1, y: 0 }, 20);
      expect(g.strokes.length, kind).toBeGreaterThan(0);
      for (const p of g.strokes.flatMap(pts)) expect(p.x, kind).toBeLessThanOrEqual(1e-9);
      expect(g.knockouts.length > 0, kind).toBe(kind.includes('zero'));
    }
    const many = arrowheadGeometry('er-many', { x: 0, y: 0 }, { x: 1, y: 0 }, 20);
    const prongEnds = many.strokes.map((s) => pts(s)[1]!);
    expect(new Set(prongEnds.map((p) => Math.round(p.y))).size).toBe(3);
    const conn = make('connector', {
      points: [
        [0, 0],
        [200, 0],
      ],
      width: 200,
      height: 0,
      endArrowhead: 'er-zero-many',
      routing: 'straight',
    });
    const d = generateElementDrawable(conn);
    expect(d.layers[0]!.kind).toBe('group');
  });

  it('places edge labels along the path with a knockout', () => {
    const arrow = make('arrow', {
      points: [
        [0, 0],
        [200, 0],
      ],
      width: 200,
      height: 0,
      label: createEdgeLabel('yes', { position: 0.25 }),
    });
    const d = generateElementDrawable(arrow);
    expect(d.layers[0]!.kind).toBe('group');
    const group = d.layers[0]!;
    if (group.kind === 'group') expect(group.clip!.rule).toBe('evenodd');
    const label = d.labelLayers[0] as TextLayer;
    expect(label.runs[0]!.x).toBeCloseTo(50, 6);
    expect(label.runs[0]!.y).toBeCloseTo(0, 6);
  });

  it('fills closed lines', () => {
    const line = make('line', {
      points: [
        [0, 0],
        [100, 0],
        [50, 80],
      ],
      closed: true,
      width: 100,
      height: 80,
      backgroundColor: '#b2f2bb',
      fillStyle: 'solid',
    });
    const d = generateElementDrawable(line);
    expect(d.sets.map((s) => s.type)).toEqual(['fill', 'stroke']);
  });

  it('frames draw background and border', () => {
    const d = generateElementDrawable(
      make('frame', { width: 300, height: 200, backgroundColor: '#fff9db' }),
    );
    const l = shapes(d.layers)[0]!;
    expect(l.fill).toBe('#fff9db');
    expect(l.stroke).not.toBeNull();
  });

  it('flips polygonal shapes geometrically', () => {
    const tri = make('triangle', { width: 100, height: 80, roughness: 0 });
    const flipped = generateElementDrawable({ ...tri, flipY: true });
    const normal = generateElementDrawable(tri);
    const apexY = (d: typeof normal) => pts(d.sets.find((s) => s.type === 'stroke')!.path)[0]!.y;
    expect(apexY(normal)).toBe(0);
    expect(apexY(flipped)).toBe(80);
  });

  it('is deterministic per seed and differs across seeds', () => {
    const el = make('ellipse', {
      width: 120,
      height: 80,
      backgroundColor: '#a5d8ff',
      fillStyle: 'hachure',
    });
    expect(generateElementDrawable(el)).toEqual(generateElementDrawable({ ...el }));
    expect(generateElementDrawable({ ...el, seed: el.seed + 1 }).sets).not.toEqual(
      generateElementDrawable(el).sets,
    );
  });
});

describe('DrawableCache', () => {
  it('caches by id + version', () => {
    const cache = new DrawableCache();
    const el = make('rectangle', { width: 10, height: 10 });
    const a = cache.get(el);
    expect(cache.get({ ...el })).toBe(a);
    expect(cache.size).toBe(1);
    const b = cache.get({ ...el, version: el.version + 1, width: 20 });
    expect(b).not.toBe(a);
    cache.delete(el.id);
    expect(cache.size).toBe(0);
    cache.get(el);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('measureRenderPadding', () => {
  it('accounts for stroke, roughness and arrowheads', () => {
    const crisp = measureRenderPadding(
      make('rectangle', { width: 100, height: 100, strokeWidth: 2, roughness: 0 }),
    );
    const rough = measureRenderPadding(
      make('rectangle', { width: 100, height: 100, strokeWidth: 2, roughness: 2 }),
    );
    expect(crisp).toBeGreaterThanOrEqual(1);
    expect(rough).toBeGreaterThan(crisp);
    const arrow = measureRenderPadding(
      make('arrow', {
        points: [
          [0, 0],
          [100, 0],
        ],
        width: 100,
        height: 0,
        strokeWidth: 4,
      }),
    );
    expect(arrow).toBeGreaterThan(12);
  });

  it('covers the drawable local bounds', () => {
    const els = [
      make('rectangle', { width: 100, height: 60, roughness: 2, strokeWidth: 4 }),
      make('arrow', {
        points: [
          [0, 0],
          [100, 40],
        ],
        width: 100,
        height: 40,
        strokeWidth: 2,
        startArrowhead: 'diamond',
        endArrowhead: 'er-zero-many',
      }),
      make('ellipse', { width: 30, height: 30, roughness: 2 }),
    ];
    for (const el of els) {
      const d = generateElementDrawable(el);
      const pad = measureRenderPadding(el);
      expect(d.localBounds.minX, el.type).toBeGreaterThanOrEqual(-pad - 1e-6);
      expect(d.localBounds.minY, el.type).toBeGreaterThanOrEqual(-pad - 1e-6);
      expect(d.localBounds.maxX, el.type).toBeLessThanOrEqual(el.width + pad + 1e-6);
      expect(d.localBounds.maxY, el.type).toBeLessThanOrEqual(el.height + pad + 1e-6);
    }
  });
});

describe('bindings do not affect drawing', () => {
  it('draws bound arrows from their points', () => {
    const arrow = make('arrow', {
      points: [
        [0, 0],
        [80, 0],
      ],
      width: 80,
      height: 0,
      startBinding: createBinding('x'),
    });
    expect(generateElementDrawable(arrow).layers.length).toBeGreaterThan(0);
  });
});
