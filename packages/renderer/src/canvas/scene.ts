import type { SceneElement } from '@inkflow/elements';
import { rectToBounds } from '@inkflow/geometry';
import { DrawableCache } from '../drawable/generate';
import { planRender, type RenderPlan } from '../plan';
import type { SceneRenderOptions } from '../types';
import {
  DARK_MODE_FILTER,
  applyDarkModeToCanvas,
  createScratchCanvas,
  getScratchContext,
  supportsCanvasFilter,
} from './dark';
import {
  FRAME_NAME_FONT_SIZE,
  FRAME_NAME_GAP,
  clipToFrame,
  drawElementInto,
  drawFrameName,
  type DrawEnv,
} from './draw';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** World-space height reserved above frames for their names at a given zoom. */
export function frameTitleHeight(zoom: number): number {
  return (FRAME_NAME_FONT_SIZE * 1.4 + FRAME_NAME_GAP) / Math.max(1e-3, zoom);
}

/**
 * Draws a render plan into a world-space context: frames (background + border) first, then content
 * (children clipped to their frame, consecutive siblings sharing one clip), then frame names.
 * Returns the number of elements drawn.
 */
export function drawPlan(
  ctx: Ctx,
  plan: RenderPlan,
  env: DrawEnv,
  showFrameNames: boolean,
): number {
  for (const frame of plan.frames) drawElementInto(ctx, frame, env);
  const content = plan.content;
  let i = 0;
  while (i < content.length) {
    const el = content[i]!;
    const clip = plan.clipFrames.get(el.id);
    if (!clip) {
      drawElementInto(ctx, el, env);
      i++;
      continue;
    }
    ctx.save();
    clipToFrame(ctx, clip);
    while (i < content.length && plan.clipFrames.get(content[i]!.id) === clip) {
      drawElementInto(ctx, content[i]!, env);
      i++;
    }
    ctx.restore();
  }
  if (showFrameNames) for (const frame of plan.frames) drawFrameName(ctx, frame, env.zoom);
  return plan.frames.length + plan.content.length;
}

/** Applies the dark-mode inversion to the whole canvas content (filter when available, else pixels). */
export function applyDarkModePass(ctx: Ctx, width: number, height: number): void {
  if (supportsCanvasFilter(ctx)) {
    const scratch = createScratchCanvas(width, height);
    const sctx = scratch ? getScratchContext(scratch) : null;
    if (scratch && sctx) {
      sctx.drawImage(ctx.canvas, 0, 0);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.filter = DARK_MODE_FILTER;
      ctx.drawImage(scratch, 0, 0);
      ctx.restore();
      return;
    }
  }
  try {
    applyDarkModeToCanvas(ctx, width, height);
  } catch {
    // Tainted canvas (cross-origin image without CORS): leave the light rendering.
  }
}

/**
 * Renders elements outside the live editor (exports, thumbnails). The caller sizes the canvas to
 * `bounds × scale`; the canvas is cleared, the background (if any) filled, and elements drawn with
 * the same drawables as the editor. `theme: 'dark'` applies the dark-mode inversion to the result
 * (images counter-filtered so they look unchanged).
 */
export function renderSceneToCanvas(
  ctx: CanvasRenderingContext2D,
  elements: readonly SceneElement[],
  options: SceneRenderOptions & { cache?: DrawableCache },
): void {
  renderSceneInto(ctx, elements, options);
}

export function renderSceneInto(
  ctx: Ctx,
  elements: readonly SceneElement[],
  options: SceneRenderOptions & { cache?: DrawableCache },
): void {
  const { bounds, scale } = options;
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, width, height);
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
  const env: DrawEnv = {
    images: options.images,
    cache: options.cache ?? new DrawableCache(),
    zoom: scale,
    theme: options.theme,
    getElement: options.getElement,
  };
  const plan = planRender(elements, {
    getElement: options.getElement,
    view: rectToBounds(bounds),
    frameTitleHeight: options.showFrameNames ? frameTitleHeight(scale) : 0,
  });
  drawPlan(ctx, plan, env, options.showFrameNames);
  ctx.restore();
  if (options.theme === 'dark') applyDarkModePass(ctx, width, height);
}
