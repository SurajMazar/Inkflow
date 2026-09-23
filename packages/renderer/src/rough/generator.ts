import {
  SeededRandom,
  ellipsePath,
  flattenPath,
  type Path,
  type PathCommand,
  type Point,
} from '@inkflow/geometry';
import { hachureLines, zigzagLines, type Line } from './fill';
import { deriveSeed, resolveRoughOptions, type DrawOpSet, type ResolvedRoughOptions, type RoughOptions } from './types';

/** Random offsets scaled by roughness (the core of the hand-drawn look). */
class Jitter {
  constructor(
    readonly rng: SeededRandom,
    readonly o: ResolvedRoughOptions,
  ) {}

  next(): number {
    return this.rng.next();
  }

  /** Value in [min, max) scaled by roughness and gain. */
  offset(min: number, max: number, gain = 1): number {
    return this.o.roughness * gain * (this.rng.next() * (max - min) + min);
  }

  /** Value in [-x, x) scaled by roughness and gain. */
  offsetOpt(x: number, gain = 1): number {
    return this.offset(-x, x, gain);
  }
}

const M = (x: number, y: number): PathCommand => ({ type: 'M', x, y });
const L = (x: number, y: number): PathCommand => ({ type: 'L', x, y });
const C = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): PathCommand => ({
  type: 'C',
  x1,
  y1,
  x2,
  y2,
  x,
  y,
});

/** One sketchy pass of a straight line as a bowed cubic. */
function lineOps(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  j: Jitter,
  overlay: boolean,
  preserve: boolean,
  out: PathCommand[],
): void {
  const o = j.o;
  const lengthSq = (x1 - x2) ** 2 + (y1 - y2) ** 2;
  const length = Math.sqrt(lengthSq);
  let gain = 1;
  if (length >= 200) gain = length > 500 ? 0.4 : -0.0016668 * length + 1.233334;
  let offset = o.maxRandomnessOffset;
  if (offset * offset * 100 > lengthSq) offset = length / 10;
  const half = offset / 2;
  const diverge = 0.2 + j.next() * 0.2;
  let midX = (o.bowing * o.maxRandomnessOffset * (y2 - y1)) / 200;
  let midY = (o.bowing * o.maxRandomnessOffset * (x1 - x2)) / 200;
  midX = j.offsetOpt(midX, gain);
  midY = j.offsetOpt(midY, gain);
  const r = (): number => j.offsetOpt(overlay ? half : offset, gain);
  const sx = preserve ? x1 : x1 + r();
  const sy = preserve ? y1 : y1 + r();
  out.push(M(sx, sy));
  const c1x = midX + x1 + (x2 - x1) * diverge + r();
  const c1y = midY + y1 + (y2 - y1) * diverge + r();
  const c2x = midX + x1 + 2 * (x2 - x1) * diverge + r();
  const c2y = midY + y1 + 2 * (y2 - y1) * diverge + r();
  const ex = preserve ? x2 : x2 + r();
  const ey = preserve ? y2 : y2 + r();
  out.push(C(c1x, c1y, c2x, c2y, ex, ey));
}

function doubleLineOps(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  j: Jitter,
  out: PathCommand[],
  preserve = j.o.preserveVertices,
  multi = !j.o.disableMultiStroke,
): void {
  lineOps(x1, y1, x2, y2, j, false, preserve, out);
  if (multi) lineOps(x1, y1, x2, y2, j, true, preserve, out);
}

/** Sketchy cubic segment (two passes unless disabled). */
function bezierOps(
  from: Point,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x: number,
  y: number,
  j: Jitter,
  out: PathCommand[],
): void {
  const o = j.o;
  // Scale the jitter for tiny curves (rounded corners) so they don't turn into blobs.
  const chord = Math.hypot(x - from.x, y - from.y) + Math.hypot(x1 - from.x, y1 - from.y) * 0.5;
  const scale = Math.max(0.25, Math.min(1, chord / 40));
  const base = (o.maxRandomnessOffset || 1) * scale;
  const ros = [base, base + 0.3 * scale];
  const iterations = o.disableMultiStroke ? 1 : 2;
  for (let i = 0; i < iterations; i++) {
    const ro = ros[i]!;
    if (i === 0) out.push(M(from.x, from.y));
    else out.push(M(from.x + j.offsetOpt(ros[0]!), from.y + j.offsetOpt(ros[0]!)));
    const c1x = x1 + j.offsetOpt(ro);
    const c1y = y1 + j.offsetOpt(ro);
    const c2x = x2 + j.offsetOpt(ro);
    const c2y = y2 + j.offsetOpt(ro);
    const ex = o.preserveVertices ? x : x + j.offsetOpt(ro);
    const ey = o.preserveVertices ? y : y + j.offsetOpt(ro);
    out.push(C(c1x, c1y, c2x, c2y, ex, ey));
  }
}

/** Sketchy outline of an arbitrary path (every straight/cubic segment drawn with jitter). */
function roughStroke(path: Path, j: Jitter): PathCommand[] {
  const out: PathCommand[] = [];
  let cursor: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  for (const c of path) {
    switch (c.type) {
      case 'M':
        cursor = { x: c.x, y: c.y };
        start = cursor;
        break;
      case 'L':
        if (c.x !== cursor.x || c.y !== cursor.y) doubleLineOps(cursor.x, cursor.y, c.x, c.y, j, out);
        cursor = { x: c.x, y: c.y };
        break;
      case 'C':
        bezierOps(cursor, c.x1, c.y1, c.x2, c.y2, c.x, c.y, j, out);
        cursor = { x: c.x, y: c.y };
        break;
      case 'Z':
        if (Math.hypot(cursor.x - start.x, cursor.y - start.y) > 1e-6) {
          doubleLineOps(cursor.x, cursor.y, start.x, start.y, j, out);
        }
        cursor = start;
        break;
    }
  }
  return out;
}

/** A single-pass jittered copy of a (closed) path used for solid fills. */
function jitteredFillPath(path: Path, j: Jitter): PathCommand[] {
  const out: PathCommand[] = [];
  const amount = j.o.maxRandomnessOffset * 0.5;
  const jit = (p: number) => p + j.offsetOpt(amount);
  let start: Point | null = null;
  for (const c of path) {
    switch (c.type) {
      case 'M': {
        if (start) out.push({ type: 'Z' });
        const p = { x: jit(c.x), y: jit(c.y) };
        start = p;
        out.push(M(p.x, p.y));
        break;
      }
      case 'L':
        out.push(L(jit(c.x), jit(c.y)));
        break;
      case 'C':
        out.push(C(jit(c.x1), jit(c.y1), jit(c.x2), jit(c.y2), jit(c.x), jit(c.y)));
        break;
      case 'Z':
        if (start) out.push({ type: 'Z' });
        start = null;
        break;
    }
  }
  if (start) out.push({ type: 'Z' });
  return out;
}

/** Closes every subpath of a path (fills always treat outlines as closed). */
function closedCopy(path: Path): PathCommand[] {
  const out: PathCommand[] = [];
  let open = false;
  for (const c of path) {
    if (c.type === 'M') {
      if (open) out.push({ type: 'Z' });
      open = true;
    }
    if (c.type === 'Z') {
      if (!open) continue;
      open = false;
    }
    out.push(c);
  }
  if (open) out.push({ type: 'Z' });
  return out;
}

function sketchLinesOps(lines: readonly Line[], j: Jitter, double: boolean): PathCommand[] {
  const out: PathCommand[] = [];
  for (const [a, b] of lines) {
    if (j.o.roughness === 0) {
      out.push(M(a.x, a.y), L(b.x, b.y));
      continue;
    }
    // Endpoints stay on the outline so the fill never leaks outside the shape.
    lineOps(a.x, a.y, b.x, b.y, j, false, true, out);
    if (double) lineOps(a.x, a.y, b.x, b.y, j, true, true, out);
  }
  return out;
}

/** Hachure / cross-hatch / zigzag lines of polygon rings, clipped to the outline incl. holes. */
function sketchFill(polygons: readonly (readonly Point[])[], o: ResolvedRoughOptions, j: Jitter): DrawOpSet {
  const gap = o.hachureGap;
  const angle = o.hachureAngle;
  let lines: Line[];
  let double = true;
  switch (o.fillStyle) {
    case 'cross-hatch':
      lines = [...hachureLines(polygons, gap, angle), ...hachureLines(polygons, gap, angle + 90)];
      double = false;
      break;
    case 'zigzag':
      lines = zigzagLines(polygons, gap, angle);
      double = false;
      break;
    default:
      lines = hachureLines(polygons, gap, angle);
      break;
  }
  return { type: 'fillSketch', path: sketchLinesOps(lines, j, double) };
}

function fillSets(path: Path, o: ResolvedRoughOptions): DrawOpSet {
  const j = new Jitter(new SeededRandom(deriveSeed(o.seed, 101)), o);
  if (o.fillStyle === 'solid') {
    return { type: 'fill', path: o.roughness === 0 ? closedCopy(path) : jitteredFillPath(path, j) };
  }
  const rings = flattenPath(path, 12).map((s) => s.points);
  return sketchFill(rings, o, j);
}

/**
 * Hand-drawn rendering of an arbitrary path: an optional fill set ('fill' for solid, 'fillSketch'
 * for hachure/cross-hatch/zigzag, clipped to the outline incl. holes) followed by the stroke set.
 * roughness 0 returns the exact geometry.
 */
export function roughPath(path: Path, options: RoughOptions, fill: boolean): DrawOpSet[] {
  const o = resolveRoughOptions(options);
  const sets: DrawOpSet[] = [];
  if (fill) sets.push(fillSets(path, o));
  if (o.roughness === 0) {
    sets.push({ type: 'stroke', path: path.map((c) => ({ ...c })) });
  } else {
    const j = new Jitter(new SeededRandom(o.seed), o);
    sets.push({ type: 'stroke', path: roughStroke(path, j) });
  }
  return sets;
}

/** Hand-drawn straight line (double stroke jitter). */
export function roughLine(x1: number, y1: number, x2: number, y2: number, options: RoughOptions): DrawOpSet {
  const o = resolveRoughOptions(options);
  if (o.roughness === 0) return { type: 'stroke', path: [M(x1, y1), L(x2, y2)] };
  const j = new Jitter(new SeededRandom(o.seed), o);
  const out: PathCommand[] = [];
  doubleLineOps(x1, y1, x2, y2, j, out);
  return { type: 'stroke', path: out };
}

/** Rough.js-style curve through points (Catmull-Rom → cubic). */
function curveOps(points: readonly Point[], closePoint: Point | null, j: Jitter, out: PathCommand[]): void {
  const len = points.length;
  if (len > 3) {
    const s = 1 - j.o.curveTightness;
    out.push(M(points[1]!.x, points[1]!.y));
    for (let i = 1; i + 2 < len; i++) {
      const p = points[i]!;
      const prev = points[i - 1]!;
      const next = points[i + 1]!;
      const next2 = points[i + 2]!;
      out.push(
        C(
          p.x + (s * next.x - s * prev.x) / 6,
          p.y + (s * next.y - s * prev.y) / 6,
          next.x + (s * p.x - s * next2.x) / 6,
          next.y + (s * p.y - s * next2.y) / 6,
          next.x,
          next.y,
        ),
      );
    }
    if (closePoint) {
      const ro = j.o.maxRandomnessOffset;
      out.push(L(closePoint.x + j.offsetOpt(ro), closePoint.y + j.offsetOpt(ro)));
    }
  } else if (len === 3) {
    out.push(M(points[1]!.x, points[1]!.y));
    out.push(C(points[1]!.x, points[1]!.y, points[2]!.x, points[2]!.y, points[2]!.x, points[2]!.y));
  } else if (len === 2) {
    doubleLineOps(points[0]!.x, points[0]!.y, points[1]!.x, points[1]!.y, j, out);
  }
}

interface EllipseParams {
  rx: number;
  ry: number;
  increment: number;
}

function ellipseParams(width: number, height: number, j: Jitter): EllipseParams {
  const o = j.o;
  const psq = Math.sqrt(Math.PI * 2 * Math.sqrt(((width / 2) ** 2 + (height / 2) ** 2) / 2));
  const stepCount = Math.ceil(Math.max(o.curveStepCount, (o.curveStepCount / Math.sqrt(200)) * psq));
  const increment = (Math.PI * 2) / stepCount;
  let rx = Math.abs(width / 2);
  let ry = Math.abs(height / 2);
  const fit = 1 - o.curveFitting;
  rx += j.offsetOpt(rx * fit);
  ry += j.offsetOpt(ry * fit);
  return { rx, ry, increment };
}

function ellipsePoints(
  increment: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  offset: number,
  overlap: number,
  j: Jitter,
): { all: Point[]; core: Point[] } {
  const all: Point[] = [];
  const core: Point[] = [];
  const radOffset = j.offsetOpt(0.5) - Math.PI / 2;
  all.push({
    x: j.offsetOpt(offset) + cx + 0.9 * rx * Math.cos(radOffset - increment),
    y: j.offsetOpt(offset) + cy + 0.9 * ry * Math.sin(radOffset - increment),
  });
  const end = Math.PI * 2 + radOffset - 0.01;
  for (let angle = radOffset; angle < end; angle += increment) {
    const p = {
      x: j.offsetOpt(offset) + cx + rx * Math.cos(angle),
      y: j.offsetOpt(offset) + cy + ry * Math.sin(angle),
    };
    core.push(p);
    all.push(p);
  }
  all.push({
    x: j.offsetOpt(offset) + cx + rx * Math.cos(radOffset + Math.PI * 2 + overlap * 0.5),
    y: j.offsetOpt(offset) + cy + ry * Math.sin(radOffset + Math.PI * 2 + overlap * 0.5),
  });
  all.push({
    x: j.offsetOpt(offset) + cx + 0.98 * rx * Math.cos(radOffset + overlap),
    y: j.offsetOpt(offset) + cy + 0.98 * ry * Math.sin(radOffset + overlap),
  });
  all.push({
    x: j.offsetOpt(offset) + cx + 0.9 * rx * Math.cos(radOffset + overlap * 0.5),
    y: j.offsetOpt(offset) + cy + 0.9 * ry * Math.sin(radOffset + overlap * 0.5),
  });
  return { all, core };
}

/** Closed smooth path through points (used for jittered ellipse fills). */
function closedCurvePath(points: readonly Point[]): PathCommand[] {
  const n = points.length;
  if (n < 3) return [];
  const out: PathCommand[] = [M(points[0]!.x, points[0]!.y)];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    const p3 = points[(i + 2) % n]!;
    out.push(
      C(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y),
    );
  }
  out.push({ type: 'Z' });
  return out;
}

/** Hand-drawn ellipse centered at (cx, cy). roughness 0 returns the exact ellipse. */
export function roughEllipse(
  cx: number,
  cy: number,
  width: number,
  height: number,
  options: RoughOptions,
  fill: boolean,
): DrawOpSet[] {
  const o = resolveRoughOptions(options);
  const rx = Math.abs(width) / 2;
  const ry = Math.abs(height) / 2;
  if (o.roughness === 0) {
    const exact = ellipsePath(cx, cy, rx, ry);
    const sets: DrawOpSet[] = [];
    if (fill) sets.push(fillSets(exact, o));
    sets.push({ type: 'stroke', path: exact });
    return sets;
  }
  const j = new Jitter(new SeededRandom(o.seed), o);
  const params = ellipseParams(width, height, j);
  const first = ellipsePoints(
    params.increment,
    cx,
    cy,
    params.rx,
    params.ry,
    1,
    params.increment * j.offset(0.1, j.offset(0.4, 1)),
    j,
  );
  const stroke: PathCommand[] = [];
  curveOps(first.all, null, j, stroke);
  if (!o.disableMultiStroke) {
    const second = ellipsePoints(params.increment, cx, cy, params.rx, params.ry, 1.5, 0, j);
    curveOps(second.all, null, j, stroke);
  }
  const sets: DrawOpSet[] = [];
  if (fill) {
    const fj = new Jitter(new SeededRandom(deriveSeed(o.seed, 101)), o);
    if (o.fillStyle === 'solid') {
      sets.push({ type: 'fill', path: closedCurvePath(first.core) });
    } else {
      sets.push(sketchFill([first.core], o, fj));
    }
  }
  sets.push({ type: 'stroke', path: stroke });
  return sets;
}

/** Hand-drawn open polyline (each segment sketched). */
export function roughPolyline(points: readonly Point[], options: RoughOptions): DrawOpSet {
  const path: Path = points.map((p, i) => (i === 0 ? M(p.x, p.y) : L(p.x, p.y)));
  return roughPath(path, options, false)[0]!;
}
