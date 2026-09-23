import type { FileMetadata, SceneElement } from '@inkflow/elements';
import type { Rect } from '@inkflow/geometry';
import type { DocumentAppState } from '@inkflow/scene';

/** What to export: the caller picks selection / frame / viewport scopes via elements, frameId, bounds. */
export interface ExportScope {
  elements: readonly SceneElement[];
  getElement: (id: string) => SceneElement | undefined;
  files: Record<string, FileMetadata>;
  appState: DocumentAppState;
}

export type ExportCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface RasterExportOptions {
  /** Fill with `appState.viewBackgroundColor` (false = transparent). */
  background: boolean;
  /** Apply the dark-mode inversion to the output (images counter-filtered). */
  darkMode: boolean;
  /** World-space padding around the exported elements (not applied to frame/viewport exports). */
  padding: number;
  /** Output pixels per world unit. */
  scale: number;
  /** Frame export: crop to this frame (the frame and its children are exported). */
  frameId?: string | null;
  /** Viewport export: exact world rectangle. */
  bounds?: Rect | null;
  /** Decodes an image file for drawing. */
  loadImage: (file: FileMetadata) => Promise<CanvasImageSource>;
  /** Embed the scene JSON (PNG iTXt chunk / SVG metadata) so the file can be re-imported. */
  embedScene?: boolean;
  /** Maximum output pixel count; the scale is lowered to fit (default 32M). */
  maxPixels?: number;
  /** Canvas factory (defaults to `document.createElement('canvas')`, then OffscreenCanvas). */
  createCanvas?: (width: number, height: number) => ExportCanvas;
}

export interface ExportFontSource {
  /** CSS family name as used in FONT_FAMILIES (e.g. "Kalam"). */
  family: string;
  url: string;
  weight?: string;
  style?: string;
}
