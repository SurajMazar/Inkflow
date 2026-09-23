import { describe, expect, it } from 'vitest';
import { createLabel, type SceneElement } from '@inkflow/elements';
import {
  DrawableCache,
  ImageCache,
  InteractiveRenderer,
  StaticRenderer,
  drawElement,
  drawGrid,
  effectiveGridSize,
  renderSceneToCanvas,
  type DrawEnv,
  type ImageSource,
  type InteractiveRenderState,
  type StaticRenderOptions,
} from '../src';
import { MockCanvas, asCtx, mockCanvas, type RecordingContext } from './mock-canvas';
import { lookup, make, noImages } from './fixtures';

const viewport = { x: 0, y: 0, zoom: 1, width: 800, height: 600 };

function options(
  elements: SceneElement[],
  extra: Partial<StaticRenderOptions> = {},
): StaticRenderOptions {
  return {
    viewport,
    pixelRatio: 1,
    background: '#ffffff',
    grid: { visible: false, type: 'dot', size: 20 },
    theme: 'light',
    images: noImages,
    showFrameNames: true,
    getElement: lookup(elements),
    ...extra,
  };
}

function env(_ctx: RecordingContext, extra: Partial<DrawEnv> = {}): DrawEnv {
  return {
    images: noImages,
    cache: new DrawableCache(),
    zoom: 1,
    theme: 'light',
    getElement: () => undefined,
    ...extra,
  };
}

/** Indices of text draws (by content) in call order. */
const textOrder = (ctx: RecordingContext) => ctx.named('fillText').map((c) => c.args[0] as string);

describe('drawElement', () => {
  it('applies translation, rotation and opacity', () => {
    const { ctx } = mockCanvas();
    const el = make('rectangle', {
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      angle: Math.PI / 2,
      opacity: 50,
    });
    drawElement(asCtx(ctx), el, env(ctx));
    expect(ctx.named('translate')[0]!.args).toEqual([60, 45]);
    expect(ctx.named('rotate')[0]!.args).toEqual([Math.PI / 2]);
    const stroke = ctx.named('stroke')[0]!;
    expect(stroke.style!.globalAlpha).toBeCloseTo(0.5);
    expect(ctx.depth).toBe(0);
  });

  it('never draws hidden or deleted elements', () => {
    const { ctx } = mockCanvas();
    drawElement(asCtx(ctx), make('rectangle', { width: 10, height: 10, hidden: true }), env(ctx));
    drawElement(
      asCtx(ctx),
      make('rectangle', { width: 10, height: 10, isDeleted: true }),
      env(ctx),
    );
    expect(ctx.calls).toHaveLength(0);
  });

  it('skips the label of the element whose label is being edited', () => {
    const el = make('rectangle', { width: 100, height: 60, label: createLabel('Label') });
    const a = mockCanvas().ctx;
    drawElement(asCtx(a), el, env(a));
    expect(textOrder(a)).toEqual(['Label']);
    const b = mockCanvas().ctx;
    drawElement(asCtx(b), el, env(b, { editingLabelId: el.id }));
    expect(textOrder(b)).toEqual([]);
    expect(b.count('stroke')).toBeGreaterThan(0);
  });

  it('draws dashed strokes with a dash pattern', () => {
    const { ctx } = mockCanvas();
    drawElement(
      asCtx(ctx),
      make('rectangle', { width: 100, height: 60, strokeStyle: 'dashed', strokeWidth: 2 }),
      env(ctx),
    );
    const stroke = ctx.named('stroke')[0]!;
    expect(stroke.style!.dash).toEqual([12, 10]);
  });

  it('produces identical canvas calls across runs and different ones for another seed', () => {
    const el = make('ellipse', {
      width: 120,
      height: 80,
      backgroundColor: '#a5d8ff',
      fillStyle: 'cross-hatch',
    });
    const run = (e: SceneElement) => {
      const { ctx } = mockCanvas();
      drawElement(asCtx(ctx), e, env(ctx));
      return JSON.stringify(ctx.calls);
    };
    expect(run(el)).toBe(run({ ...el }));
    expect(run({ ...el, seed: el.seed + 7 })).not.toBe(run(el));
  });

  it('draws images with crop and flips, counter-filtered in dark theme', () => {
    const bitmap = { width: 400, height: 200 } as unknown as CanvasImageSource;
    const images: ImageSource = { get: () => bitmap, status: () => 'loaded' };
    const el = make('image', {
      fileId: 'f',
      width: 100,
      height: 50,
      naturalWidth: 800,
      naturalHeight: 400,
      crop: { x: 200, y: 100, width: 400, height: 200 },
      flipX: true,
    });
    const light = mockCanvas().ctx;
    drawElement(asCtx(light), el, env(light, { images }));
    const draw = light.named('drawImage')[0]!;
    // Bitmap is half the natural size → crop scaled by 0.5.
    expect(draw.args.slice(1)).toEqual([100, 50, 200, 100, 0, 0, 100, 50]);
    expect(draw.style!.filter).toBe('none');
    expect(light.named('scale')[0]!.args).toEqual([-1, 1]);
    const dark = mockCanvas().ctx;
    drawElement(asCtx(dark), el, env(dark, { images, theme: 'dark' }));
    expect(dark.named('drawImage')[0]!.style!.filter).toBe('invert(100%) hue-rotate(180deg)');
  });

  it('draws a placeholder while images load and requests them', () => {
    const requested: string[] = [];
    const cache = new ImageCache({ resolveUrl: () => null });
    const images: ImageSource & { ensure(id: string): void } = {
      get: () => null,
      status: () => 'missing',
      ensure: (id: string) => requested.push(id),
    };
    const { ctx } = mockCanvas();
    drawElement(
      asCtx(ctx),
      make('image', { fileId: 'abc', width: 100, height: 80 }),
      env(ctx, { images }),
    );
    expect(requested).toEqual(['abc']);
    expect(ctx.count('fillRect')).toBe(1);
    expect(ctx.count('drawImage')).toBe(0);
    cache.dispose();
  });
});

describe('StaticRenderer', () => {
  it('sizes the backing store for HiDPI and clears/draws background', () => {
    const { canvas, ctx, mock } = mockCanvas(10, 10);
    const r = new StaticRenderer(canvas);
    r.render([], options([], { pixelRatio: 2 }));
    expect(mock.width).toBe(1600);
    expect(mock.height).toBe(1200);
    expect(mock.style.width).toBe('800px');
    expect(ctx.count('clearRect')).toBe(1);
    expect(ctx.named('fillRect')[0]!.style!.fillStyle).toBe('#ffffff');
    ctx.reset();
    r.render([], options([], { background: null }));
    expect(ctx.count('fillRect')).toBe(0);
  });

  it('culls elements outside the viewport', () => {
    const inside = Array.from({ length: 10 }, (_, i) =>
      make('rectangle', { x: i * 60, y: 100, width: 50, height: 50 }),
    );
    const outside = Array.from({ length: 25 }, (_, i) =>
      make('rectangle', { x: 2000 + i * 60, y: 100, width: 50, height: 50 }),
    );
    const edge = make('rectangle', { x: -48, y: -48, width: 50, height: 50 });
    const elements = [...inside, ...outside, edge];
    const { canvas } = mockCanvas();
    const stats = new StaticRenderer(canvas).render(elements, options(elements));
    expect(stats.drawn).toBe(11);
    expect(stats.culled).toBe(25);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
    const panned = new StaticRenderer(mockCanvas().canvas).render(
      elements,
      options(elements, { viewport: { ...viewport, x: 2000 } }),
    );
    expect(panned.drawn).toBe(14);
  });

  it('skips hidden, deleted and skipIds elements', () => {
    const a = make('text', { text: 'A', x: 10, y: 10, width: 20, height: 25 });
    const b = make('text', { text: 'B', x: 50, y: 10, width: 20, height: 25, hidden: true });
    const c = make('text', { text: 'C', x: 90, y: 10, width: 20, height: 25, isDeleted: true });
    const d = make('text', { text: 'D', x: 130, y: 10, width: 20, height: 25 });
    const elements = [a, b, c, d];
    const { canvas, ctx } = mockCanvas();
    const stats = new StaticRenderer(canvas).render(
      elements,
      options(elements, { skipIds: new Set([d.id]) }),
    );
    expect(textOrder(ctx)).toEqual(['A']);
    expect(stats.drawn).toBe(1);
  });

  it('draws frames first, clips children and draws frame names last', () => {
    const frame = make('frame', {
      name: 'Frame One',
      x: 100,
      y: 100,
      width: 300,
      height: 200,
      clip: true,
      backgroundColor: '#f8f9fa',
    });
    const before = make('text', {
      text: 'child',
      x: 150,
      y: 150,
      width: 40,
      height: 25,
      frameId: frame.id,
    });
    const free = make('text', { text: 'free', x: 500, y: 150, width: 40, height: 25 });
    const elements = [before, free, frame];
    const { canvas, ctx } = mockCanvas();
    new StaticRenderer(canvas).render(elements, options(elements));
    const names = ctx.calls.filter(
      (c) => c.name === 'fillText' || c.name === 'clip' || c.name === 'fill',
    );
    const firstFill = names.findIndex((c) => c.name === 'fill');
    const clipIdx = names.findIndex((c) => c.name === 'clip');
    const childIdx = names.findIndex((c) => c.name === 'fillText' && c.args[0] === 'child');
    const freeIdx = names.findIndex((c) => c.name === 'fillText' && c.args[0] === 'free');
    const titleIdx = names.findIndex((c) => c.name === 'fillText' && c.args[0] === 'Frame One');
    expect(firstFill).toBeGreaterThanOrEqual(0);
    expect(firstFill).toBeLessThan(childIdx);
    expect(clipIdx).toBeLessThan(childIdx);
    expect(childIdx).toBeLessThan(freeIdx);
    expect(titleIdx).toBe(names.length - 1);
    // The clip polygon is the frame rect in device space.
    const clip = names[clipIdx]!;
    expect(clip.points).toEqual([
      [100, 100],
      [400, 100],
      [400, 300],
      [100, 300],
    ]);
    // Frame name has constant screen size: 14px at zoom 1, 7 world units at zoom 2.
    expect(ctx.named('fillText').find((c) => c.args[0] === 'Frame One')!.style!.font).toMatch(
      /^14px/,
    );
    ctx.reset();
    new StaticRenderer(canvas).render(
      elements,
      options(elements, { viewport: { ...viewport, zoom: 2 } }),
    );
    expect(ctx.named('fillText').find((c) => c.args[0] === 'Frame One')!.style!.font).toMatch(
      /^7px/,
    );
  });

  it('does not clip children of frames with clip disabled and hides names when requested', () => {
    const frame = make('frame', { name: 'F', x: 0, y: 0, width: 100, height: 100, clip: false });
    const child = make('rectangle', { x: 10, y: 10, width: 20, height: 20, frameId: frame.id });
    const elements = [frame, child];
    const { canvas, ctx } = mockCanvas();
    new StaticRenderer(canvas).render(elements, options(elements, { showFrameNames: false }));
    expect(ctx.count('clip')).toBe(0);
    expect(textOrder(ctx)).toEqual([]);
  });

  it('draws the grid under elements in the light palette', () => {
    const { canvas, ctx } = mockCanvas();
    const el = make('rectangle', { x: 10, y: 10, width: 20, height: 20 });
    new StaticRenderer(canvas).render(
      [el],
      options([el], { grid: { visible: true, type: 'square', size: 20 }, theme: 'dark' }),
    );
    const strokes = ctx.named('stroke');
    expect(strokes[0]!.style!.strokeStyle).toBe('rgba(0, 0, 0, 0.06)');
    expect(strokes.length).toBeGreaterThan(2);
  });

  it('caches expensive drawables as bitmaps keyed by zoom bucket with an LRU budget', () => {
    const bitmaps: MockCanvas[] = [];
    const createCanvas = (w: number, h: number) => {
      const c = new MockCanvas(w, h);
      bitmaps.push(c);
      return c as unknown as HTMLCanvasElement;
    };
    const heavy = make('rectangle', {
      x: 50,
      y: 50,
      width: 300,
      height: 200,
      backgroundColor: '#ffc9c9',
      fillStyle: 'cross-hatch',
    });
    const light = make('rectangle', { x: 400, y: 50, width: 50, height: 50 });
    const elements = [heavy, light];
    const { canvas, ctx } = mockCanvas();
    const r = new StaticRenderer(canvas, { createCanvas });
    r.render(elements, options(elements));
    expect(bitmaps).toHaveLength(1);
    expect(ctx.count('drawImage')).toBe(1);
    ctx.reset();
    r.render(elements, options(elements, { viewport: { ...viewport, x: 5 } }));
    expect(bitmaps).toHaveLength(1); // reused while panning
    expect(ctx.count('drawImage')).toBe(1);
    r.render(elements, options(elements, { viewport: { ...viewport, zoom: 3 } }));
    expect(bitmaps).toHaveLength(2); // new zoom bucket
    r.render(
      elements,
      options(elements, { viewport: { ...viewport, zoom: 1.9 }, lowFidelity: true }),
    );
    expect(bitmaps).toHaveLength(2); // low fidelity reuses any bucket
    r.invalidate([heavy.id]);
    r.render(elements, options(elements));
    expect(bitmaps).toHaveLength(3);
    expect(r.bitmapStats.entries).toBe(1);
    // Tiny budget → nothing retained beyond the budget.
    const tiny = new StaticRenderer(mockCanvas().canvas, { createCanvas, bitmapBudgetBytes: 1000 });
    tiny.render(elements, options(elements));
    expect(tiny.bitmapStats.bytes).toBeLessThanOrEqual(1000);
  });

  it('skips hachure of uncached elements in low fidelity mode', () => {
    const el = make('rectangle', {
      x: 10,
      y: 10,
      width: 200,
      height: 100,
      backgroundColor: '#a5d8ff',
      fillStyle: 'hachure',
    });
    const sketchStrokes = (ctx: RecordingContext) =>
      ctx.named('stroke').filter((c) => c.style!.strokeStyle === '#a5d8ff').length;
    const full = mockCanvas();
    new StaticRenderer(full.canvas, { bitmapBudgetBytes: 0 }).render([el], options([el]));
    expect(sketchStrokes(full.ctx)).toBe(1);
    const low = mockCanvas();
    new StaticRenderer(low.canvas, { bitmapBudgetBytes: 0 }).render(
      [el],
      options([el], { lowFidelity: true }),
    );
    expect(sketchStrokes(low.ctx)).toBe(0);
    expect(low.ctx.named('stroke').length).toBe(1); // outline still drawn
  });

  it('draws images counter-filtered in dark theme', () => {
    const bitmap = { width: 10, height: 10 } as unknown as CanvasImageSource;
    const el = make('image', { fileId: 'x', x: 10, y: 10, width: 50, height: 50 });
    const { canvas, ctx } = mockCanvas();
    new StaticRenderer(canvas).render(
      [el],
      options([el], { theme: 'dark', images: { get: () => bitmap, status: () => 'loaded' } }),
    );
    expect(ctx.named('drawImage')[0]!.style!.filter).toBe('invert(100%) hue-rotate(180deg)');
  });
});

describe('drawGrid', () => {
  it('coarsens or hides dense grids', () => {
    expect(effectiveGridSize(20, 1)).toBe(20);
    expect(effectiveGridSize(20, 0.2)).toBe(100);
    expect(effectiveGridSize(20, 0.01)).toBe(2500);
    expect(effectiveGridSize(20, 0.001)).toBeNull();
  });

  it('draws dots, squares and isometric lines aligned to the world', () => {
    for (const type of ['dot', 'square', 'isometric'] as const) {
      const { ctx } = mockCanvas();
      drawGrid(
        asCtx(ctx),
        { x: 5, y: 5, zoom: 1, width: 200, height: 100 },
        { visible: true, type, size: 20 },
        'light',
      );
      expect(ctx.count(type === 'dot' ? 'fill' : 'stroke'), type).toBeGreaterThan(0);
      if (type === 'dot') expect(ctx.named('rect')[0]!.args[0]).toBeCloseTo(15 - 1, 0);
    }
    const { ctx } = mockCanvas();
    drawGrid(asCtx(ctx), viewport, { visible: false, type: 'dot', size: 20 }, 'light');
    expect(ctx.calls).toHaveLength(0);
  });
});

describe('renderSceneToCanvas', () => {
  it('renders the bounds at scale with background and frame clip', () => {
    const frame = make('frame', { x: 0, y: 0, width: 100, height: 100 });
    const child = make('rectangle', { x: 10, y: 10, width: 20, height: 20, frameId: frame.id });
    const far = make('rectangle', { x: 1000, y: 1000, width: 20, height: 20 });
    const elements = [frame, child, far];
    const { ctx } = mockCanvas(200, 200);
    renderSceneToCanvas(asCtx(ctx), elements, {
      bounds: { x: -10, y: -10, width: 120, height: 120 },
      scale: 2,
      background: '#fafafa',
      theme: 'light',
      images: noImages,
      showFrameNames: false,
      getElement: lookup(elements),
    });
    expect(
      ctx
        .named('setTransform')
        .some((c) => JSON.stringify(c.args) === JSON.stringify([2, 0, 0, 2, 20, 20])),
    ).toBe(true);
    expect(ctx.named('fillRect')[0]!.args).toEqual([0, 0, 240, 240]);
    expect(ctx.count('clip')).toBe(1);
  });
});

describe('InteractiveRenderer', () => {
  const state = (extra: Partial<InteractiveRenderState> = {}): InteractiveRenderState => ({
    viewport: { x: 0, y: 0, zoom: 2, width: 400, height: 300 },
    pixelRatio: 2,
    theme: 'light',
    accentColor: '#6965db',
    selectionOutlines: [
      [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 50 },
        { x: 10, y: 50 },
      ],
    ],
    selectionBox: [
      { x: 8, y: 8 },
      { x: 52, y: 8 },
      { x: 52, y: 52 },
      { x: 8, y: 52 },
    ],
    groupOutlines: [
      [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: 60 },
      ],
    ],
    handles: [
      { id: 'nw', kind: 'resize', x: 8, y: 8, angle: 0.3 },
      { id: 'rot', kind: 'rotate', x: 30, y: 0, angle: 0 },
      { id: 'p', kind: 'point', x: 10, y: 10, angle: 0, active: true },
      { id: 'm', kind: 'midpoint', x: 20, y: 10, angle: 0 },
    ],
    marquee: { x: 5, y: 5, width: 40, height: 20 },
    lasso: [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 10 },
    ],
    hoverOutline: null,
    snapLines: [{ from: { x: 0, y: 30 }, to: { x: 100, y: 30 } }],
    snapPoints: [{ x: 30, y: 30 }],
    bindingHighlight: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    ports: [
      { point: { x: 5, y: 5 }, active: true },
      { point: { x: 15, y: 5 }, active: false },
    ],
    remoteCursors: [
      {
        clientId: 'c1',
        name: 'Ada',
        color: '#e03131',
        x: 20,
        y: 20,
        active: true,
        tool: 'selection',
      },
    ],
    remoteSelections: [
      {
        clientId: 'c1',
        name: 'Ada',
        color: '#e03131',
        outlines: [
          [
            { x: 70, y: 70 },
            { x: 90, y: 70 },
            { x: 90, y: 90 },
          ],
        ],
      },
    ],
    eraserTrail: [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 5 },
    ],
    eraserTargets: [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    ],
    frameHighlight: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    linearEditor: {
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
      ],
      selectedIndices: [1],
      midpoints: [{ x: 25, y: 25 }],
    },
    cropEditor: {
      imageRect: { x: 0, y: 0, width: 100, height: 80 },
      cropRect: { x: 10, y: 10, width: 50, height: 40 },
      angle: 0,
      center: { x: 50, y: 40 },
    },
    commentPins: [
      { id: 'p1', x: 40, y: 40, resolved: false, active: true, count: 3 },
      { id: 'p2', x: 60, y: 40, resolved: true, active: false, count: 1 },
    ],
    searchHighlights: [
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ],
    ],
    laserTrail: [
      { x: 0, y: 0 },
      { x: 3, y: 3 },
      { x: 6, y: 3 },
      { x: 9, y: 9 },
    ],
    ...extra,
  });

  it('draws constant-size chrome in screen space', () => {
    const { canvas, ctx, mock } = mockCanvas();
    const r = new InteractiveRenderer(canvas);
    r.render(state());
    expect(mock.width).toBe(800);
    // Selection outline: world (10,10) → screen (20,20) at zoom 2 → device (40,40) at ratio 2.
    const outline = ctx
      .named('stroke')
      .find(
        (c) =>
          c.style!.strokeStyle === '#6965db' && c.style!.lineWidth === 1 && c.points!.length === 4,
      );
    expect(outline!.points![0]).toEqual([40, 40]);
    // Resize handle is an 8px square rotated by its angle.
    const rects = ctx.named('rect').filter((c) => c.args[2] === 8);
    expect(rects).toHaveLength(1);
    expect(ctx.named('rotate').some((c) => c.args[0] === 0.3)).toBe(true);
    // Remote cursor name tag and comment count are drawn.
    expect(textOrder(ctx)).toEqual(expect.arrayContaining(['Ada', '3', '✓']));
    // Snap guide in accent red.
    expect(ctx.named('stroke').some((c) => c.style!.strokeStyle === '#fa5252')).toBe(true);
    // Crop editor dims outside the crop with an even-odd fill.
    expect(ctx.named('fill').some((c) => c.args[0] === 'evenodd')).toBe(true);
    expect(ctx.depth).toBe(0);
  });

  it('picks overlay colors from the theme', () => {
    const light = mockCanvas();
    new InteractiveRenderer(light.canvas).render(state());
    const dark = mockCanvas();
    new InteractiveRenderer(dark.canvas).render(state({ theme: 'dark' }));
    const handleFill = (ctx: RecordingContext) => ctx.named('fill').map((c) => c.style!.fillStyle);
    expect(handleFill(light.ctx)).toContain('#ffffff');
    expect(handleFill(dark.ctx)).toContain('#1e1e1e');
  });
});

describe('ImageCache', () => {
  it('reports statuses and serves registered images', () => {
    const loaded: string[] = [];
    const cache = new ImageCache({
      resolveUrl: (id) => (id === 'known' ? 'data:image/png;base64,AAAA' : null),
      onLoad: (id) => loaded.push(id),
    });
    expect(cache.status('x')).toBe('missing');
    cache.ensure('unknown');
    expect(cache.status('unknown')).toBe('missing');
    const img = { width: 1, height: 1 } as unknown as CanvasImageSource;
    cache.set('manual', img);
    expect(cache.get('manual')).toBe(img);
    expect(cache.status('manual')).toBe('loaded');
    cache.ensure('known'); // no DOM Image in Node → error status, never throws
    expect(['loading', 'error']).toContain(cache.status('known'));
    cache.dispose();
    expect(cache.get('manual')).toBeNull();
  });
});
