import {
  FONT_FAMILIES,
  getFontString,
  type FrameElement,
  type SceneElement,
} from '@inkflow/elements';
import { rotatedRectCorners } from '@inkflow/geometry';
import type { DrawableCache } from '../drawable/generate';
import { truncateText } from '../drawable/text';
import type {
  DrawLayer,
  ElementDrawable,
  ImageLayer,
  ShapeLayer,
  TextLayer,
} from '../drawable/types';
import type { ImageSource, RenderTheme } from '../types';
import type { BitmapCache } from './bitmap-cache';
import {
  IMAGE_COUNTER_FILTER,
  createScratchCanvas,
  getCounterFilteredImage,
  getScratchContext,
  supportsCanvasFilter,
  type ScratchCanvas,
} from './dark';
import { clipPath, fillPath, strokePath } from './path';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface DrawEnv {
  images: ImageSource;
  cache: DrawableCache;
  /** Current zoom (screen pixels per world unit). */
  zoom: number;
  theme: RenderTheme;
  editingLabelId?: string | null;
  lowFidelity?: boolean;
  getElement: (id: string) => SceneElement | undefined;
  /** Device pixel ratio (bitmap cache resolution). */
  pixelRatio?: number;
  /** Rasterized-drawable cache for expensive elements (static renderer only). */
  bitmaps?: BitmapCache | null;
  /** Factory for bitmap canvases (defaults to OffscreenCanvas / document canvas). */
  createCanvas?: (width: number, height: number) => ScratchCanvas | null;
}

export interface LayerDrawOptions {
  images: ImageSource;
  theme: RenderTheme;
  lowFidelity?: boolean;
}

/** Applies translate + rotation (around the box center) so that drawing uses element-local coordinates. */
export function applyElementTransform(
  ctx: Ctx,
  el: Pick<SceneElement, 'x' | 'y' | 'width' | 'height' | 'angle'>,
): void {
  if (el.angle) {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(el.angle);
    ctx.translate(-el.width / 2, -el.height / 2);
  } else {
    ctx.translate(el.x, el.y);
  }
}

function drawShapeLayer(ctx: Ctx, layer: ShapeLayer, lowFidelity: boolean): void {
  const withAlpha = layer.alpha !== undefined && layer.alpha < 1;
  if (withAlpha) {
    ctx.save();
    ctx.globalAlpha *= layer.alpha!;
  }
  for (const set of layer.sets) {
    switch (set.type) {
      case 'fill':
        if (!layer.fill) break;
        ctx.fillStyle = layer.fill;
        fillPath(ctx, set.path, layer.fillRule);
        break;
      case 'fillSketch':
        if (!layer.sketch || lowFidelity) break;
        ctx.strokeStyle = layer.sketch.color;
        ctx.lineWidth = layer.sketch.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);
        strokePath(ctx, set.path);
        break;
      case 'stroke': {
        const s = layer.stroke;
        if (!s) break;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.lineCap = s.cap;
        ctx.lineJoin = s.join;
        ctx.setLineDash(s.dash ?? []);
        strokePath(ctx, set.path);
        break;
      }
    }
  }
  if (hasDash(layer)) ctx.setLineDash([]);
  if (withAlpha) ctx.restore();
}

function hasDash(layer: ShapeLayer): boolean {
  return !!layer.stroke?.dash;
}

function drawTextLayer(ctx: Ctx, layer: TextLayer): void {
  if (layer.runs.length === 0) return;
  const withAlpha = layer.alpha !== undefined && layer.alpha < 1;
  if (withAlpha) {
    ctx.save();
    ctx.globalAlpha *= layer.alpha!;
  }
  ctx.font = layer.font;
  ctx.fillStyle = layer.color;
  ctx.textAlign = layer.align;
  ctx.textBaseline = 'middle';
  const spaced = layer.letterSpacing !== 0 && 'letterSpacing' in ctx;
  if (spaced) (ctx as { letterSpacing: string }).letterSpacing = `${layer.letterSpacing}px`;
  for (const run of layer.runs) {
    if (run.text.length > 0) ctx.fillText(run.text, run.x, run.y);
  }
  if (spaced) (ctx as { letterSpacing: string }).letterSpacing = '0px';
  if (layer.decoration !== 'none') {
    ctx.strokeStyle = layer.color;
    ctx.lineWidth = Math.max(1, layer.fontSize / 16);
    ctx.lineCap = 'butt';
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const run of layer.runs) {
      if (run.width <= 0) continue;
      const left =
        layer.align === 'center'
          ? run.x - run.width / 2
          : layer.align === 'right'
            ? run.x - run.width
            : run.x;
      const y =
        run.y + (layer.decoration === 'underline' ? layer.fontSize * 0.45 : layer.fontSize * 0.05);
      ctx.moveTo(left, y);
      ctx.lineTo(left + run.width, y);
    }
    ctx.stroke();
  }
  if (withAlpha) ctx.restore();
}

/** Intrinsic pixel size of any canvas image source. */
export function imageSourceSize(img: CanvasImageSource): { width: number; height: number } {
  const o = img as unknown as Record<string, unknown>;
  const num = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : 0);
  if (num('naturalWidth') > 0) return { width: num('naturalWidth'), height: num('naturalHeight') };
  if (num('videoWidth') > 0) return { width: num('videoWidth'), height: num('videoHeight') };
  if (num('displayWidth') > 0) return { width: num('displayWidth'), height: num('displayHeight') };
  const w = o['width'];
  const h = o['height'];
  if (typeof w === 'number' && typeof h === 'number') return { width: w, height: h };
  const anim = (v: unknown) =>
    v && typeof v === 'object' && 'baseVal' in v
      ? Number((v as { baseVal: { value: number } }).baseVal.value)
      : 0;
  return { width: anim(w), height: anim(h) };
}

function drawImagePlaceholder(
  ctx: Ctx,
  layer: ImageLayer,
  status: 'loading' | 'error' | 'missing' | 'loaded',
): void {
  const { x, y, width: w, height: h } = layer;
  ctx.fillStyle = status === 'error' ? '#fff5f5' : '#f1f3f5';
  ctx.fillRect(x, y, w, h);
  const lw = Math.max(1, Math.min(w, h) / 120);
  ctx.strokeStyle = status === 'error' ? '#ffa8a8' : '#ced4da';
  ctx.lineWidth = lw;
  ctx.setLineDash([lw * 4, lw * 3]);
  ctx.strokeRect(x + lw / 2, y + lw / 2, Math.max(0, w - lw), Math.max(0, h - lw));
  ctx.setLineDash([]);
  // Picture icon: frame, sun and mountains (crossed out on error).
  const s = Math.min(48, Math.min(w, h) * 0.35);
  if (s < 6) return;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const color = status === 'error' ? '#fa5252' : '#adb5bd';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, s / 14);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const l = cx - s / 2;
  const t = cy - s / 2;
  ctx.beginPath();
  ctx.rect(l, t, s, s * 0.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(l + s * 0.3, t + s * 0.27, s * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(l + s * 0.08, t + s * 0.72);
  ctx.lineTo(l + s * 0.38, t + s * 0.42);
  ctx.lineTo(l + s * 0.58, t + s * 0.6);
  ctx.lineTo(l + s * 0.7, t + s * 0.5);
  ctx.lineTo(l + s * 0.92, t + s * 0.72);
  ctx.stroke();
  if (status === 'error') {
    ctx.beginPath();
    ctx.moveTo(l - s * 0.1, t - s * 0.1);
    ctx.lineTo(l + s * 1.1, t + s * 0.9);
    ctx.stroke();
  }
}

function drawImageLayer(ctx: Ctx, layer: ImageLayer, opts: LayerDrawOptions): void {
  const fileId = layer.fileId;
  const img = fileId ? opts.images.get(fileId) : null;
  if (!img || !fileId) {
    const status = fileId ? opts.images.status(fileId) : 'missing';
    const ensure = (opts.images as { ensure?: (id: string) => void }).ensure;
    if (fileId && status === 'missing' && typeof ensure === 'function')
      ensure.call(opts.images, fileId);
    drawImagePlaceholder(ctx, layer, status);
    return;
  }
  const size = imageSourceSize(img);
  const natW = layer.naturalWidth > 0 ? layer.naturalWidth : size.width;
  const natH = layer.naturalHeight > 0 ? layer.naturalHeight : size.height;
  const kx = natW > 0 ? size.width / natW : 1;
  const ky = natH > 0 ? size.height / natH : 1;
  const crop = layer.crop ?? { x: 0, y: 0, width: natW, height: natH };
  ctx.save();
  if (layer.flipX || layer.flipY) {
    ctx.translate(
      layer.flipX ? layer.x * 2 + layer.width : 0,
      layer.flipY ? layer.y * 2 + layer.height : 0,
    );
    ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
  }
  let source: CanvasImageSource = img;
  if (opts.theme === 'dark') {
    if (supportsCanvasFilter(ctx)) ctx.filter = IMAGE_COUNTER_FILTER;
    else source = getCounterFilteredImage(img, size.width, size.height) ?? img;
  }
  const sx = crop.x * kx;
  const sy = crop.y * ky;
  const sw = Math.max(1e-3, crop.width * kx);
  const sh = Math.max(1e-3, crop.height * ky);
  ctx.drawImage(source, sx, sy, sw, sh, layer.x, layer.y, layer.width, layer.height);
  ctx.restore();
}

/** Draws display-list layers in the current (element-local) transform. */
export function drawLayers(ctx: Ctx, layers: readonly DrawLayer[], opts: LayerDrawOptions): void {
  for (const layer of layers) {
    switch (layer.kind) {
      case 'shape':
        drawShapeLayer(ctx, layer, !!opts.lowFidelity);
        break;
      case 'text':
        drawTextLayer(ctx, layer);
        break;
      case 'image':
        drawImageLayer(ctx, layer, opts);
        break;
      case 'group': {
        ctx.save();
        if (layer.alpha !== undefined) ctx.globalAlpha *= layer.alpha;
        if (layer.clip) clipPath(ctx, layer.clip.path, layer.clip.rule);
        drawLayers(ctx, layer.children, opts);
        ctx.restore();
        break;
      }
    }
  }
}

const BITMAP_MIN_COMPLEXITY = 400;
const BITMAP_MAX_SIDE = 4096;
const BITMAP_MAX_PIXELS = 8 * 1024 * 1024;

/** Elements worth rasterizing: heavy freedraw, hachure fills, long text blocks. */
export function isExpensiveDrawable(d: ElementDrawable): boolean {
  if (d.hasImage) return false;
  return d.complexity >= BITMAP_MIN_COMPLEXITY || (d.hasSketchFill && d.complexity >= 120);
}

function zoomBucket(scale: number): number {
  return Math.ceil(Math.log2(Math.max(1e-3, scale)) * 2) / 2;
}

function drawFromBitmap(
  ctx: Ctx,
  el: SceneElement,
  d: ElementDrawable,
  env: DrawEnv,
  withLabel: boolean,
): boolean {
  const cache = env.bitmaps;
  if (!cache) return false;
  const target = env.zoom * (env.pixelRatio ?? 1);
  const bucket = zoomBucket(target);
  const prefix = `${el.id}|${el.version}|${el.versionNonce}|${withLabel ? 1 : 0}|`;
  const key = prefix + bucket;
  let entry = cache.get(key);
  if (!entry && env.lowFidelity) entry = cache.findAny(prefix, el.id);
  if (!entry) {
    const scale = 2 ** bucket;
    const lb = d.localBounds;
    const w = Math.ceil((lb.maxX - lb.minX) * scale) + 2;
    const h = Math.ceil((lb.maxY - lb.minY) * scale) + 2;
    if (
      !(w > 0 && h > 0) ||
      w > BITMAP_MAX_SIDE ||
      h > BITMAP_MAX_SIDE ||
      w * h > BITMAP_MAX_PIXELS
    )
      return false;
    const canvas = (env.createCanvas ?? createScratchCanvas)(w, h);
    if (!canvas) return false;
    const bctx = getScratchContext(canvas);
    if (!bctx) return false;
    bctx.setTransform(
      scale,
      0,
      0,
      scale,
      (-lb.minX + 1 / scale) * scale,
      (-lb.minY + 1 / scale) * scale,
    );
    const opts: LayerDrawOptions = { images: env.images, theme: env.theme };
    drawLayers(bctx, d.layers, opts);
    if (withLabel) drawLayers(bctx, d.labelLayers, opts);
    entry = {
      canvas,
      scale,
      originX: lb.minX - 1 / scale,
      originY: lb.minY - 1 / scale,
      bytes: w * h * 4,
      elementId: el.id,
    };
    cache.set(key, entry);
  }
  ctx.drawImage(
    entry.canvas,
    entry.originX,
    entry.originY,
    entry.canvas.width / entry.scale,
    entry.canvas.height / entry.scale,
  );
  return true;
}

/**
 * Draws one element. `ctx` must be in world space; rotation, opacity, element types and embedded
 * labels are handled here. Hidden and deleted elements are never drawn.
 */
export function drawElement(ctx: CanvasRenderingContext2D, el: SceneElement, env: DrawEnv): void {
  drawElementInto(ctx, el, env);
}

export function drawElementInto(ctx: Ctx, el: SceneElement, env: DrawEnv): void {
  if (el.isDeleted || el.hidden) return;
  const opacity = Math.max(0, Math.min(100, el.opacity)) / 100;
  if (opacity <= 0) return;
  const d = env.cache.get(el);
  const withLabel = env.editingLabelId !== el.id;
  ctx.save();
  if (opacity < 1) ctx.globalAlpha *= opacity;
  applyElementTransform(ctx, el);
  const usedBitmap =
    env.bitmaps && isExpensiveDrawable(d) ? drawFromBitmap(ctx, el, d, env, withLabel) : false;
  if (!usedBitmap) {
    const opts: LayerDrawOptions = {
      images: env.images,
      theme: env.theme,
      lowFidelity: env.lowFidelity,
    };
    drawLayers(ctx, d.layers, opts);
    if (withLabel) drawLayers(ctx, d.labelLayers, opts);
  }
  ctx.restore();
}

export const FRAME_NAME_FONT_SIZE = 14;
export const FRAME_NAME_GAP = 6;
export const FRAME_NAME_COLOR = '#868e96';

/** Frame name above its top-left corner at a constant screen size (`zoom` = pixels per unit). */
export function drawFrameName(ctx: Ctx, frame: FrameElement, zoom: number): void {
  if (frame.isDeleted || frame.hidden || !frame.name) return;
  const z = Math.max(1e-3, zoom);
  const fontSize = FRAME_NAME_FONT_SIZE / z;
  const font = getFontString({
    fontFamily: 'sans',
    fontSize,
    fontWeight: 'normal',
    fontStyle: 'normal',
  });
  const text = truncateText(frame.name, font, frame.width);
  if (!text) return;
  ctx.save();
  applyElementTransform(ctx, frame);
  ctx.font = font;
  ctx.fillStyle = FRAME_NAME_COLOR;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, 0, -FRAME_NAME_GAP / z);
  ctx.restore();
}

export const FRAME_NAME_FONT_CSS = FONT_FAMILIES.sans.css;

/** Clips the context (world space) to a frame's rotated box. Caller wraps in save/restore. */
export function clipToFrame(ctx: Ctx, frame: FrameElement): void {
  const corners = rotatedRectCorners(
    { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
    frame.angle,
  );
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i]!.x, corners[i]!.y);
  ctx.closePath();
  ctx.clip();
}
