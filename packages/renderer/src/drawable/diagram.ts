import {
  computeSequenceLayout,
  computeTableLayout,
  computeUmlClassLayout,
  getNodeGeometry,
  iconRegistry,
  type SequenceLayout,
} from '@inkflow/diagram-engine';
import {
  getFontString,
  isFilled,
  measureLineWidth,
  type NodeElement,
  type SceneElement,
  type SequenceElement,
  type TableElement,
  type UmlClassElement,
} from '@inkflow/elements';
import {
  ellipsePath,
  parseSvgPath,
  roundedRectPath,
  transformPath,
  type Path,
  type Rect,
} from '@inkflow/geometry';
import { polygon, rectPath, topRoundedRectPath } from '../paths';
import { roughPath } from '../rough/generator';
import type { DrawOpSet } from '../rough/types';
import { arrowheadGeometry, arrowheadLength } from './linear';
import { paintSets, shapeLabelLayers } from './shapes';
import { isTransparentColor, roughOptionsFor, solidPaint, strokePaint } from './style';
import { textBlock, textLine } from './text';
import type { DrawLayer, ShapeLayer, StrokePaint } from './types';

function strokeOnly(sets: DrawOpSet[], stroke: StrokePaint | null, alpha?: number): ShapeLayer {
  const layer: ShapeLayer = { kind: 'shape', sets: sets.filter((s) => s.type === 'stroke'), stroke, fill: null, sketch: null, fillRule: 'nonzero' };
  if (alpha !== undefined) layer.alpha = alpha;
  return layer;
}

function fillOnly(path: Path, color: string, alpha?: number): ShapeLayer {
  const layer: ShapeLayer = { kind: 'shape', sets: [{ type: 'fill', path }], stroke: null, fill: color, sketch: null, fillRule: 'evenodd' };
  if (alpha !== undefined) layer.alpha = alpha;
  return layer;
}

/** Sketchy line between two points using an element-derived sub-seed. */
function lineLayer(el: SceneElement, salt: number, x1: number, y1: number, x2: number, y2: number, stroke: StrokePaint | null, alpha?: number): ShapeLayer {
  const sets = roughPath(polygon([{ x: x1, y: y1 }, { x: x2, y: y2 }], false), roughOptionsFor(el, salt, { width: Math.abs(x2 - x1) + 20, height: Math.abs(y2 - y1) + 20, disableMultiStroke: stroke?.dash != null }), false);
  return strokeOnly(sets, stroke, alpha);
}

// ---------------------------------------------------------------------------------------------
// Nodes

/** Icon paths (24×24 Lucide-style) scaled into a box, as crisp stroke/fill layers. */
export function iconLayers(key: string, box: Rect, color: string): DrawLayer[] {
  const def = iconRegistry.get(key);
  if (!def || box.width <= 0 || box.height <= 0) return [];
  const size = Math.min(box.width, box.height);
  const s = size / 24;
  const ox = box.x + (box.width - size) / 2;
  const oy = box.y + (box.height - size) / 2;
  const strokes: DrawOpSet[] = [];
  const fills: DrawOpSet[] = [];
  for (const d of def.paths) {
    try {
      strokes.push({ type: 'stroke', path: transformPath(parseSvgPath(d), s, s, ox, oy) });
    } catch {
      // Malformed icon data is skipped rather than breaking the whole element.
    }
  }
  for (const d of def.fills ?? []) {
    try {
      fills.push({ type: 'fill', path: transformPath(parseSvgPath(d), s, s, ox, oy) });
    } catch {
      // see above
    }
  }
  const layers: DrawLayer[] = [];
  if (fills.length) layers.push({ kind: 'shape', sets: fills, stroke: null, fill: color, sketch: null, fillRule: 'nonzero' });
  if (strokes.length) layers.push({ kind: 'shape', sets: strokes, stroke: solidPaint(color, Math.max(0.75, 2 * s)), fill: null, sketch: null, fillRule: 'nonzero' });
  return layers;
}

export function nodeLayers(el: NodeElement): { layers: DrawLayer[]; labelLayers: DrawLayer[] } {
  const geom = getNodeGeometry(el);
  const filled = isFilled(el);
  const layers: DrawLayer[] = [paintSets(el, roughPath(geom.outline, roughOptionsFor(el, 0), filled))];
  const stroke = strokePaint({ ...el, strokeStyle: 'solid' });
  (geom.details ?? []).forEach((d, i) => {
    layers.push(strokeOnly(roughPath(d, roughOptionsFor(el, 20 + i, { disableMultiStroke: false }), false), stroke));
  });
  for (const f of geom.fills ?? []) {
    if (!isTransparentColor(el.strokeColor)) layers.push(fillOnly(f, el.strokeColor));
  }
  if (el.icon && geom.iconBox && !isTransparentColor(el.strokeColor)) {
    layers.push(...iconLayers(el.icon, geom.iconBox, el.strokeColor));
  }
  const subtitle = el.metadata['subtitle'];
  if (geom.subtitleBox && subtitle) {
    const fontSize = Math.max(8, Math.round((el.label?.fontSize ?? 16) * 0.75));
    const { layer } = textBlock({
      text: subtitle,
      style: { fontFamily: el.label?.fontFamily ?? 'sans', fontSize, fontWeight: 'normal', fontStyle: 'normal', lineHeight: 1.25, letterSpacing: 0 },
      color: el.label?.color ?? el.strokeColor,
      align: 'center',
      verticalAlign: 'top',
      decoration: 'none',
      box: geom.subtitleBox,
      wrapWidth: Math.max(1, geom.subtitleBox.width),
    });
    layer.alpha = 0.75;
    layers.push(layer);
  }
  const labelBox = geom.labelBox ?? { x: 8, y: 8, width: Math.max(1, el.width - 16), height: Math.max(1, el.height - 16) };
  return { layers, labelLayers: shapeLabelLayers(el.label, el.strokeColor, labelBox) };
}

// ---------------------------------------------------------------------------------------------
// Tables (ER entities)

const BADGE_STYLES: Record<string, { bg: string; fg: string }> = {
  PK: { bg: '#fff3bf', fg: '#e67700' },
  FK: { bg: '#d0ebff', fg: '#1864ab' },
  UQ: { bg: '#e9ecef', fg: '#495057' },
};

export function tableLayers(el: TableElement): DrawLayer[] {
  const layout = computeTableLayout(el);
  const w = el.width;
  const h = el.height;
  const radius = el.roundness === 'round' ? Math.min(8, w / 4, h / 4) : 0;
  const outline = radius > 0 ? roundedRectPath(0, 0, w, h, radius) : rectPath(0, 0, w, h);
  const filled = isFilled(el);
  const body = roughPath(outline, roughOptionsFor(el, 0, { fillStyle: 'solid' }), filled);
  const stroke = strokePaint(el);
  const thin = stroke ? { ...stroke, width: Math.max(0.5, stroke.width * 0.5), dash: null } : null;
  const layers: DrawLayer[] = [];
  if (filled) layers.push({ kind: 'shape', sets: body.filter((s) => s.type === 'fill'), stroke: null, fill: el.backgroundColor, sketch: null, fillRule: 'nonzero' });

  const content: DrawLayer[] = [];
  const headerH = Math.min(layout.headerHeight, h);
  if (!isTransparentColor(el.headerColor)) {
    const header = roughPath(topRoundedRectPath(0, 0, w, headerH, radius), roughOptionsFor(el, 30, { fillStyle: 'solid' }), true);
    content.push({ kind: 'shape', sets: header.filter((s) => s.type === 'fill'), stroke: null, fill: el.headerColor, sketch: null, fillRule: 'nonzero' });
  }
  content.push(
    textLine(el.name, w / 2, headerH / 2, { fontFamily: el.fontFamily, fontSize: layout.headerFontSize, color: el.strokeColor, align: 'center', bold: true }),
  );
  if (stroke && el.columns.length > 0) content.push(lineLayer(el, 31, 0, headerH, w, headerH, { ...stroke, dash: null }));
  const badgeFontSize = Math.max(8, Math.round(layout.fontSize * 0.8));
  const badgeFont = getFontString({ fontFamily: el.fontFamily, fontSize: badgeFontSize, fontWeight: 'bold', fontStyle: 'normal' });
  layout.rows.forEach((row, i) => {
    const col = el.columns.find((c) => c.id === row.columnId);
    if (!col) return;
    const cy = row.y + row.height / 2;
    if (i < layout.rows.length - 1 && thin) {
      content.push(lineLayer(el, 40 + i, 0, row.y + row.height, w, row.y + row.height, thin, 0.35));
    }
    let bx = layout.padding * 0.6;
    for (const badge of row.badge.split(' ').filter(Boolean)) {
      const style = BADGE_STYLES[badge] ?? BADGE_STYLES['UQ']!;
      const tw = measureLineWidth(badge, badgeFont, 0);
      const bw = tw + 6;
      const bh = badgeFontSize + 4;
      content.push(fillOnly(roundedRectPath(bx, cy - bh / 2, bw, bh, 3), style.bg));
      content.push(textLine(badge, bx + bw / 2, cy, { fontFamily: el.fontFamily, fontSize: badgeFontSize, color: style.fg, align: 'center', bold: true }));
      bx += bw + 2;
    }
    content.push(
      textLine(col.name, layout.nameColumnX, cy, {
        fontFamily: el.fontFamily,
        fontSize: layout.fontSize,
        color: el.strokeColor,
        bold: col.primaryKey,
        decoration: col.unique && !col.primaryKey ? 'underline' : 'none',
      }),
    );
    const type = col.nullable || col.primaryKey ? col.dataType : `${col.dataType}!`;
    content.push(textLine(type, layout.typeColumnX, cy, { fontFamily: el.fontFamily, fontSize: layout.fontSize, color: el.strokeColor, alpha: 0.65 }));
  });
  layers.push({ kind: 'group', clip: { path: outline, rule: 'nonzero' }, children: content });
  if (stroke) layers.push(strokeOnly(body, stroke));
  return layers;
}

// ---------------------------------------------------------------------------------------------
// UML classes

export function umlClassLayers(el: UmlClassElement): DrawLayer[] {
  const layout = computeUmlClassLayout(el);
  const w = el.width;
  const h = el.height;
  const radius = el.roundness === 'round' ? Math.min(6, w / 4, h / 4) : 0;
  const outline = radius > 0 ? roundedRectPath(0, 0, w, h, radius) : rectPath(0, 0, w, h);
  const filled = isFilled(el);
  const body = roughPath(outline, roughOptionsFor(el, 0), filled);
  const stroke = strokePaint(el);
  const layers: DrawLayer[] = [];
  if (filled) layers.push(paintSets(el, body.filter((s) => s.type !== 'stroke')));
  const content: DrawLayer[] = [];
  const lh = layout.lineHeight;
  const text = { fontFamily: el.fontFamily, fontSize: layout.fontSize, color: el.strokeColor };
  for (const line of layout.nameLines) {
    content.push(textLine(line.text, w / 2, line.y + lh / 2, { ...text, align: 'center', bold: line.bold, italic: line.italic }));
  }
  if (stroke) {
    const sep = { ...stroke, dash: null };
    if (layout.attributesY < h) content.push(lineLayer(el, 50, 0, layout.attributesY, w, layout.attributesY, sep));
    if (layout.methodsY < h) content.push(lineLayer(el, 51, 0, layout.methodsY, w, layout.methodsY, sep));
  }
  for (const line of layout.attributeLines) {
    content.push(textLine(line.text, layout.paddingX, line.y + lh / 2, { ...text, decoration: line.underline ? 'underline' : 'none' }));
  }
  for (const line of layout.methodLines) {
    content.push(textLine(line.text, layout.paddingX, line.y + lh / 2, { ...text, italic: line.italic, decoration: line.underline ? 'underline' : 'none' }));
  }
  layers.push({ kind: 'group', clip: { path: outline, rule: 'nonzero' }, children: content });
  if (stroke) layers.push(strokeOnly(body, stroke));
  return layers;
}

// ---------------------------------------------------------------------------------------------
// Sequence diagrams

type Participant = SequenceLayout['participants'][number];

function cylinderPaths(x: number, y: number, w: number, h: number): { outline: Path; rim: Path } {
  const ry = Math.min(8, h * 0.18);
  const rx = w / 2;
  const cx = x + rx;
  const k = 0.5522847498307936;
  const outline: Path = [
    { type: 'M', x, y: y + ry },
    { type: 'C', x1: x, y1: y + ry - ry * k, x2: cx - rx * k, y2: y, x: cx, y },
    { type: 'C', x1: cx + rx * k, y1: y, x2: x + w, y2: y + ry - ry * k, x: x + w, y: y + ry },
    { type: 'L', x: x + w, y: y + h - ry },
    { type: 'C', x1: x + w, y1: y + h - ry + ry * k, x2: cx + rx * k, y2: y + h, x: cx, y: y + h },
    { type: 'C', x1: cx - rx * k, y1: y + h, x2: x, y2: y + h - ry + ry * k, x, y: y + h - ry },
    { type: 'Z' },
  ];
  const rim: Path = [
    { type: 'M', x, y: y + ry },
    { type: 'C', x1: x, y1: y + ry + ry * k, x2: cx - rx * k, y2: y + ry * 2, x: cx, y: y + ry * 2 },
    { type: 'C', x1: cx + rx * k, y1: y + ry * 2, x2: x + w, y2: y + ry + ry * k, x: x + w, y: y + ry },
  ];
  return { outline, rim };
}

function participantLayers(el: SequenceElement, p: Participant, index: number, layout: SequenceLayout): DrawLayer[] {
  const layers: DrawLayer[] = [];
  const stroke = strokePaint({ ...el, strokeStyle: 'solid' });
  const fill = isFilled(el) ? el.backgroundColor : '#ffffff';
  const salt = 100 + index * 10;
  const opts = (k: number, size: number) => roughOptionsFor(el, salt + k, { width: size, height: size, disableMultiStroke: false, fillStyle: 'solid' });
  const top = p.headerY;
  const cx = p.centerX;
  const nameFont = { fontFamily: el.fontFamily, fontSize: el.fontSize, color: el.strokeColor, align: 'center' as const, bold: true };
  const figureName = () => textLine(p.name, cx, top + 36 + 4 + layout.lineHeight / 2, nameFont);
  const shape = (path: Path, k: number, size: number, filledShape: boolean): ShapeLayer => ({
    kind: 'shape',
    sets: roughPath(path, opts(k, size), filledShape),
    stroke,
    fill: filledShape ? fill : null,
    sketch: null,
    fillRule: 'nonzero',
  });
  switch (p.kind) {
    case 'participant': {
      const path = el.roundness === 'round' ? roundedRectPath(p.headerX, top, p.headerWidth, p.headerHeight, 4) : rectPath(p.headerX, top, p.headerWidth, p.headerHeight);
      layers.push(shape(path, 0, Math.min(p.headerWidth, p.headerHeight), true));
      layers.push(textLine(p.name, cx, top + p.headerHeight / 2, nameFont));
      break;
    }
    case 'database': {
      const { outline, rim } = cylinderPaths(p.headerX, top, p.headerWidth, p.headerHeight);
      layers.push(shape(outline, 0, Math.min(p.headerWidth, p.headerHeight), true));
      layers.push(shape(rim, 1, p.headerWidth, false));
      const ry = Math.min(8, p.headerHeight * 0.18);
      layers.push(textLine(p.name, cx, top + ry * 2 + (p.headerHeight - ry * 3) / 2, nameFont));
      break;
    }
    case 'actor': {
      layers.push(shape(ellipsePath(cx, top + 7, 6, 6), 0, 12, true));
      layers.push(
        shape(polygon([{ x: cx, y: top + 13 }, { x: cx, y: top + 26 }], false), 1, 30, false),
        shape(polygon([{ x: cx - 10, y: top + 18 }, { x: cx + 10, y: top + 18 }], false), 2, 30, false),
        shape(polygon([{ x: cx - 9, y: top + 36 }, { x: cx, y: top + 26 }, { x: cx + 9, y: top + 36 }], false), 3, 30, false),
      );
      layers.push(figureName());
      break;
    }
    case 'boundary': {
      layers.push(shape(polygon([{ x: cx - 16, y: top + 6 }, { x: cx - 16, y: top + 30 }], false), 1, 30, false));
      layers.push(shape(polygon([{ x: cx - 16, y: top + 18 }, { x: cx - 6, y: top + 18 }], false), 2, 30, false));
      layers.push(shape(ellipsePath(cx + 6, top + 18, 12, 12), 0, 24, true));
      layers.push(figureName());
      break;
    }
    case 'control': {
      layers.push(shape(ellipsePath(cx, top + 20, 14, 14), 0, 28, true));
      layers.push(shape(polygon([{ x: cx + 5, y: top + 1 }, { x: cx - 2, y: top + 6 }, { x: cx + 5, y: top + 11 }], false), 1, 30, false));
      layers.push(figureName());
      break;
    }
    case 'entity': {
      layers.push(shape(ellipsePath(cx, top + 17, 14, 14), 0, 28, true));
      layers.push(shape(polygon([{ x: cx - 14, y: top + 34 }, { x: cx + 14, y: top + 34 }], false), 1, 30, false));
      layers.push(figureName());
      break;
    }
  }
  return layers;
}

export function sequenceLayers(el: SequenceElement): DrawLayer[] {
  const layout = computeSequenceLayout(el);
  const layers: DrawLayer[] = [];
  const stroke = strokePaint({ ...el, strokeStyle: 'solid' });
  if (isFilled(el)) {
    layers.push(fillOnly(rectPath(0, 0, el.width, el.height), el.backgroundColor));
  }
  if (!stroke) return layers;
  const sw = el.strokeWidth;
  const lifelineDash = [sw * 4 + 2, sw * 3 + 2];
  // Lifelines (below everything else).
  layout.participants.forEach((p, i) => {
    if (p.lifelineBottom > p.lifelineTop) {
      layers.push(lineLayer(el, 300 + i, p.centerX, p.lifelineTop, p.centerX, p.lifelineBottom, { ...stroke, dash: lifelineDash }, 0.7));
    }
    if (p.destroyed) {
      const y = p.lifelineBottom;
      const s = 8;
      layers.push(lineLayer(el, 400 + i * 2, p.centerX - s, y - s, p.centerX + s, y + s, { ...stroke, width: sw * 1.5 }));
      layers.push(lineLayer(el, 401 + i * 2, p.centerX + s, y - s, p.centerX - s, y + s, { ...stroke, width: sw * 1.5 }));
    }
  });
  // Activation bars.
  const barFill = isFilled(el) ? el.backgroundColor : '#ffffff';
  layout.activations.forEach((a, i) => {
    const path = rectPath(a.x, a.top, a.width, Math.max(1, a.bottom - a.top));
    layers.push({
      kind: 'shape',
      sets: roughPath(path, roughOptionsFor(el, 500 + i, { width: a.width, height: a.bottom - a.top, fillStyle: 'solid', disableMultiStroke: false }), true),
      stroke,
      fill: barFill,
      sketch: null,
      fillRule: 'nonzero',
    });
  });
  // Participant headers.
  layout.participants.forEach((p, i) => layers.push(...participantLayers(el, p, i, layout)));
  // Messages.
  const headLen = Math.min(12, arrowheadLength(sw));
  layout.messages.forEach((m, i) => {
    const dashed = m.kind === 'return' || m.kind === 'create';
    const paint = dashed ? { ...stroke, dash: [sw * 3 + 3, sw * 2 + 3] } : stroke;
    const points = m.self
      ? [
          { x: m.fromX, y: m.y },
          { x: Math.max(m.fromX, m.toX) + m.loopWidth, y: m.y },
          { x: Math.max(m.fromX, m.toX) + m.loopWidth, y: m.y + m.loopHeight },
          { x: m.toX, y: m.y + m.loopHeight },
        ]
      : [
          { x: m.fromX, y: m.y },
          { x: m.toX, y: m.y },
        ];
    const opts = roughOptionsFor(el, 600 + i * 3, { width: 40, height: 40, disableMultiStroke: dashed });
    layers.push(strokeOnly(roughPath(polygon(points, false), opts, false), paint));
    const tip = points[points.length - 1]!;
    const prev = points[points.length - 2]!;
    const dl = Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1;
    const dir = { x: (tip.x - prev.x) / dl, y: (tip.y - prev.y) / dl };
    const kind = m.kind === 'sync' || m.kind === 'destroy' ? 'triangle' : 'arrow';
    const g = arrowheadGeometry(kind, tip, dir, headLen);
    const hopts = roughOptionsFor(el, 601 + i * 3, { width: headLen, height: headLen, disableMultiStroke: false, fillStyle: 'solid' });
    for (const p of g.filled) layers.push({ kind: 'shape', sets: roughPath(p, hopts, true), stroke, fill: el.strokeColor, sketch: null, fillRule: 'nonzero' });
    for (const p of g.strokes) layers.push(strokeOnly(roughPath(p, hopts, false), stroke));
    if (m.label) {
      layers.push(textLine(m.label, m.labelX, m.labelY, { fontFamily: el.fontFamily, fontSize: layout.fontSize, color: el.strokeColor, align: 'center' }));
    }
  });
  // Notes (dog-eared rectangles).
  layout.notes.forEach((n, i) => {
    const f = Math.min(10, n.width / 4, n.height / 4);
    const outline = polygon(
      [
        { x: n.x, y: n.y },
        { x: n.x + n.width - f, y: n.y },
        { x: n.x + n.width, y: n.y + f },
        { x: n.x + n.width, y: n.y + n.height },
        { x: n.x, y: n.y + n.height },
      ],
      true,
    );
    const fold = polygon(
      [
        { x: n.x + n.width - f, y: n.y },
        { x: n.x + n.width - f, y: n.y + f },
        { x: n.x + n.width, y: n.y + f },
      ],
      false,
    );
    const nopts = roughOptionsFor(el, 800 + i * 2, { width: n.width, height: n.height, fillStyle: 'solid', disableMultiStroke: false });
    layers.push({ kind: 'shape', sets: roughPath(outline, nopts, true), stroke, fill: '#fff9db', sketch: null, fillRule: 'nonzero' });
    layers.push(strokeOnly(roughPath(fold, roughOptionsFor(el, 801 + i * 2, { width: f, height: f }), false), stroke));
    const lh = el.fontSize * 1.4;
    n.lines.forEach((line, li) => {
      layers.push(textLine(line, n.x + 8, n.y + 8 + (li + 0.5) * lh, { fontFamily: el.fontFamily, fontSize: el.fontSize, color: el.strokeColor }));
    });
  });
  return layers;
}
