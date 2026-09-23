import { isFilled, layoutText, type Arrowhead, type EdgeLabel, type LinearElement } from '@inkflow/elements';
import { ellipsePath, pointAlongPolyline, polylineLength, type Path, type Point } from '@inkflow/geometry';
import { roughPath } from '../rough/generator';
import {
  curvePath,
  endTangent,
  flattenFirst,
  polygon,
  rectPath,
  roundedPolylinePath,
  trimPath,
} from '../paths';
import { roughOptionsFor, strokePaint } from './style';
import { textBlock } from './text';
import type { DrawLayer, ShapeLayer } from './types';

const BEND_RADIUS = 12;

/** Local (element-relative, unrotated) centerline path of a linear element, before roughening. */
export function linearLocalPath(el: LinearElement): Path {
  const pts: Point[] = el.points.map((p) => ({ x: p[0], y: p[1] }));
  if (pts.length === 0) return [];
  if (pts.length === 1) return [{ type: 'M', x: pts[0]!.x, y: pts[0]!.y }, { type: 'L', x: pts[0]!.x, y: pts[0]!.y }];
  if (el.type === 'connector') {
    switch (el.routing) {
      case 'bezier':
        if (pts.length === 4) {
          const [p0, c1, c2, p1] = pts as [Point, Point, Point, Point];
          return [
            { type: 'M', x: p0.x, y: p0.y },
            { type: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p1.x, y: p1.y },
          ];
        }
        return curvePath(pts);
      case 'curved':
        return curvePath(pts);
      default:
        return el.roundness === 'round' ? roundedPolylinePath(pts, BEND_RADIUS) : polygon(pts, false);
    }
  }
  const closed = el.type === 'line' && el.closed && pts.length > 2;
  switch (el.pathStyle) {
    case 'curved':
      return curvePath(pts, closed);
    case 'elbow':
      if (closed) return polygon(pts, true);
      return el.roundness === 'round' ? roundedPolylinePath(pts, BEND_RADIUS) : polygon(pts, false);
    default:
      return polygon(pts, closed);
  }
}

/** Length of an arrowhead for a stroke width, limited to a fraction of the path length. */
export function arrowheadLength(strokeWidth: number, pathLength = Infinity): number {
  const base = Math.min(48, Math.max(10, strokeWidth * 4 + 8));
  return Math.max(2, Math.min(base, pathLength * 0.4));
}

interface HeadGeometry {
  /** Stroked paths (outline or open). */
  strokes: Path[];
  /** Filled + stroked closed paths (filled with the stroke color). */
  filled: Path[];
  /** Amount removed from the line end so it does not show through hollow heads. */
  trim: number;
  /** Regions knocked out of the main line (hollow ER circles). */
  knockouts: Path[];
}

/** Arrowhead geometry for tip `t`, unit direction `u` pointing out of the path. */
export function arrowheadGeometry(kind: Arrowhead, t: Point, u: Point, len: number): HeadGeometry {
  const n = { x: -u.y, y: u.x };
  const P = (a: number, b: number): Point => ({ x: t.x - u.x * a + n.x * b, y: t.y - u.y * a + n.y * b });
  const g: HeadGeometry = { strokes: [], filled: [], trim: 0, knockouts: [] };
  const w = len * 0.45;
  const bar = (d: number) => g.strokes.push(polygon([P(d, w), P(d, -w)], false));
  const crow = () => {
    const apex = P(len * 0.9, 0);
    g.strokes.push(polygon([apex, P(0, w)], false), polygon([apex, t], false), polygon([apex, P(0, -w)], false));
  };
  const circle = (d: number) => {
    const r = len * 0.25;
    const c = P(d + r, 0);
    const path = ellipsePath(c.x, c.y, r, r);
    g.strokes.push(path);
    g.knockouts.push(path);
  };
  switch (kind) {
    case 'none':
      break;
    case 'arrow':
      g.strokes.push(polygon([P(len, len * 0.5), t, P(len, -len * 0.5)], false));
      break;
    case 'triangle':
      g.filled.push(polygon([t, P(len, w), P(len, -w)], true));
      g.trim = len * 0.5;
      break;
    case 'triangle-outline':
      g.strokes.push(polygon([t, P(len, w), P(len, -w)], true));
      g.trim = len;
      break;
    case 'dot': {
      const r = len * 0.28;
      const c = P(r, 0);
      g.filled.push(ellipsePath(c.x, c.y, r, r));
      g.trim = r;
      break;
    }
    case 'circle-outline': {
      const r = len * 0.3;
      const c = P(r, 0);
      g.strokes.push(ellipsePath(c.x, c.y, r, r));
      g.trim = r * 2;
      break;
    }
    case 'bar':
      bar(0);
      break;
    case 'diamond':
      g.filled.push(polygon([t, P(len * 0.6, len * 0.3), P(len * 1.2, 0), P(len * 0.6, -len * 0.3)], true));
      g.trim = len * 0.6;
      break;
    case 'diamond-outline':
      g.strokes.push(polygon([t, P(len * 0.6, len * 0.3), P(len * 1.2, 0), P(len * 0.6, -len * 0.3)], true));
      g.trim = len * 1.2;
      break;
    case 'er-one':
      bar(len * 0.6);
      break;
    case 'er-one-only':
      bar(len * 0.5);
      bar(len * 0.85);
      break;
    case 'er-many':
      crow();
      break;
    case 'er-zero-one':
      bar(len * 0.5);
      circle(len * 0.8);
      break;
    case 'er-one-many':
      crow();
      bar(len * 1.15);
      break;
    case 'er-zero-many':
      crow();
      circle(len * 1.1);
      break;
  }
  return g;
}

/** Hand-drawn layers of a linear element (line, arrow, connector) incl. arrowheads and label. */
export function linearLayers(el: LinearElement): { layers: DrawLayer[]; labelLayers: DrawLayer[] } {
  const base = linearLocalPath(el);
  if (base.length === 0) return { layers: [], labelLayers: [] };
  const closed = el.type === 'line' && el.closed && el.points.length > 2;
  const filled = closed && isFilled(el);
  const centerline = flattenFirst(base, 16);
  const totalLength = polylineLength(centerline);
  const len = arrowheadLength(el.strokeWidth, totalLength);

  let path = base;
  const headLayers: ShapeLayer[] = [];
  const knockouts: Path[] = [];
  if (!closed) {
    const ends: [Arrowhead, boolean, number][] = [
      [el.startArrowhead, true, 11],
      [el.endArrowhead, false, 12],
    ];
    for (const [kind, atStart, salt] of ends) {
      if (kind === 'none') continue;
      const tangent = endTangent(base, atStart);
      if (!tangent) continue;
      const g = arrowheadGeometry(kind, tangent.point, tangent.dir, len);
      if (g.trim > 0) path = trimPath(path, g.trim, atStart);
      knockouts.push(...g.knockouts);
      const opts = roughOptionsFor(el, salt, { width: len, height: len, disableMultiStroke: false, fillStyle: 'solid' });
      const stroke = strokePaint({ ...el, strokeStyle: 'solid' });
      for (const p of g.filled) {
        headLayers.push({
          kind: 'shape',
          sets: roughPath(p, opts, true),
          stroke,
          fill: el.strokeColor,
          sketch: null,
          fillRule: 'nonzero',
        });
      }
      for (const p of g.strokes) {
        headLayers.push({ kind: 'shape', sets: roughPath(p, opts, false), stroke, fill: null, sketch: null, fillRule: 'nonzero' });
      }
    }
  }

  const bg = filled ? el.backgroundColor : null;
  const main: ShapeLayer = {
    kind: 'shape',
    sets: roughPath(path, roughOptionsFor(el, 0), filled),
    stroke: strokePaint(el),
    fill: bg,
    sketch: bg ? { color: bg, width: Math.max(0.5, el.strokeWidth / 2) } : null,
    fillRule: 'evenodd',
  };

  const labelLayers: DrawLayer[] = [];
  const label = el.label;
  if (label && label.text.trim().length > 0 && centerline.length > 0) {
    const { layers: lbl, knockout } = edgeLabelLayers(label, el.strokeColor, centerline);
    labelLayers.push(...lbl);
    knockouts.push(knockout);
  }

  const layers: DrawLayer[] = [];
  if (knockouts.length > 0) {
    // Even-odd clip: a huge rectangle minus the knockout regions.
    const big = 1e6;
    const clip: Path = [...rectPath(-big, -big, big * 2, big * 2), ...knockouts.flat()];
    layers.push({ kind: 'group', clip: { path: clip, rule: 'evenodd' }, children: [main] });
  } else {
    layers.push(main);
  }
  layers.push(...headLayers);
  return { layers, labelLayers };
}

/** Edge label centered on the path at `label.position`, with its knockout rectangle. */
export function edgeLabelLayers(
  label: EdgeLabel,
  strokeColor: string,
  centerline: readonly Point[],
): { layers: DrawLayer[]; knockout: Path; center: Point } {
  const { point } = pointAlongPolyline(centerline, label.position);
  const layout = layoutText(label.text, label, null);
  const width = layout.width;
  const height = layout.lines.length * layout.lineHeightPx;
  const box = { x: point.x - width / 2, y: point.y - height / 2, width, height };
  const { layer } = textBlock({
    text: label.text,
    style: label,
    color: label.color ?? strokeColor,
    align: label.textAlign,
    verticalAlign: 'middle',
    decoration: label.textDecoration,
    box,
    wrapWidth: null,
  });
  const padX = 6;
  const padY = 3;
  const knockout = rectPath(box.x - padX, box.y - padY, width + padX * 2, height + padY * 2);
  return { layers: [layer], knockout, center: point };
}
