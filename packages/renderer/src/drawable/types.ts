import type { ImageCrop, TextAlign, TextDecoration } from '@inkflow/elements';
import type { Bounds, Path } from '@inkflow/geometry';
import type { DrawOpSet } from '../rough/types';

export type FillRule = 'nonzero' | 'evenodd';
export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';

export interface StrokePaint {
  color: string;
  width: number;
  /** Dash pattern in world units, null = solid. */
  dash: number[] | null;
  cap: LineCap;
  join: LineJoin;
}

/**
 * Backend-agnostic display list entries in element-local coordinates (origin at the element's
 * x/y, unrotated). Canvas, SVG and PDF backends all draw the exact same layers.
 */
export interface ShapeLayer {
  kind: 'shape';
  sets: DrawOpSet[];
  /** Paint of 'stroke' sets (null = not stroked). */
  stroke: StrokePaint | null;
  /** Color of 'fill' sets (null = not filled). */
  fill: string | null;
  /** Paint of 'fillSketch' sets. */
  sketch: { color: string; width: number } | null;
  fillRule: FillRule;
  /** Extra alpha multiplier on top of the element opacity. */
  alpha?: number;
}

export interface TextRun {
  text: string;
  /** Anchor x (left/center/right edge depending on `align`). */
  x: number;
  /** Vertical center of the line (middle baseline). */
  y: number;
  width: number;
}

export interface TextLayer {
  kind: 'text';
  runs: TextRun[];
  /** CSS font shorthand, e.g. `italic bold 20px "Kalam", cursive`. */
  font: string;
  fontFamilyCss: string;
  fontFamilyKey: 'hand' | 'sans' | 'serif' | 'mono';
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  align: TextAlign;
  decoration: TextDecoration;
  letterSpacing: number;
  alpha?: number;
}

export interface ImageLayer {
  kind: 'image';
  fileId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  crop: ImageCrop | null;
  naturalWidth: number;
  naturalHeight: number;
  flipX: boolean;
  flipY: boolean;
}

export interface GroupLayer {
  kind: 'group';
  /** Optional clip region (element-local). */
  clip: { path: Path; rule: FillRule } | null;
  children: DrawLayer[];
  alpha?: number;
}

export type DrawLayer = ShapeLayer | TextLayer | ImageLayer | GroupLayer;

/** Cached, zoom-independent drawing description of an element in element-local coordinates. */
export interface ElementDrawable {
  /** All hand-drawn op sets of the element (every shape layer, in paint order). */
  sets: DrawOpSet[];
  /** Ordered paint layers (without the embedded label). */
  layers: DrawLayer[];
  /** Embedded shape/edge label (skipped while the label is being edited). */
  labelLayers: DrawLayer[];
  /** Local box size. */
  width: number;
  height: number;
  /** Visual extent in local coordinates, including stroke width, jitter and arrowheads. */
  localBounds: Bounds;
  /** Rough cost metric (path commands + glyphs) used to decide on bitmap caching. */
  complexity: number;
  hasSketchFill: boolean;
  hasImage: boolean;
}
