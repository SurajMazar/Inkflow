/**
 * Converts (sanitized) SVG markup into editable native elements: basic shapes, paths, polylines
 * and text. Transforms (including nested groups, `<use>` and the root viewBox), inherited
 * presentation attributes and inline styles are resolved. The markup is sanitized first, so
 * only allow-listed content is ever interpreted, and nothing is executed.
 */
import {
  DEFAULT_TEXT_STYLE,
  MAX_FONT_SIZE,
  MAX_POINTS,
  MAX_TEXT_LENGTH,
  MIN_FONT_SIZE,
  createElement,
  measureTextElement,
  normalizeLinearPoints,
  validateElement,
  type FontFamily,
  type FontStyle,
  type FontWeight,
  type LocalPoint,
  type SceneElement,
  type StrokeStyle,
  type TextAlign,
} from '@inkflow/elements';
import {
  IDENTITY,
  applyMatrix,
  ellipsePath,
  flattenPath,
  multiply,
  parseSvgPath,
  roundedRectPath,
  translation,
  type Matrix,
  type Point,
} from '@inkflow/geometry';
import { generateNKeysBetween } from '@inkflow/scene';
import { generateId } from '@inkflow/shared';
import { DEFAULT_SVG_MAX_ELEMENTS, MAX_SVG_USE_DEPTH, MAX_SVG_VISITED_NODES } from './limits';
import { parseSanitizedSvg } from './svg-sanitize';
import {
  elementChildren,
  getAttribute,
  parseNumberList,
  parseSvgLength,
  parseViewBox,
  type ViewBox,
  type XmlElement,
} from './svg-tokenizer';

export interface SvgImportOptions {
  /** Maximum number of elements created (default 2000). */
  maxElements?: number;
}

export interface SvgImportResult {
  elements: SceneElement[];
  issues: string[];
}

/** Color used for `currentColor`. */
const CURRENT_COLOR = '#1e1e1e';
/** Color used for gradients/patterns that cannot be reduced to a single color. */
const FALLBACK_PAINT = '#868e96';
const COLOR_RE = /^[#A-Za-z0-9(),.%\s-]{1,64}$/;
/** Line height used for imported text. */
const TEXT_LINE_HEIGHT = 1.25;
/** Approximate ascent (baseline offset from the top of the em box) as a fraction of the font size. */
const TEXT_ASCENT = 0.8;
const CURVE_SEGMENTS = 12;

/** Presentation properties that inherit from ancestors. */
interface InheritedStyle {
  fill: string;
  stroke: string;
  strokeWidth: string;
  strokeDasharray: string;
  fillOpacity: number;
  strokeOpacity: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  textAnchor: string;
  dominantBaseline: string;
  visibility: string;
}

const INITIAL_STYLE: InheritedStyle = {
  fill: '#000000',
  stroke: 'none',
  strokeWidth: '1',
  strokeDasharray: 'none',
  fillOpacity: 1,
  strokeOpacity: 1,
  fontSize: 16,
  fontFamily: 'sans-serif',
  fontWeight: 'normal',
  fontStyle: 'normal',
  textAnchor: 'start',
  dominantBaseline: 'auto',
  visibility: 'visible',
};

interface WalkContext {
  matrix: Matrix;
  style: InheritedStyle;
  /** Product of ancestor group opacities (0–1). */
  opacity: number;
  /** Ids of ancestor elements and expanded `<use>` targets (recursion guard). */
  refStack: readonly string[];
  /** Number of nested `<use>` expansions. */
  useDepth: number;
}

interface ImportState {
  ids: Map<string, XmlElement>;
  elements: SceneElement[];
  issues: Map<string, number>;
  maxElements: number;
  visited: number;
  stopped: boolean;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round3 = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
};

function addIssue(state: ImportState, message: string): void {
  state.issues.set(message, (state.issues.get(message) ?? 0) + 1);
}

/** Attribute values overridden by `style="…"` declarations (the sanitizer already cleaned both). */
function readProps(el: XmlElement): Map<string, string> {
  const props = new Map<string, string>();
  for (const attr of el.attrs) props.set(attr.name, attr.value.trim());
  const style = props.get('style');
  if (style) {
    for (const declaration of style.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      if (name && value) props.set(name, value);
    }
  }
  return props;
}

const FONT_SIZE_KEYWORDS: Record<string, number> = {
  'xx-small': 9,
  'x-small': 10,
  small: 13,
  medium: 16,
  large: 18,
  'x-large': 24,
  'xx-large': 32,
  'xxx-large': 48,
};

function parseFontSize(value: string, parent: number): number {
  const v = value.trim().toLowerCase();
  if (v in FONT_SIZE_KEYWORDS) return FONT_SIZE_KEYWORDS[v]!;
  if (v === 'larger') return parent * 1.2;
  if (v === 'smaller') return parent / 1.2;
  const pct = /^([-+]?(?:\d+\.?\d*|\.\d+))%$/.exec(v);
  if (pct) return (parent * Number(pct[1])) / 100;
  const len = parseSvgLength(v, parent);
  return len !== null && len > 0 ? len : parent;
}

function parseOpacity(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const v = value.trim();
  const n = v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v);
  return Number.isFinite(n) ? clamp(n, 0, 1) : fallback;
}

function inheritStyle(parent: InheritedStyle, props: Map<string, string>): InheritedStyle {
  const pick = (name: string, current: string) => {
    const v = props.get(name);
    return v === undefined || v === '' || v === 'inherit' ? current : v;
  };
  const fontSize = props.get('font-size');
  return {
    fill: pick('fill', parent.fill),
    stroke: pick('stroke', parent.stroke),
    strokeWidth: pick('stroke-width', parent.strokeWidth),
    strokeDasharray: pick('stroke-dasharray', parent.strokeDasharray),
    fillOpacity: parseOpacity(props.get('fill-opacity'), parent.fillOpacity),
    strokeOpacity: parseOpacity(props.get('stroke-opacity'), parent.strokeOpacity),
    fontSize:
      fontSize && fontSize !== 'inherit'
        ? parseFontSize(fontSize, parent.fontSize)
        : parent.fontSize,
    fontFamily: pick('font-family', parent.fontFamily),
    fontWeight: pick('font-weight', parent.fontWeight),
    fontStyle: pick('font-style', parent.fontStyle),
    textAnchor: pick('text-anchor', parent.textAnchor),
    dominantBaseline: pick('dominant-baseline', parent.dominantBaseline),
    visibility: pick('visibility', parent.visibility),
  };
}

/** Parses an SVG transform list into a single matrix (applied left to right). */
export function parseSvgTransform(value: string | undefined): Matrix {
  if (!value) return IDENTITY;
  let m: Matrix = IDENTITY;
  for (const match of value.matchAll(
    /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi,
  )) {
    const a = parseNumberList(match[2]!);
    let t: Matrix | null = null;
    switch (match[1]!.toLowerCase()) {
      case 'matrix':
        if (a.length === 6) t = [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!];
        break;
      case 'translate':
        if (a.length >= 1) t = [1, 0, 0, 1, a[0]!, a[1] ?? 0];
        break;
      case 'scale':
        if (a.length >= 1) t = [a[0]!, 0, 0, a[1] ?? a[0]!, 0, 0];
        break;
      case 'rotate':
        if (a.length >= 1) {
          const r = (a[0]! * Math.PI) / 180;
          const rot: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
          t =
            a.length >= 3
              ? multiply(translation(a[1]!, a[2]!), multiply(rot, translation(-a[1]!, -a[2]!)))
              : rot;
        }
        break;
      case 'skewx':
        if (a.length >= 1) t = [1, 0, Math.tan((a[0]! * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewy':
        if (a.length >= 1) t = [1, Math.tan((a[0]! * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    if (t && t.every((v) => Number.isFinite(v))) m = multiply(m, t);
  }
  return m;
}

/** Maps a viewBox onto a viewport of the given size honoring `preserveAspectRatio`. */
function viewBoxMatrix(
  vb: ViewBox,
  width: number,
  height: number,
  preserveAspectRatio: string | undefined,
): Matrix {
  const tokens = (preserveAspectRatio ?? '')
    .trim()
    .split(/\s+/)
    .filter((t) => t !== '' && t !== 'defer');
  const align = tokens[0] ?? 'xMidYMid';
  const slice = tokens[1] === 'slice';
  let sx = width / vb.width;
  let sy = height / vb.height;
  if (align !== 'none') {
    const s = slice ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = s;
    sy = s;
  }
  const fx = align.includes('xMid') ? 0.5 : align.includes('xMax') ? 1 : 0;
  const fy = align.includes('YMid') ? 0.5 : align.includes('YMax') ? 1 : 0;
  const tx = align === 'none' ? 0 : (width - vb.width * sx) * fx;
  const ty = align === 'none' ? 0 : (height - vb.height * sy) * fy;
  return [sx, 0, 0, sy, tx - vb.minX * sx, ty - vb.minY * sy];
}

/** Viewport transform of an `<svg>` element (root or nested). */
function svgViewportMatrix(
  el: XmlElement,
  fallbackSize: { width: number; height: number } | null,
): Matrix {
  const vb = parseViewBox(getAttribute(el, 'viewBox'));
  if (!vb) return IDENTITY;
  const w = parseSvgLength(getAttribute(el, 'width'));
  const h = parseSvgLength(getAttribute(el, 'height'));
  let width = w !== null && w > 0 ? w : null;
  let height = h !== null && h > 0 ? h : null;
  if (width === null && height === null && fallbackSize) {
    width = fallbackSize.width;
    height = fallbackSize.height;
  }
  if (width === null && height === null) return translation(-vb.minX, -vb.minY);
  if (width === null) width = (height! * vb.width) / vb.height;
  if (height === null) height = (width * vb.height) / vb.width;
  return viewBoxMatrix(vb, width, height, getAttribute(el, 'preserveAspectRatio'));
}

function stopColor(stop: XmlElement): string | null {
  const props = readProps(stop);
  const value = props.get('stop-color') ?? 'black';
  if (/^currentcolor$/i.test(value)) return CURRENT_COLOR;
  if (value === 'inherit' || value === 'none') return null;
  return COLOR_RE.test(value) ? value : null;
}

function gradientColor(
  el: XmlElement | undefined,
  ids: Map<string, XmlElement>,
  depth: number,
): string | null {
  if (!el || depth > 8 || (el.name !== 'linearGradient' && el.name !== 'radialGradient'))
    return null;
  const stop = elementChildren(el).find((c) => c.name === 'stop');
  if (stop) return stopColor(stop);
  const href = getAttribute(el, 'href') ?? getAttribute(el, 'xlink:href');
  return href?.startsWith('#') ? gradientColor(ids.get(href.slice(1)), ids, depth + 1) : null;
}

/** Resolves a paint value to a color string, or null for `none`. */
function resolvePaint(value: string, ids: Map<string, XmlElement>): string | null {
  const v = value.trim();
  if (v === '' || v === 'none' || v === 'transparent') return null;
  if (/^currentcolor$/i.test(v)) return CURRENT_COLOR;
  const url = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$/i.exec(v);
  if (url) {
    const color = gradientColor(ids.get(url[1]!), ids, 0);
    if (color) return color;
    const fallback = url[2]!.trim();
    if (fallback === 'none') return null;
    if (fallback && !fallback.toLowerCase().startsWith('url(')) return resolvePaint(fallback, ids);
    return FALLBACK_PAINT;
  }
  return COLOR_RE.test(v) ? v : CURRENT_COLOR;
}

type MatrixKind =
  { kind: 'axis' } | { kind: 'similar'; scale: number; angle: number } | { kind: 'general' };

function classifyMatrix(m: Matrix): MatrixKind {
  const eps = 1e-9 * Math.max(1, Math.abs(m[0]), Math.abs(m[1]), Math.abs(m[2]), Math.abs(m[3]));
  if (Math.abs(m[1]) <= eps && Math.abs(m[2]) <= eps) return { kind: 'axis' };
  if (Math.abs(m[0] - m[3]) <= eps && Math.abs(m[1] + m[2]) <= eps) {
    return { kind: 'similar', scale: Math.hypot(m[0], m[1]), angle: Math.atan2(m[1], m[0]) };
  }
  return { kind: 'general' };
}

/** Average linear scale factor of a matrix (used for stroke widths and font sizes). */
const matrixScale = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

interface Paint {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  /** Element opacity 0–100. */
  opacity: number;
}

function resolveShapePaint(
  style: InheritedStyle,
  opacity: number,
  matrix: Matrix,
  ids: Map<string, XmlElement>,
): Paint {
  const fill = resolvePaint(style.fill, ids);
  const stroke = resolvePaint(style.stroke, ids);
  const width = parseSvgLength(style.strokeWidth, style.fontSize);
  const dashes = style.strokeDasharray === 'none' ? [] : parseNumberList(style.strokeDasharray);
  const channel = Math.max(fill ? style.fillOpacity : 0, stroke ? style.strokeOpacity : 0);
  return {
    fill,
    stroke,
    strokeWidth: round3(
      clamp((width !== null && width >= 0 ? width : 1) * matrixScale(matrix), 0, 200),
    ),
    strokeStyle: dashes.some((d) => d > 0) ? 'dashed' : 'solid',
    opacity: round3(clamp(opacity * channel * 100, 0, 100)),
  };
}

function baseProps(paint: Paint) {
  return {
    strokeColor: paint.stroke ?? 'transparent',
    backgroundColor: paint.fill ?? 'transparent',
    strokeWidth: paint.strokeWidth,
    strokeStyle: paint.strokeStyle,
    fillStyle: 'solid' as const,
    roughness: 0,
    opacity: paint.opacity,
  };
}

function emit(state: ImportState, el: SceneElement): void {
  if (state.stopped) return;
  if (state.elements.length >= state.maxElements) {
    state.stopped = true;
    addIssue(
      state,
      `The SVG has more than ${state.maxElements} shapes; only the first ${state.maxElements} were imported`,
    );
    return;
  }
  state.elements.push(el);
}

/** Creates a line element from world-space points. */
function emitPolyline(
  state: ImportState,
  worldPoints: readonly Point[],
  closed: boolean,
  paint: Paint,
): void {
  const pts: Point[] = [];
  for (const p of worldPoints) {
    const q = { x: round3(p.x), y: round3(p.y) };
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return;
    const last = pts[pts.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) pts.push(q);
  }
  if (closed && pts.length > 2) {
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    if (first.x === last.x && first.y === last.y) pts.pop();
  }
  if (pts.length < 2) return;
  let sampled = pts;
  if (pts.length > MAX_POINTS) {
    const step = Math.ceil(pts.length / (MAX_POINTS - 1));
    sampled = pts.filter((_, i) => i % step === 0);
    sampled.push(pts[pts.length - 1]!);
    addIssue(state, `A path had more than ${MAX_POINTS} points and was simplified`);
  }
  const local: LocalPoint[] = sampled.map((p) => [p.x, p.y]);
  const box = normalizeLinearPoints(0, 0, local);
  const isClosed = closed && sampled.length > 2;
  emit(
    state,
    createElement('line', {
      ...baseProps(paint),
      ...box,
      x: round3(box.x),
      y: round3(box.y),
      width: round3(box.width),
      height: round3(box.height),
      points: box.points.map((p): LocalPoint => [round3(p[0]), round3(p[1])]),
      backgroundColor: isClosed && paint.fill ? paint.fill : 'transparent',
      closed: isClosed,
    }),
  );
}

/** Emits a rectangle or ellipse, falling back to a polygon for skewed/non-uniform rotations. */
function emitBox(
  state: ImportState,
  type: 'rectangle' | 'ellipse',
  box: { x: number; y: number; width: number; height: number },
  radius: number,
  matrix: Matrix,
  paint: Paint,
): void {
  const kind = classifyMatrix(matrix);
  const props = {
    ...baseProps(paint),
    roundness: type === 'rectangle' && radius > 0 ? ('round' as const) : ('sharp' as const),
  };
  if (kind.kind === 'axis') {
    const p1 = applyMatrix(matrix, { x: box.x, y: box.y });
    const p2 = applyMatrix(matrix, { x: box.x + box.width, y: box.y + box.height });
    emit(
      state,
      createElement(type, {
        ...props,
        x: round3(Math.min(p1.x, p2.x)),
        y: round3(Math.min(p1.y, p2.y)),
        width: round3(Math.abs(p2.x - p1.x)),
        height: round3(Math.abs(p2.y - p1.y)),
      }),
    );
    return;
  }
  if (kind.kind === 'similar') {
    const c = applyMatrix(matrix, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    const w = box.width * kind.scale;
    const h = box.height * kind.scale;
    emit(
      state,
      createElement(type, {
        ...props,
        x: round3(c.x - w / 2),
        y: round3(c.y - h / 2),
        width: round3(w),
        height: round3(h),
        angle: kind.angle,
      }),
    );
    return;
  }
  const path =
    type === 'ellipse'
      ? ellipsePath(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2)
      : roundedRectPath(box.x, box.y, box.width, box.height, radius);
  for (const sub of flattenPath(path, CURVE_SEGMENTS)) {
    emitPolyline(
      state,
      sub.points.map((p) => applyMatrix(matrix, p)),
      true,
      paint,
    );
  }
}

const len = (props: Map<string, string>, name: string, fontSize: number): number | null =>
  parseSvgLength(props.get(name), fontSize);

function pointList(value: string | undefined): Point[] {
  const nums = parseNumberList(value ?? '');
  const out: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i]!, y: nums[i + 1]! });
  return out;
}

function importShape(
  state: ImportState,
  el: XmlElement,
  props: Map<string, string>,
  ctx: WalkContext,
): void {
  const { style, matrix } = ctx;
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return;
  const paint = resolveShapePaint(style, ctx.opacity, matrix, state.ids);
  const fs = style.fontSize;
  const hasPaint = paint.fill !== null || paint.stroke !== null;
  switch (el.name) {
    case 'rect': {
      const width = len(props, 'width', fs) ?? 0;
      const height = len(props, 'height', fs) ?? 0;
      if (!(width > 0) || !(height > 0) || !hasPaint) return;
      const rx = len(props, 'rx', fs);
      const ry = len(props, 'ry', fs);
      const radius = Math.max(0, Math.min(rx ?? ry ?? 0, ry ?? rx ?? 0));
      const box = { x: len(props, 'x', fs) ?? 0, y: len(props, 'y', fs) ?? 0, width, height };
      emitBox(state, 'rectangle', box, radius, matrix, paint);
      return;
    }
    case 'circle':
    case 'ellipse': {
      const cx = len(props, 'cx', fs) ?? 0;
      const cy = len(props, 'cy', fs) ?? 0;
      let rx: number | null;
      let ry: number | null;
      if (el.name === 'circle') {
        rx = ry = len(props, 'r', fs);
      } else {
        rx = len(props, 'rx', fs);
        ry = len(props, 'ry', fs);
        rx ??= ry;
        ry ??= rx;
      }
      if (rx === null || ry === null || !(rx > 0) || !(ry > 0) || !hasPaint) return;
      emitBox(
        state,
        'ellipse',
        { x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry },
        0,
        matrix,
        paint,
      );
      return;
    }
    case 'line': {
      if (!paint.stroke) return;
      const a = { x: len(props, 'x1', fs) ?? 0, y: len(props, 'y1', fs) ?? 0 };
      const b = { x: len(props, 'x2', fs) ?? 0, y: len(props, 'y2', fs) ?? 0 };
      emitPolyline(state, [applyMatrix(matrix, a), applyMatrix(matrix, b)], false, {
        ...paint,
        fill: null,
      });
      return;
    }
    case 'polyline':
    case 'polygon': {
      if (!hasPaint) return;
      const pts = pointList(props.get('points'));
      const closed =
        el.name === 'polygon' || (paint.fill !== null && paint.stroke === null && pts.length > 2);
      emitPolyline(
        state,
        pts.map((p) => applyMatrix(matrix, p)),
        closed,
        paint,
      );
      return;
    }
    case 'path': {
      const d = props.get('d');
      if (!d || !hasPaint) return;
      let subpaths: { points: Point[]; closed: boolean }[];
      try {
        subpaths = flattenPath(parseSvgPath(d), CURVE_SEGMENTS);
      } catch {
        addIssue(state, 'A path with malformed data was skipped');
        return;
      }
      for (const sub of subpaths) {
        if (state.stopped) return;
        // SVG fills open subpaths as if they were closed.
        const closed =
          sub.closed || (paint.fill !== null && paint.stroke === null && sub.points.length > 2);
        emitPolyline(
          state,
          sub.points.map((p) => applyMatrix(matrix, p)),
          closed,
          paint,
        );
      }
      return;
    }
  }
}

function mapFontFamily(value: string): FontFamily {
  for (const raw of value.split(',')) {
    const f = raw
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .toLowerCase();
    if (/mono|courier|consolas|menlo|monaco|cascadia/.test(f)) return 'mono';
    if (/cursive|comic|virgil|kalam|excalifont|hand|script|fantasy/.test(f)) return 'hand';
    if (/sans|arial|helvetica|inter|verdana|segoe|roboto|system-ui|tahoma|nunito/.test(f))
      return 'sans';
    if (/serif|times|georgia|garamond|lora|cambria|palatino/.test(f)) return 'serif';
  }
  return 'sans';
}

const mapFontWeight = (v: string): FontWeight =>
  /^(bold|bolder)$/i.test(v) || Number(v) >= 600 ? 'bold' : 'normal';
const mapFontStyle = (v: string): FontStyle => (/^(italic|oblique)/i.test(v) ? 'italic' : 'normal');
const mapTextAnchor = (v: string): TextAlign =>
  v === 'middle' ? 'center' : v === 'end' ? 'right' : 'left';

interface TextRun {
  x: number;
  y: number;
  text: string;
  style: InheritedStyle;
}

function firstLength(props: Map<string, string>, name: string, fontSize: number): number | null {
  const raw = props.get(name);
  if (raw === undefined) return null;
  const first = raw.trim().split(/[\s,]+/)[0];
  return first === undefined ? null : parseSvgLength(first, fontSize);
}

function measureRun(text: string, style: InheritedStyle): number {
  if (text === '') return 0;
  return measureTextElement({
    ...DEFAULT_TEXT_STYLE,
    fontFamily: mapFontFamily(style.fontFamily),
    fontSize: clamp(style.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE),
    fontWeight: mapFontWeight(style.fontWeight),
    fontStyle: mapFontStyle(style.fontStyle),
    text,
    autoResize: true,
    width: 0,
  }).width;
}

/** Splits a `<text>` element into positioned runs; unpositioned `<tspan>`s continue the current run. */
function collectTextRuns(
  textEl: XmlElement,
  props: Map<string, string>,
  style: InheritedStyle,
): TextRun[] {
  const runs: TextRun[] = [];
  let pen = {
    x:
      (firstLength(props, 'x', style.fontSize) ?? 0) +
      (firstLength(props, 'dx', style.fontSize) ?? 0),
    y:
      (firstLength(props, 'y', style.fontSize) ?? 0) +
      (firstLength(props, 'dy', style.fontSize) ?? 0),
  };
  let current: TextRun | null = null;
  const visit = (node: XmlElement, nodeStyle: InheritedStyle, depth: number) => {
    for (const child of node.children) {
      if (child.kind === 'text') {
        if (!current) {
          current = { x: pen.x, y: pen.y, text: '', style: nodeStyle };
          runs.push(current);
        }
        current.text += child.value;
        continue;
      }
      if (child.name !== 'tspan' || depth > 16) continue;
      const childProps = readProps(child);
      if (childProps.get('display') === 'none') continue;
      const childStyle = inheritStyle(nodeStyle, childProps);
      const x = firstLength(childProps, 'x', childStyle.fontSize);
      const y = firstLength(childProps, 'y', childStyle.fontSize);
      const dx = firstLength(childProps, 'dx', childStyle.fontSize) ?? 0;
      const dy = firstLength(childProps, 'dy', childStyle.fontSize) ?? 0;
      if (x !== null || y !== null || dx !== 0 || dy !== 0) {
        const run: TextRun | null = current;
        const advanced = run ? run.x + measureRun(collapseWhitespace(run.text), run.style) : pen.x;
        pen = { x: (x ?? advanced) + dx, y: (y ?? (run ? run.y : pen.y)) + dy };
        current = { x: pen.x, y: pen.y, text: '', style: childStyle };
        runs.push(current);
      }
      visit(child, childStyle, depth + 1);
    }
  };
  visit(textEl, style, 0);
  return runs;
}

function collapseWhitespace(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function importText(
  state: ImportState,
  el: XmlElement,
  props: Map<string, string>,
  ctx: WalkContext,
): void {
  const kind = classifyMatrix(ctx.matrix);
  const angle =
    kind.kind === 'similar'
      ? kind.angle
      : kind.kind === 'general'
        ? Math.atan2(ctx.matrix[1], ctx.matrix[0])
        : 0;
  const scale = matrixScale(ctx.matrix);
  for (const run of collectTextRuns(el, props, ctx.style)) {
    if (state.stopped) return;
    const style = run.style;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') continue;
    let text = collapseWhitespace(run.text);
    if (text === '') continue;
    if (text.length > MAX_TEXT_LENGTH) text = text.slice(0, MAX_TEXT_LENGTH);
    const fill = resolvePaint(style.fill, state.ids);
    const stroke = resolvePaint(style.stroke, state.ids);
    const color = fill ?? stroke;
    if (!color) continue;
    const channel = fill ? style.fillOpacity : style.strokeOpacity;
    const fontSize = round3(clamp(style.fontSize * scale, MIN_FONT_SIZE, MAX_FONT_SIZE));
    const textStyle = {
      ...DEFAULT_TEXT_STYLE,
      fontFamily: mapFontFamily(style.fontFamily),
      fontSize,
      fontWeight: mapFontWeight(style.fontWeight),
      fontStyle: mapFontStyle(style.fontStyle),
      textAlign: mapTextAnchor(style.textAnchor),
      verticalAlign: 'top' as const,
      lineHeight: TEXT_LINE_HEIGHT,
      letterSpacing: 0,
    };
    const size = measureTextElement({ ...textStyle, text, autoResize: true, width: 0 });
    const anchor = applyMatrix(ctx.matrix, { x: run.x, y: run.y });
    const alignFactor =
      textStyle.textAlign === 'center' ? 0.5 : textStyle.textAlign === 'right' ? 1 : 0;
    const halfLeading = ((TEXT_LINE_HEIGHT - 1) / 2) * fontSize;
    const baseline = style.dominantBaseline;
    const top =
      baseline === 'middle' || baseline === 'central'
        ? -size.height / 2
        : baseline === 'hanging' || baseline === 'text-before-edge'
          ? -halfLeading
          : -(TEXT_ASCENT * fontSize + halfLeading);
    // Center of the text box relative to the anchor, in the (rotated) text frame.
    const ox = -size.width * alignFactor + size.width / 2;
    const oy = top + size.height / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const cx = anchor.x + ox * cos - oy * sin;
    const cy = anchor.y + ox * sin + oy * cos;
    emit(
      state,
      createElement('text', {
        ...textStyle,
        text,
        autoResize: true,
        x: round3(cx - size.width / 2),
        y: round3(cy - size.height / 2),
        width: size.width,
        height: size.height,
        angle,
        strokeColor: color,
        backgroundColor: 'transparent',
        strokeWidth: 1,
        fillStyle: 'solid',
        roughness: 0,
        opacity: round3(clamp(ctx.opacity * channel * 100, 0, 100)),
      }),
    );
  }
}

const NON_RENDERING = new Set([
  'defs',
  'symbol',
  'clipPath',
  'mask',
  'linearGradient',
  'radialGradient',
  'pattern',
  'marker',
  'title',
  'desc',
  'stop',
  'tspan',
]);

function walkChildren(state: ImportState, el: XmlElement, ctx: WalkContext): void {
  for (const child of elementChildren(el)) {
    if (state.stopped) return;
    walk(state, child, ctx);
  }
}

function walk(state: ImportState, el: XmlElement, parent: WalkContext): void {
  if (state.stopped) return;
  if (++state.visited > MAX_SVG_VISITED_NODES) {
    state.stopped = true;
    addIssue(state, 'The SVG is too complex; the import stopped early');
    return;
  }
  const tag = el.name;
  if (NON_RENDERING.has(tag)) return;
  const props = readProps(el);
  if (props.get('display') === 'none') return;
  const id = getAttribute(el, 'id');
  const ctx: WalkContext = {
    matrix: multiply(parent.matrix, parseSvgTransform(getAttribute(el, 'transform'))),
    style: inheritStyle(parent.style, props),
    opacity: parent.opacity * parseOpacity(props.get('opacity'), 1),
    refStack: id ? [...parent.refStack, id] : parent.refStack,
    useDepth: parent.useDepth,
  };
  switch (tag) {
    case 'g':
      walkChildren(state, el, ctx);
      return;
    case 'svg': {
      const x = len(props, 'x', ctx.style.fontSize) ?? 0;
      const y = len(props, 'y', ctx.style.fontSize) ?? 0;
      const matrix = multiply(ctx.matrix, multiply(translation(x, y), svgViewportMatrix(el, null)));
      walkChildren(state, el, { ...ctx, matrix });
      return;
    }
    case 'use':
      expandUse(state, el, props, ctx);
      return;
    case 'rect':
    case 'circle':
    case 'ellipse':
    case 'line':
    case 'polyline':
    case 'polygon':
    case 'path':
      importShape(state, el, props, ctx);
      return;
    case 'text':
      importText(state, el, props, ctx);
      return;
    case 'image':
      addIssue(state, 'Embedded bitmap images inside the SVG were not imported');
      return;
    default:
      addIssue(state, `Unsupported SVG element <${tag}> was skipped`);
  }
}

function expandUse(
  state: ImportState,
  el: XmlElement,
  props: Map<string, string>,
  ctx: WalkContext,
): void {
  const href = getAttribute(el, 'href') ?? getAttribute(el, 'xlink:href') ?? '';
  const id = href.startsWith('#') ? href.slice(1) : '';
  const target = id ? state.ids.get(id) : undefined;
  if (!target) {
    addIssue(state, 'A <use> element referenced a missing element and was skipped');
    return;
  }
  if (ctx.refStack.includes(id) || ctx.useDepth >= MAX_SVG_USE_DEPTH) {
    addIssue(state, 'A recursive or too deeply nested <use> reference was skipped');
    return;
  }
  const fs = ctx.style.fontSize;
  const offset = translation(len(props, 'x', fs) ?? 0, len(props, 'y', fs) ?? 0);
  const refStack = [...ctx.refStack, id];
  const useDepth = ctx.useDepth + 1;
  if (target.name === 'symbol') {
    const symbolProps = readProps(target);
    if (symbolProps.get('display') === 'none') return;
    const w = len(props, 'width', fs) ?? len(symbolProps, 'width', fs);
    const h = len(props, 'height', fs) ?? len(symbolProps, 'height', fs);
    const vb = parseViewBox(getAttribute(target, 'viewBox'));
    const viewport =
      vb && w !== null && h !== null && w > 0 && h > 0
        ? viewBoxMatrix(vb, w, h, getAttribute(target, 'preserveAspectRatio'))
        : IDENTITY;
    const symbolCtx: WalkContext = {
      matrix: multiply(ctx.matrix, multiply(offset, viewport)),
      style: inheritStyle(ctx.style, symbolProps),
      opacity: ctx.opacity * parseOpacity(symbolProps.get('opacity'), 1),
      refStack,
      useDepth,
    };
    walkChildren(state, target, symbolCtx);
    return;
  }
  if (NON_RENDERING.has(target.name)) return;
  walk(state, target, { ...ctx, matrix: multiply(ctx.matrix, offset), refStack, useDepth });
}

function collectIds(root: XmlElement): Map<string, XmlElement> {
  const ids = new Map<string, XmlElement>();
  const stack: XmlElement[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    const id = getAttribute(el, 'id');
    if (id && !ids.has(id)) ids.set(id, el);
    const children = elementChildren(el);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
  return ids;
}

/**
 * Converts SVG markup into native elements (all grouped together when there is more than one).
 * Unsupported content is skipped and reported in `issues`.
 */
export function importSvgAsElements(
  svgText: string,
  options: SvgImportOptions = {},
): SvgImportResult {
  const root = parseSanitizedSvg(svgText);
  const maxElements = Math.max(0, Math.floor(options.maxElements ?? DEFAULT_SVG_MAX_ELEMENTS));
  const state: ImportState = {
    ids: collectIds(root),
    elements: [],
    issues: new Map(),
    maxElements,
    visited: 0,
    stopped: false,
  };
  const rootProps = readProps(root);
  const rootStyle = inheritStyle(INITIAL_STYLE, rootProps);
  const rootCtx: WalkContext = {
    matrix: multiply(
      parseSvgTransform(getAttribute(root, 'transform')),
      svgViewportMatrix(root, null),
    ),
    style: rootStyle,
    opacity: parseOpacity(rootProps.get('opacity'), 1),
    refStack: [],
    useDepth: 0,
  };
  if (rootProps.get('display') !== 'none') walkChildren(state, root, rootCtx);

  const issues: string[] = [];
  const valid: SceneElement[] = [];
  for (const el of state.elements) {
    const result = validateElement(el);
    if (result.success) valid.push(result.element);
    else issues.push(`An imported shape was dropped because it is invalid (${result.error})`);
  }
  const keys = generateNKeysBetween(null, null, valid.length);
  const groupId = valid.length > 1 ? generateId() : null;
  const elements = valid.map((el, i) => ({
    ...el,
    index: keys[i]!,
    groupIds: groupId ? [groupId] : [],
  }));
  for (const [message, count] of state.issues)
    issues.push(count > 1 ? `${message} (${count} times)` : message);
  if (elements.length === 0 && issues.length === 0)
    issues.push('The SVG contains no shapes that can be imported');
  return { elements, issues };
}
