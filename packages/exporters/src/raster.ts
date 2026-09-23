import type { FileMetadata, SceneElement } from '@inkflow/elements';
import { renderSceneToCanvas, type ImageSource } from '@inkflow/renderer';
import { elementsForExport, getExportBounds } from './bounds';
import { sceneJsonForEmbedding } from './json';
import { SCENE_KEYWORD, embedTextInPng, readTextFromPng } from './png';
import type { ExportCanvas, ExportScope, RasterExportOptions } from './types';

export const DEFAULT_MAX_PIXELS = 32 * 1024 * 1024;
/** Largest canvas side supported by all major browsers. */
export const MAX_CANVAS_SIDE = 16_384;

type LoadedImages = ImageSource & { images: Map<string, CanvasImageSource> };

/** Loads every image referenced by the elements (failures become placeholders). */
export async function loadExportImages(
  elements: readonly SceneElement[],
  files: Record<string, FileMetadata>,
  load: (file: FileMetadata) => Promise<CanvasImageSource>,
): Promise<LoadedImages> {
  const images = new Map<string, CanvasImageSource>();
  const failed = new Set<string>();
  const ids = new Set<string>();
  for (const el of elements) if (el.type === 'image' && el.fileId && !el.isDeleted) ids.add(el.fileId);
  await Promise.all(
    [...ids].map(async (id) => {
      const file = files[id];
      if (!file) return;
      try {
        images.set(id, await load(file));
      } catch {
        failed.add(id);
      }
    }),
  );
  return {
    images,
    get: (id) => images.get(id) ?? null,
    status: (id) => (images.has(id) ? 'loaded' : failed.has(id) ? 'error' : 'missing'),
  };
}

export function defaultCreateCanvas(width: number, height: number): ExportCanvas {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  throw new Error('Raster export needs a canvas implementation (browser or worker)');
}

/** Scale lowered so that the output fits `maxPixels` and the maximum canvas side. */
export function clampExportScale(width: number, height: number, scale: number, maxPixels = DEFAULT_MAX_PIXELS): number {
  let s = scale > 0 ? scale : 1;
  const w = Math.max(1e-6, width);
  const h = Math.max(1e-6, height);
  if (w * s * (h * s) > maxPixels) s = Math.sqrt(maxPixels / (w * h));
  s = Math.min(s, MAX_CANVAS_SIDE / w, MAX_CANVAS_SIDE / h);
  return s;
}

/** Renders the scope into a new canvas sized `bounds × scale` (scale clamped to `maxPixels`). */
export async function exportToCanvas(scope: ExportScope, options: RasterExportOptions): Promise<HTMLCanvasElement> {
  const bounds = getExportBounds(scope, options);
  const scale = clampExportScale(bounds.width, bounds.height, options.scale, options.maxPixels ?? DEFAULT_MAX_PIXELS);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const canvas = (options.createCanvas ?? defaultCreateCanvas)(width, height);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D canvas context unavailable');
  const elements = elementsForExport(scope, options.frameId);
  const images = await loadExportImages(elements, scope.files, options.loadImage);
  renderSceneToCanvas(ctx, elements, {
    bounds,
    scale,
    background: options.background ? scope.appState.viewBackgroundColor : null,
    theme: options.darkMode ? 'dark' : 'light',
    images,
    showFrameNames: !options.frameId && !options.bounds,
    getElement: scope.getElement,
  });
  return canvas as HTMLCanvasElement;
}

/** PNG bytes of a canvas (HTMLCanvasElement.toBlob or OffscreenCanvas.convertToBlob). */
export async function canvasToPngBlob(canvas: ExportCanvas): Promise<Blob> {
  const off = canvas as OffscreenCanvas;
  if (typeof off.convertToBlob === 'function') return off.convertToBlob({ type: 'image/png' });
  const html = canvas as HTMLCanvasElement;
  return new Promise<Blob>((resolve, reject) => {
    html.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas encoding failed'))), 'image/png');
  });
}

/** Embeds a scene JSON string into PNG bytes (iTXt chunk "inkflow", deflate-compressed). */
export function embedSceneInPng(png: Uint8Array, sceneJson: string): Promise<Uint8Array> {
  return embedTextInPng(png, SCENE_KEYWORD, sceneJson);
}

/** Exports a PNG; with `embedScene` the scene JSON is embedded so the PNG can be re-opened. */
export async function exportToPngBlob(scope: ExportScope, options: RasterExportOptions): Promise<Blob> {
  const canvas = await exportToCanvas(scope, options);
  const blob = await canvasToPngBlob(canvas);
  if (!options.embedScene) return blob.type === 'image/png' ? blob : new Blob([await blob.arrayBuffer()], { type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const withScene = await embedSceneInPng(bytes, sceneJsonForEmbedding(scope));
  return new Blob([withScene as BlobPart], { type: 'image/png' });
}

/** Scene JSON embedded in a PNG exported with `embedScene`, or null. */
export async function extractSceneFromPng(blob: Blob): Promise<string | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return readTextFromPng(bytes, SCENE_KEYWORD);
}
