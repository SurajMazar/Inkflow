import type { Editor } from '@inkflow/canvas-engine';
import { elementIntersectsBounds, type FileMetadata, type SceneElement } from '@inkflow/elements';
import {
  elementsForExport,
  exportToJson,
  exportToPdfBlob,
  exportToPngBlob,
  exportToSvgString,
  getExportBounds,
  type ExportFontSource,
  type ExportScope as ExportSource,
  type RasterExportOptions,
} from '@inkflow/exporters';
import type { Rect } from '@inkflow/geometry';
import interVariable from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import jetbrainsMono400 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url';
import jetbrainsMono700 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2?url';
import kalam400 from '@fontsource/kalam/files/kalam-latin-400-normal.woff2?url';
import kalam700 from '@fontsource/kalam/files/kalam-latin-700-normal.woff2?url';
import lora400 from '@fontsource/lora/files/lora-latin-400-normal.woff2?url';
import lora700 from '@fontsource/lora/files/lora-latin-700-normal.woff2?url';
import type { ExportScope } from '../hooks/ui-store';

export type ExportFormat = 'png' | 'svg' | 'pdf' | 'json';

export interface ExportSettings {
  format: ExportFormat;
  scope: ExportScope;
  /** Frame exported when `scope === 'frame'`. */
  frameId: string | null;
  /** Fill the board background (false = transparent). */
  background: boolean;
  darkMode: boolean;
  /** Output pixels per world unit (PNG, raster PDF). */
  scale: number;
  /** World-space padding (board/selection scopes). */
  padding: number;
  /** Embed the scene so PNG/SVG files can be re-imported. */
  embedScene: boolean;
  /** Embed the used fonts into SVG files. */
  embedFonts: boolean;
  pdfPages: 'single' | 'frames';
  pdfMode: 'raster' | 'vector';
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'png',
  scope: 'board',
  frameId: null,
  background: true,
  darkMode: false,
  scale: 2,
  padding: 16,
  embedScene: false,
  embedFonts: true,
  pdfPages: 'single',
  pdfMode: 'vector',
};

/** Canvas fonts bundled with the app, mapped to the CSS family names used in `FONT_FAMILIES`. */
export const EXPORT_FONT_SOURCES: ExportFontSource[] = [
  { family: 'Kalam', url: kalam400, weight: '400' },
  { family: 'Kalam', url: kalam700, weight: '700' },
  { family: 'Inter Variable', url: interVariable, weight: '100 900' },
  { family: 'JetBrains Mono', url: jetbrainsMono400, weight: '400' },
  { family: 'JetBrains Mono', url: jetbrainsMono700, weight: '700' },
  { family: 'Lora', url: lora400, weight: '400' },
  { family: 'Lora', url: lora700, weight: '700' },
];

/** Decodes an image file for raster exports (reuses the editor's decoded images when possible). */
export function makeImageLoader(
  editor: Editor,
): (file: FileMetadata) => Promise<CanvasImageSource> {
  return (file) => {
    const cached = editor.images.get(file.id);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (!file.url.startsWith('data:') && !file.url.startsWith('blob:'))
        img.crossOrigin = 'use-credentials';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load image ${file.id}`));
      img.src = file.url;
    });
  };
}

/** Reads an image file as a data URL for self-contained SVG exports. */
export async function loadImageDataUrl(file: FileMetadata): Promise<string> {
  if (file.url.startsWith('data:')) return file.url;
  const res = await fetch(file.url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Image request failed (${res.status})`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image'));
    reader.readAsDataURL(blob);
  });
}

function withFrameChildren(editor: Editor, selected: readonly SceneElement[]): SceneElement[] {
  const out = new Map(selected.map((e) => [e.id, e]));
  for (const el of selected) {
    if (el.type !== 'frame') continue;
    for (const child of editor.getElements()) if (child.frameId === el.id) out.set(child.id, child);
  }
  // Keep z-order.
  return editor.getElements().filter((e) => out.has(e.id));
}

/** Elements, files and board settings exported for the chosen scope. */
export function buildExportSource(
  editor: Editor,
  settings: Pick<ExportSettings, 'scope'>,
): ExportSource {
  const all = editor.getElements();
  const elements =
    settings.scope === 'selection' ? withFrameChildren(editor, editor.getSelectedElements()) : all;
  return {
    elements,
    getElement: (id) => editor.getElement(id),
    files: editor.files,
    appState: editor.appState,
  };
}

/** Rectangle of the viewport scope, or null for the other scopes. */
export function scopeBounds(editor: Editor, settings: Pick<ExportSettings, 'scope'>): Rect | null {
  return settings.scope === 'viewport' ? editor.visibleWorldRect() : null;
}

/** Raster options shared by PNG, PDF and the live preview. */
export function rasterOptions(editor: Editor, settings: ExportSettings): RasterExportOptions {
  const frameId = settings.scope === 'frame' ? settings.frameId : null;
  return {
    background: settings.background,
    darkMode: settings.darkMode,
    padding: settings.padding,
    scale: settings.scale,
    frameId,
    bounds: scopeBounds(editor, settings),
    loadImage: makeImageLoader(editor),
    embedScene: settings.embedScene,
  };
}

export interface ExportOutput {
  blob: Blob;
  ext: 'png' | 'svg' | 'pdf' | 'inkflow';
}

/** Runs the export for the given settings. */
export async function runExport(editor: Editor, settings: ExportSettings): Promise<ExportOutput> {
  const source = buildExportSource(editor, settings);
  const raster = rasterOptions(editor, settings);
  switch (settings.format) {
    case 'png':
      return { blob: await exportToPngBlob(source, raster), ext: 'png' };
    case 'svg': {
      const svg = await exportToSvgString(source, {
        ...raster,
        scale: 1,
        embedFonts: settings.embedFonts,
        fontSources: EXPORT_FONT_SOURCES,
        loadImageDataUrl,
      });
      return { blob: new Blob([svg], { type: 'image/svg+xml' }), ext: 'svg' };
    }
    case 'pdf': {
      const pages = settings.scope === 'board' ? settings.pdfPages : 'single';
      const blob = await exportToPdfBlob(source, {
        ...raster,
        embedScene: false,
        mode: settings.pdfMode,
        pages,
        frameOrder: editor.getOrderedFrames().map((f) => f.id),
      });
      return { blob, ext: 'pdf' };
    }
    case 'json': {
      let elements = source.elements;
      if (raster.frameId) elements = elementsForExport(source, raster.frameId);
      else if (raster.bounds) {
        const b = raster.bounds;
        const box = { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height };
        elements = elements.filter((e) => elementIntersectsBounds(e, box));
      }
      const used = new Set(
        elements.flatMap((e) => (e.type === 'image' && e.fileId ? [e.fileId] : [])),
      );
      const files = Object.fromEntries(Object.entries(source.files).filter(([id]) => used.has(id)));
      const text = exportToJson({ ...source, elements, files });
      return { blob: new Blob([text], { type: 'application/vnd.inkflow+json' }), ext: 'inkflow' };
    }
  }
}

/** World rectangle and element count that an export would cover (for the dialog summary). */
export function describeExport(
  editor: Editor,
  settings: ExportSettings,
): { bounds: Rect; count: number } {
  const source = buildExportSource(editor, settings);
  const raster = rasterOptions(editor, settings);
  const bounds = getExportBounds(source, {
    padding: raster.padding,
    frameId: raster.frameId,
    bounds: raster.bounds,
  });
  const elements = elementsForExport(source, raster.frameId).filter(
    (e) =>
      !raster.bounds ||
      elementIntersectsBounds(e, {
        minX: bounds.x,
        minY: bounds.y,
        maxX: bounds.x + bounds.width,
        maxY: bounds.y + bounds.height,
      }),
  );
  return { bounds, count: elements.length };
}
