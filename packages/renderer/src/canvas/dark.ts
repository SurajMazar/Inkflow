/**
 * Dark mode is a color transform of the light rendering (the web app applies it as a CSS filter
 * on the static canvas). Images are counter-filtered so photos look normal after the inversion.
 */
export const DARK_MODE_FILTER = 'invert(93%) hue-rotate(180deg)';
export const IMAGE_COUNTER_FILTER = 'invert(100%) hue-rotate(180deg)';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type ScratchCanvas = HTMLCanvasElement | OffscreenCanvas;

/** Creates an offscreen canvas in browsers/workers; null where no canvas implementation exists. */
export function createScratchCanvas(width: number, height: number): ScratchCanvas | null {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

export function getScratchContext(canvas: ScratchCanvas): Ctx | null {
  return canvas.getContext('2d') as Ctx | null;
}

/** True when `ctx.filter` is implemented (not in Safari < 18 and some test doubles). */
export function supportsCanvasFilter(ctx: Ctx): boolean {
  return typeof (ctx as { filter?: unknown }).filter === 'string';
}

/**
 * Row-major 3×3 matrix of `hue-rotate(deg)` from the Filter Effects spec.
 */
function hueRotateMatrix(deg: number): number[] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213,
    0.715 - c * 0.715 - s * 0.715,
    0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143,
    0.715 + c * 0.285 + s * 0.14,
    0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787,
    0.715 - c * 0.715 + s * 0.715,
    0.072 + c * 0.928 + s * 0.072,
  ];
}

const HUE_180 = hueRotateMatrix(180);

/** Applies `invert(amount) hue-rotate(180deg)` to RGBA pixel data in place (unpremultiplied). */
export function applyInvertHueRotate(data: Uint8ClampedArray, amount: number): void {
  const m = HUE_180;
  const slope = 1 - 2 * amount;
  const intercept = amount * 255;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i]! * slope + intercept;
    const g = data[i + 1]! * slope + intercept;
    const b = data[i + 2]! * slope + intercept;
    data[i] = m[0]! * r + m[1]! * g + m[2]! * b;
    data[i + 1] = m[3]! * r + m[4]! * g + m[5]! * b;
    data[i + 2] = m[6]! * r + m[7]! * g + m[8]! * b;
  }
}

/** Applies the dark mode transform to everything drawn on the canvas so far. */
export function applyDarkModeToCanvas(ctx: Ctx, width: number, height: number): void {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const image = ctx.getImageData(0, 0, w, h);
  applyInvertHueRotate(image.data, 0.93);
  ctx.putImageData(image, 0, 0);
}

const counterFiltered = new WeakMap<object, ScratchCanvas>();

/**
 * Image pre-inverted with `invert(100%) hue-rotate(180deg)` for contexts without `ctx.filter`.
 * Returns null when no scratch canvas is available (or the image is tainted).
 */
export function getCounterFilteredImage(image: CanvasImageSource, width: number, height: number): ScratchCanvas | null {
  const key = image as unknown as object;
  const cached = counterFiltered.get(key);
  if (cached) return cached;
  const canvas = createScratchCanvas(width, height);
  if (!canvas) return null;
  const ctx = getScratchContext(canvas);
  if (!ctx) return null;
  try {
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyInvertHueRotate(data.data, 1);
    ctx.putImageData(data, 0, 0);
  } catch {
    return null;
  }
  counterFiltered.set(key, canvas);
  return canvas;
}
