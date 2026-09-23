import {
  LABEL_PADDING,
  getPolygonOutline,
  isFilled,
  type ShapeElement,
  type ShapeLabel,
  type SceneElement,
} from '@inkflow/elements';
import { roundedRectPath, type Path, type Point, type Rect } from '@inkflow/geometry';
import { roughEllipse, roughPath } from '../rough/generator';
import type { DrawOpSet } from '../rough/types';
import { adaptiveCornerRadius, polygon, roundedPolygonPath } from '../paths';
import { roughOptionsFor, strokePaint } from './style';
import { textBlock } from './text';
import type { DrawLayer, ShapeLayer } from './types';

/** Paints op sets with the element's stroke/fill styles. */
export function paintSets(
  el: SceneElement,
  sets: DrawOpSet[],
  fillColor: string | null = null,
): ShapeLayer {
  const bg = fillColor ?? (isFilled(el) ? el.backgroundColor : null);
  return {
    kind: 'shape',
    sets,
    stroke: strokePaint(el),
    fill: bg,
    sketch: bg ? { color: bg, width: Math.max(0.5, el.strokeWidth / 2) } : null,
    fillRule: 'evenodd',
  };
}

/** Unrotated local outline vertices of polygonal shapes (flips applied). */
export function localPolygonOutline(el: SceneElement): Point[] | null {
  return getPolygonOutline({ ...el, x: 0, y: 0 } as SceneElement);
}

/** Local outline path of a basic shape (rectangle, diamond, triangle, polygon, star), honoring roundness. */
export function shapeOutlinePath(el: ShapeElement): Path {
  const w = el.width;
  const h = el.height;
  if (el.type === 'rectangle' || el.type === 'ellipse') {
    if (el.type === 'rectangle' && el.roundness === 'round') {
      return roundedRectPath(0, 0, w, h, adaptiveCornerRadius(Math.min(w, h)));
    }
    return polygon(
      [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ],
      true,
    );
  }
  const pts = localPolygonOutline(el) ?? [];
  if (el.roundness === 'round') {
    let minEdge = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      minEdge = Math.min(minEdge, Math.hypot(a.x - b.x, a.y - b.y));
    }
    const radius = el.type === 'star' ? minEdge * 0.35 : adaptiveCornerRadius(minEdge) * 0.8;
    return roundedPolygonPath(pts, radius);
  }
  return polygon(pts, true);
}

/** Hand-drawn layers of a basic shape. */
export function shapeLayers(el: ShapeElement): DrawLayer[] {
  const filled = isFilled(el);
  const opts = roughOptionsFor(el, 0);
  let sets: DrawOpSet[];
  if (el.type === 'ellipse') {
    sets = roughEllipse(el.width / 2, el.height / 2, el.width, el.height, opts, filled);
  } else {
    sets = roughPath(shapeOutlinePath(el), opts, filled);
  }
  return [paintSets(el, sets)];
}

/** Box in which a shape label is laid out (local coordinates). */
export function shapeLabelBox(el: ShapeElement): Rect {
  const w = el.width;
  const h = el.height;
  const p = LABEL_PADDING;
  const inset = (r: Rect, pad: number): Rect => ({
    x: r.x + pad,
    y: r.y + pad,
    width: Math.max(1, r.width - pad * 2),
    height: Math.max(1, r.height - pad * 2),
  });
  switch (el.type) {
    case 'ellipse': {
      const k = Math.SQRT1_2;
      return inset(
        { x: (w * (1 - k)) / 2, y: (h * (1 - k)) / 2, width: w * k, height: h * k },
        p / 2,
      );
    }
    case 'diamond':
      return inset({ x: w / 4, y: h / 4, width: w / 2, height: h / 2 }, p / 4);
    case 'triangle': {
      const top = el.flipY ? 0 : h / 2;
      return inset({ x: w / 4, y: top, width: w / 2, height: h / 2 }, p / 4);
    }
    case 'polygon': {
      const k = 0.7;
      return inset(
        { x: (w * (1 - k)) / 2, y: (h * (1 - k)) / 2, width: w * k, height: h * k },
        p / 4,
      );
    }
    case 'star': {
      const k = Math.max(0.3, el.innerRatio) * 0.85;
      return inset({ x: (w * (1 - k)) / 2, y: (h * (1 - k)) / 2, width: w * k, height: h * k }, 0);
    }
    default:
      return inset({ x: 0, y: 0, width: w, height: h }, p);
  }
}

/** Label layers (wrapped to the label box) for shapes and nodes. */
export function shapeLabelLayers(
  label: ShapeLabel | null,
  strokeColor: string,
  box: Rect,
): DrawLayer[] {
  if (!label || label.text.length === 0) return [];
  const { layer } = textBlock({
    text: label.text,
    style: label,
    color: label.color ?? strokeColor,
    align: label.textAlign,
    verticalAlign: label.verticalAlign,
    decoration: label.textDecoration,
    box,
    wrapWidth: Math.max(1, box.width),
  });
  return [layer];
}
