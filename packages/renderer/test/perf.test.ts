import { describe, expect, it } from 'vitest';
import { createLabel, type PressurePoint, type SceneElement } from '@inkflow/elements';
import { SeededRandom } from '@inkflow/geometry';
import { DrawableCache, StaticRenderer, type StaticRenderOptions } from '../src';
import { mockCanvas } from './mock-canvas';
import { lookup, make, noImages } from './fixtures';

function mixedScene(count: number): SceneElement[] {
  const rng = new SeededRandom(7);
  const out: SceneElement[] = [];
  const side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    const x = (i % side) * 180 + rng.range(0, 40);
    const y = Math.floor(i / side) * 140 + rng.range(0, 30);
    const w = rng.range(40, 140);
    const h = rng.range(30, 100);
    switch (i % 8) {
      case 0:
        out.push(make('rectangle', { x, y, width: w, height: h, backgroundColor: '#a5d8ff', fillStyle: 'hachure', label: createLabel('Box') }));
        break;
      case 1:
        out.push(make('ellipse', { x, y, width: w, height: h, backgroundColor: '#ffc9c9', fillStyle: 'solid' }));
        break;
      case 2:
        out.push(make('diamond', { x, y, width: w, height: h, roundness: 'round' }));
        break;
      case 3:
        out.push(make('arrow', { x, y, points: [[0, 0], [w, h * 0.5], [w * 1.2, h]], width: w * 1.2, height: h, pathStyle: 'curved' }));
        break;
      case 4:
        out.push(make('text', { x, y, text: 'Hello world\nsecond line', width: w, height: 50, autoResize: false }));
        break;
      case 5: {
        const pts: PressurePoint[] = Array.from({ length: 60 }, (_, k) => [k * 2, Math.sin(k / 5) * 15 + 15, 0.5]);
        out.push(make('freedraw', { x, y, points: pts, width: 120, height: 30 }));
        break;
      }
      case 6:
        out.push(make('star', { x, y, width: w, height: w, backgroundColor: '#ffec99', fillStyle: 'cross-hatch' }));
        break;
      default:
        out.push(make('connector', { x, y, points: [[0, 0], [w / 2, 0], [w / 2, h], [w, h]], width: w, height: h, routing: 'orthogonal', roundness: 'round' }));
    }
  }
  return out;
}

describe('performance', () => {
  it('generates, culls and re-renders 10,000 mixed elements quickly', () => {
    const elements = mixedScene(10_000);
    const cache = new DrawableCache();
    const t0 = performance.now();
    for (const el of elements) cache.get(el);
    const generation = performance.now() - t0;

    const { canvas, ctx } = mockCanvas();
    const renderer = new StaticRenderer(canvas, { bitmapBudgetBytes: 0 });
    const options: StaticRenderOptions = {
      viewport: { x: 2000, y: 2000, zoom: 1, width: 1920, height: 1080 },
      pixelRatio: 2,
      background: '#ffffff',
      grid: { visible: true, type: 'dot', size: 20 },
      theme: 'light',
      images: noImages,
      showFrameNames: true,
      getElement: lookup(elements),
    };
    const t1 = performance.now();
    const first = renderer.render(elements, options);
    const firstRender = performance.now() - t1;
    ctx.reset();
    const t2 = performance.now();
    const second = renderer.render(elements, { ...options, viewport: { ...options.viewport, x: 2010 } });
    const reRender = performance.now() - t2;
    ctx.reset();

    // Zoomed out overview: many more elements visible, still from cache for already generated ones.
    const t3 = performance.now();
    const overview = renderer.render(elements, { ...options, viewport: { x: 0, y: 0, zoom: 0.25, width: 1920, height: 1080 }, lowFidelity: true });
    const overviewMs = performance.now() - t3;

    // Everything visible (zoomed far out), drawn from cached drawables.
    ctx.reset();
    const all = { ...options, viewport: { x: -100, y: -100, zoom: 0.05, width: 1920, height: 1080 } };
    renderer.render(elements, all);
    ctx.reset();
    const t4 = performance.now();
    const full = renderer.render(elements, all);
    const fullMs = performance.now() - t4;

    console.info(
      `[perf] generate 10k: ${generation.toFixed(1)}ms | first render: ${firstRender.toFixed(1)}ms (drawn ${first.drawn}, culled ${first.culled}) | ` +
        `re-render: ${reRender.toFixed(1)}ms | overview lowFi: ${overviewMs.toFixed(1)}ms (drawn ${overview.drawn}) | all 10k visible from cache: ${fullMs.toFixed(1)}ms (drawn ${full.drawn})`,
    );
    expect(first.drawn + first.culled).toBe(10_000);
    expect(first.culled).toBeGreaterThan(8_000);
    expect(second.drawn).toBeGreaterThan(0);
    expect(generation).toBeLessThan(1500);
    expect(reRender).toBeLessThan(150);
    expect(full.drawn).toBe(10_000);
  });
});
