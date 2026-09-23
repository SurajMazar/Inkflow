import {
  isFilled,
  layoutText,
  minTextWidth,
  type FrameElement,
  type FreedrawElement,
  type ImageElement,
  type TextElement,
} from '@inkflow/elements';
import { roundedRectPath, type Path } from '@inkflow/geometry';
import { getBrushSettings, getFreedrawOutline, outlineToPath } from '../freedraw';
import { curvePath, rectPath } from '../paths';
import { roughPath } from '../rough/generator';
import { roughOptionsFor, strokePaint } from './style';
import { textBlock } from './text';
import type { DrawLayer, ShapeLayer } from './types';

/** Freehand strokes: a filled variable-width outline polygon (never a raster). */
export function freedrawLayers(el: FreedrawElement): DrawLayer[] {
  const layers: DrawLayer[] = [];
  if (el.points.length === 0) return layers;
  const brush = getBrushSettings(el);
  // Closed loops drawn with a background color get their inside filled beneath the stroke.
  if (isFilled(el) && el.points.length > 3) {
    const first = el.points[0]!;
    const last = el.points[el.points.length - 1]!;
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= Math.max(8, brush.size * 2)) {
      const center = curvePath(
        el.points.map((p) => ({ x: p[0], y: p[1] })),
        true,
      );
      layers.push({ kind: 'shape', sets: [{ type: 'fill', path: center }], stroke: null, fill: el.backgroundColor, sketch: null, fillRule: 'nonzero' });
    }
  }
  const outline = getFreedrawOutline(el.points, {
    size: brush.size,
    thinning: brush.thinning,
    smoothing: brush.smoothing,
    streamline: brush.streamline,
    simulatePressure: brush.simulatePressure,
    last: true,
  });
  const path = outlineToPath(outline);
  const stroke: ShapeLayer = {
    kind: 'shape',
    sets: [{ type: 'fill', path }],
    stroke: null,
    fill: el.strokeColor,
    sketch: null,
    fillRule: 'nonzero',
  };
  if (brush.alpha < 1) stroke.alpha = brush.alpha;
  layers.push(stroke);
  return layers;
}

/** Text elements: optional background box, then wrapped/aligned lines. */
export function textLayers(el: TextElement): DrawLayer[] {
  const layers: DrawLayer[] = [];
  const wrapWidth = el.autoResize ? null : Math.max(el.width, minTextWidth(el));
  if (isFilled(el)) {
    const pad = Math.max(2, el.fontSize * 0.2);
    const bgPath = roundedRectPath(-pad, -pad, el.width + pad * 2, el.height + pad * 2, Math.min(6, pad * 1.5));
    layers.push({ kind: 'shape', sets: [{ type: 'fill', path: bgPath }], stroke: null, fill: el.backgroundColor, sketch: null, fillRule: 'nonzero' });
  }
  if (el.text.length === 0) return layers;
  const layout = layoutText(el.text, el, wrapWidth);
  const width = Math.max(el.width, el.autoResize ? layout.width : 0);
  const { layer } = textBlock({
    text: el.text,
    style: el,
    color: el.strokeColor,
    align: el.textAlign,
    verticalAlign: el.verticalAlign,
    decoration: el.textDecoration,
    box: { x: 0, y: 0, width, height: el.height },
    wrapWidth,
  });
  layers.push(layer);
  return layers;
}

/** Images: bitmap (resolved at draw time) plus an optional border. */
export function imageLayers(el: ImageElement): DrawLayer[] {
  const layers: DrawLayer[] = [
    {
      kind: 'image',
      fileId: el.fileId,
      x: 0,
      y: 0,
      width: el.width,
      height: el.height,
      crop: el.crop,
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
      flipX: el.flipX,
      flipY: el.flipY,
    },
  ];
  const stroke = strokePaint(el);
  if (stroke) {
    const sets = roughPath(rectPath(0, 0, el.width, el.height), roughOptionsFor(el, 0), false);
    layers.push({ kind: 'shape', sets, stroke, fill: null, sketch: null, fillRule: 'nonzero' });
  }
  return layers;
}

/** Frames: background fill and a thin border (the name is drawn separately at screen size). */
export function frameLayers(el: FrameElement): DrawLayer[] {
  const path: Path = rectPath(0, 0, el.width, el.height);
  const filled = isFilled(el);
  const sets = roughPath(path, roughOptionsFor(el, 0, { fillStyle: 'solid' }), filled);
  const stroke = strokePaint(el);
  return [
    {
      kind: 'shape',
      sets,
      stroke: stroke ? { ...stroke, cap: 'square', join: 'miter' } : null,
      fill: filled ? el.backgroundColor : null,
      sketch: null,
      fillRule: 'nonzero',
    },
  ];
}
