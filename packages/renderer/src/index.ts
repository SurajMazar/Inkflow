export * from './types';

// Hand-drawn generator
export type { RoughOptions, DrawOpSet } from './rough/types';
export { deriveSeed } from './rough/types';
export { roughPath, roughLine, roughEllipse, roughPolyline } from './rough/generator';
export { hachureLines, zigzagLines, clipSegmentToPolygons, pointInPolygons } from './rough/fill';

// Freehand strokes
export { getFreedrawOutline, getBrushSettings, outlineToPath } from './freedraw';
export type { FreedrawOutlineOptions, BrushSettings } from './freedraw';

// Element drawables (display lists in element-local coordinates)
export type {
  ElementDrawable,
  DrawLayer,
  ShapeLayer,
  TextLayer,
  TextRun,
  ImageLayer,
  GroupLayer,
  StrokePaint,
  FillRule,
  LineCap,
  LineJoin,
} from './drawable/types';
export { DrawableCache, generateElementDrawable } from './drawable/generate';
export { linearLocalPath, arrowheadGeometry, arrowheadLength } from './drawable/linear';
export { dashPattern, isTransparentColor, effectiveRoughness } from './drawable/style';
export { measureRenderPadding } from './padding';
export { planRender, getRenderBounds, viewportWorldBounds } from './plan';
export type { RenderPlan, PlanOptions } from './plan';

// Canvas
export {
  drawElement,
  drawLayers,
  drawFrameName,
  applyElementTransform,
  imageSourceSize,
  FRAME_NAME_FONT_SIZE,
  FRAME_NAME_GAP,
  FRAME_NAME_COLOR,
} from './canvas/draw';
export type { DrawEnv, LayerDrawOptions } from './canvas/draw';
export { drawGrid, effectiveGridSize } from './canvas/grid';
export { StaticRenderer } from './canvas/static-renderer';
export type { StaticRendererOptions } from './canvas/static-renderer';
export { InteractiveRenderer, OVERLAY_PALETTES } from './canvas/interactive-renderer';
export type { OverlayPalette } from './canvas/interactive-renderer';
export { ImageCache } from './canvas/image-cache';
export type { ImageCacheOptions } from './canvas/image-cache';
export { BitmapCache } from './canvas/bitmap-cache';
export { renderSceneToCanvas, frameTitleHeight } from './canvas/scene';
export {
  DARK_MODE_FILTER,
  IMAGE_COUNTER_FILTER,
  applyInvertHueRotate,
  createScratchCanvas,
  supportsCanvasFilter,
} from './canvas/dark';

// SVG
export { renderSceneToSvg, escapeXml, pathData } from './svg/svg';
