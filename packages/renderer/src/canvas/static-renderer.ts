import type { SceneElement } from '@inkflow/elements';
import type { Bounds } from '@inkflow/geometry';
import { DrawableCache } from '../drawable/generate';
import { getRenderBounds, planRender, viewportWorldBounds } from '../plan';
import type { RenderStats, StaticRenderOptions } from '../types';
import { BitmapCache } from './bitmap-cache';
import { createScratchCanvas, type ScratchCanvas } from './dark';
import type { DrawEnv } from './draw';
import { drawGrid } from './grid';
import { drawPlan, frameTitleHeight } from './scene';

export interface StaticRendererOptions {
  /** Memory budget of the bitmap cache in bytes (default 96 MB). 0 disables bitmap caching. */
  bitmapBudgetBytes?: number;
  /** Factory for bitmap-cache canvases (defaults to OffscreenCanvas / document canvas). */
  createCanvas?: (width: number, height: number) => ScratchCanvas | null;
}

interface BoundsEntry {
  version: number;
  nonce: number;
  bounds: Bounds;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Renders the scene (background, grid, elements) into the static canvas.
 * - HiDPI: the backing store is `viewport × pixelRatio`.
 * - Culling: render bounds (geometric bounds + render padding) cached per element version.
 * - Caching: drawables by id+version (with cached Path2D objects) and, for expensive elements
 *   (heavy freedraw, hachure fills, long text), rasterized bitmaps keyed by id+version+zoom bucket
 *   in an LRU with a memory budget. `lowFidelity` reuses bitmaps of other zoom buckets and skips
 *   hachure on uncached elements.
 * - Dark theme: always draws the light palette (the app inverts the canvas with a CSS filter) but
 *   counter-filters images.
 */
export class StaticRenderer {
  readonly cache = new DrawableCache();
  private readonly bitmaps: BitmapCache | null;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly bounds = new Map<string, BoundsEntry>();
  private readonly createCanvas: (width: number, height: number) => ScratchCanvas | null;
  private renders = 0;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: StaticRendererOptions = {},
  ) {
    this.ctx = canvas.getContext('2d');
    const budget = options.bitmapBudgetBytes ?? 96 * 1024 * 1024;
    this.bitmaps = budget > 0 ? new BitmapCache(budget) : null;
    this.createCanvas = options.createCanvas ?? createScratchCanvas;
  }

  /** Bitmap cache statistics (for diagnostics/tests). */
  get bitmapStats(): { entries: number; bytes: number } {
    return { entries: this.bitmaps?.size ?? 0, bytes: this.bitmaps?.usedBytes ?? 0 };
  }

  private boundsOf = (el: SceneElement): Bounds => {
    const hit = this.bounds.get(el.id);
    if (hit && hit.version === el.version && hit.nonce === el.versionNonce) return hit.bounds;
    const bounds = getRenderBounds(el);
    this.bounds.set(el.id, { version: el.version, nonce: el.versionNonce, bounds });
    return bounds;
  };

  render(elements: readonly SceneElement[], options: StaticRenderOptions): RenderStats {
    const start = now();
    const ctx = this.ctx;
    if (!ctx || this.disposed) return { drawn: 0, culled: 0, durationMs: 0 };
    const vp = options.viewport;
    const ratio = options.pixelRatio > 0 ? options.pixelRatio : 1;
    const pw = Math.max(1, Math.round(vp.width * ratio));
    const ph = Math.max(1, Math.round(vp.height * ratio));
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    const style = (this.canvas as { style?: CSSStyleDeclaration }).style;
    if (style) {
      const w = `${vp.width}px`;
      const h = `${vp.height}px`;
      if (style.width !== w) style.width = w;
      if (style.height !== h) style.height = h;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, pw, ph);
    if (options.background) {
      ctx.fillStyle = options.background;
      ctx.fillRect(0, 0, pw, ph);
    }
    if (options.grid.visible) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      // Light palette: the app turns the whole static canvas dark with a CSS filter.
      drawGrid(ctx, vp, options.grid, 'light');
    }
    const z = vp.zoom;
    ctx.setTransform(ratio * z, 0, 0, ratio * z, -vp.x * z * ratio, -vp.y * z * ratio);

    const plan = planRender(elements, {
      getElement: options.getElement,
      skipIds: options.skipIds,
      view: viewportWorldBounds(vp),
      frameTitleHeight: options.showFrameNames ? frameTitleHeight(z) : 0,
      boundsOf: this.boundsOf,
    });
    const env: DrawEnv = {
      images: options.images,
      cache: this.cache,
      zoom: z,
      theme: options.theme,
      editingLabelId: options.editingLabelId ?? null,
      lowFidelity: options.lowFidelity ?? false,
      getElement: options.getElement,
      pixelRatio: ratio,
      bitmaps: this.bitmaps,
      createCanvas: this.createCanvas,
    };
    const drawn = drawPlan(ctx, plan, env, options.showFrameNames);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (++this.renders % 120 === 0) this.prune(elements);
    return { drawn, culled: plan.culled, durationMs: now() - start };
  }

  /** Drops caches of elements that left the scene. */
  private prune(elements: readonly SceneElement[]): void {
    if (this.bounds.size <= elements.length * 1.25 + 64) return;
    const live = new Set(elements.map((e) => e.id));
    for (const id of [...this.bounds.keys()]) {
      if (!live.has(id)) {
        this.bounds.delete(id);
        this.cache.delete(id);
        this.bitmaps?.deleteElement(id);
      }
    }
  }

  /** Invalidates cached drawables/bitmaps for the given ids (all when omitted), e.g. after fonts load. */
  invalidate(ids?: Iterable<string>): void {
    if (!ids) {
      this.cache.clear();
      this.bitmaps?.clear();
      this.bounds.clear();
      return;
    }
    for (const id of ids) {
      this.cache.delete(id);
      this.bitmaps?.deleteElement(id);
      this.bounds.delete(id);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cache.clear();
    this.bitmaps?.clear();
    this.bounds.clear();
  }
}
