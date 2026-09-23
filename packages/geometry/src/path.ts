import { boundsFromPoints, type Bounds } from './bounds';
import { flattenCubic } from './bezier';
import type { Point } from './vec';

/** Normalized absolute path commands (every SVG command reduces to these). */
export type PathCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

export type Path = PathCommand[];

const NUMBER_RE = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const COMMAND_RE = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
const PARAM_COUNT: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Converts an SVG elliptical arc into cubic bezier commands (SVG spec F.6). */
function arcToCubics(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): PathCommand[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ type: 'L', x: x2, y: y2 }];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segments;
  const out: PathCommand[] = [];
  const k = (4 / 3) * Math.tan(step / 4);
  let t = theta1;
  const pt = (a: number) => ({
    x: cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin,
    y: cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos,
  });
  const deriv = (a: number) => ({
    x: -rx * Math.sin(a) * cos - ry * Math.cos(a) * sin,
    y: -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos,
  });
  for (let i = 0; i < segments; i++) {
    const a1 = t;
    const a2 = t + step;
    const p1 = pt(a1);
    const p2 = pt(a2);
    const d1 = deriv(a1);
    const d2 = deriv(a2);
    out.push({
      type: 'C',
      x1: p1.x + k * d1.x,
      y1: p1.y + k * d1.y,
      x2: p2.x - k * d2.x,
      y2: p2.y - k * d2.y,
      x: p2.x,
      y: p2.y,
    });
    t = a2;
  }
  return out;
}

/**
 * Parses SVG path data into normalized absolute commands. Only geometry is interpreted; the
 * input is never evaluated, so it is safe for untrusted data. Throws on malformed input.
 */
export function parseSvgPath(d: string): Path {
  if (d.length > 200_000) throw new Error('Path data too long');
  const out: Path = [];
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let lastCtrl: Point | null = null;
  let lastQuad: Point | null = null;
  let prevType = '';
  const matches = d.matchAll(COMMAND_RE);
  for (const m of matches) {
    const raw = m[1]!;
    const upper = raw.toUpperCase();
    const rel = raw !== upper;
    const nums = (m[2]!.match(NUMBER_RE) ?? []).map(Number);
    const count = PARAM_COUNT[upper]!;
    if (upper === 'Z') {
      out.push({ type: 'Z' });
      cx = startX;
      cy = startY;
      lastCtrl = lastQuad = null;
      prevType = 'Z';
      continue;
    }
    if (nums.length === 0 || nums.length % count !== 0) throw new Error(`Malformed path segment "${raw}"`);
    for (let i = 0; i < nums.length; i += count) {
      const a = nums.slice(i, i + count);
      let type = upper;
      if (upper === 'M' && i > 0) type = 'L';
      const ox = rel ? cx : 0;
      const oy = rel ? cy : 0;
      switch (type) {
        case 'M':
          cx = a[0]! + ox;
          cy = a[1]! + oy;
          startX = cx;
          startY = cy;
          out.push({ type: 'M', x: cx, y: cy });
          lastCtrl = lastQuad = null;
          break;
        case 'L':
          cx = a[0]! + ox;
          cy = a[1]! + oy;
          out.push({ type: 'L', x: cx, y: cy });
          lastCtrl = lastQuad = null;
          break;
        case 'H':
          cx = a[0]! + ox;
          out.push({ type: 'L', x: cx, y: cy });
          lastCtrl = lastQuad = null;
          break;
        case 'V':
          cy = a[0]! + oy;
          out.push({ type: 'L', x: cx, y: cy });
          lastCtrl = lastQuad = null;
          break;
        case 'C': {
          const c = { x1: a[0]! + ox, y1: a[1]! + oy, x2: a[2]! + ox, y2: a[3]! + oy, x: a[4]! + ox, y: a[5]! + oy };
          out.push({ type: 'C', ...c });
          lastCtrl = { x: c.x2, y: c.y2 };
          lastQuad = null;
          cx = c.x;
          cy = c.y;
          break;
        }
        case 'S': {
          const r: Point = lastCtrl && /[CS]/.test(prevType) ? { x: 2 * cx - lastCtrl.x, y: 2 * cy - lastCtrl.y } : { x: cx, y: cy };
          const c: Omit<Extract<PathCommand, { type: 'C' }>, 'type'> = { x1: r.x, y1: r.y, x2: a[0]! + ox, y2: a[1]! + oy, x: a[2]! + ox, y: a[3]! + oy };
          out.push({ type: 'C', ...c });
          lastCtrl = { x: c.x2, y: c.y2 };
          lastQuad = null;
          cx = c.x;
          cy = c.y;
          break;
        }
        case 'Q':
        case 'T': {
          const q: Point =
            type === 'Q'
              ? { x: a[0]! + ox, y: a[1]! + oy }
              : lastQuad && /[QT]/.test(prevType)
                ? { x: 2 * cx - lastQuad.x, y: 2 * cy - lastQuad.y }
                : { x: cx, y: cy };
          const ex = (type === 'Q' ? a[2]! : a[0]!) + ox;
          const ey = (type === 'Q' ? a[3]! : a[1]!) + oy;
          out.push({
            type: 'C',
            x1: cx + (2 / 3) * (q.x - cx),
            y1: cy + (2 / 3) * (q.y - cy),
            x2: ex + (2 / 3) * (q.x - ex),
            y2: ey + (2 / 3) * (q.y - ey),
            x: ex,
            y: ey,
          });
          lastQuad = q;
          lastCtrl = null;
          cx = ex;
          cy = ey;
          break;
        }
        case 'A': {
          const ex = a[5]! + ox;
          const ey = a[6]! + oy;
          out.push(...arcToCubics(cx, cy, a[0]!, a[1]!, a[2]!, a[3] !== 0, a[4] !== 0, ex, ey));
          cx = ex;
          cy = ey;
          lastCtrl = lastQuad = null;
          break;
        }
      }
      prevType = type;
    }
  }
  return out;
}

export function pathToSvg(path: Path, precision = 2): string {
  const f = (n: number) => Number(n.toFixed(precision)).toString();
  return path
    .map((c) => {
      switch (c.type) {
        case 'M':
        case 'L':
          return `${c.type}${f(c.x)} ${f(c.y)}`;
        case 'C':
          return `C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`;
        case 'Z':
          return 'Z';
      }
    })
    .join(' ');
}

/** Splits a path into polylines (one per subpath). `closed` reflects a trailing Z. */
export function flattenPath(path: Path, curveSegments = 12): { points: Point[]; closed: boolean }[] {
  const subpaths: { points: Point[]; closed: boolean }[] = [];
  let current: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  const flush = (closed: boolean) => {
    if (current.length > 0) subpaths.push({ points: current, closed });
    current = [];
  };
  for (const c of path) {
    switch (c.type) {
      case 'M':
        flush(false);
        cursor = { x: c.x, y: c.y };
        current.push(cursor);
        break;
      case 'L':
        cursor = { x: c.x, y: c.y };
        current.push(cursor);
        break;
      case 'C': {
        const pts = flattenCubic({ p0: cursor, c1: { x: c.x1, y: c.y1 }, c2: { x: c.x2, y: c.y2 }, p1: { x: c.x, y: c.y } }, curveSegments);
        current.push(...pts.slice(1));
        cursor = { x: c.x, y: c.y };
        break;
      }
      case 'Z': {
        const first = current[0];
        flush(true);
        if (first) cursor = first;
        break;
      }
    }
  }
  flush(false);
  return subpaths;
}

export function pathBounds(path: Path): Bounds {
  return boundsFromPoints(flattenPath(path).flatMap((s) => s.points));
}

/** Applies scale then translation to every coordinate of a path. */
export function transformPath(path: Path, sx: number, sy: number, tx = 0, ty = 0): Path {
  return path.map((c) => {
    switch (c.type) {
      case 'M':
      case 'L':
        return { type: c.type, x: c.x * sx + tx, y: c.y * sy + ty };
      case 'C':
        return {
          type: 'C',
          x1: c.x1 * sx + tx,
          y1: c.y1 * sy + ty,
          x2: c.x2 * sx + tx,
          y2: c.y2 * sy + ty,
          x: c.x * sx + tx,
          y: c.y * sy + ty,
        };
      case 'Z':
        return c;
    }
  });
}

/** Builds a path from polygon points. */
export function polygonPath(points: readonly Point[], closed = true): Path {
  if (points.length === 0) return [];
  const out: Path = [{ type: 'M', x: points[0]!.x, y: points[0]!.y }];
  for (let i = 1; i < points.length; i++) out.push({ type: 'L', x: points[i]!.x, y: points[i]!.y });
  if (closed) out.push({ type: 'Z' });
  return out;
}

const KAPPA = 0.5522847498307936;

/** Ellipse as four cubic curves. */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): Path {
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    { type: 'M', x: cx + rx, y: cy },
    { type: 'C', x1: cx + rx, y1: cy + oy, x2: cx + ox, y2: cy + ry, x: cx, y: cy + ry },
    { type: 'C', x1: cx - ox, y1: cy + ry, x2: cx - rx, y2: cy + oy, x: cx - rx, y: cy },
    { type: 'C', x1: cx - rx, y1: cy - oy, x2: cx - ox, y2: cy - ry, x: cx, y: cy - ry },
    { type: 'C', x1: cx + ox, y1: cy - ry, x2: cx + rx, y2: cy - oy, x: cx + rx, y: cy },
    { type: 'Z' },
  ];
}

/** Rounded rectangle path; radius is clamped to half the shorter side. */
export function roundedRectPath(x: number, y: number, w: number, h: number, radius: number): Path {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) {
    return polygonPath([
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ]);
  }
  const k = r * (1 - KAPPA);
  return [
    { type: 'M', x: x + r, y },
    { type: 'L', x: x + w - r, y },
    { type: 'C', x1: x + w - k, y1: y, x2: x + w, y2: y + k, x: x + w, y: y + r },
    { type: 'L', x: x + w, y: y + h - r },
    { type: 'C', x1: x + w, y1: y + h - k, x2: x + w - k, y2: y + h, x: x + w - r, y: y + h },
    { type: 'L', x: x + r, y: y + h },
    { type: 'C', x1: x + k, y1: y + h, x2: x, y2: y + h - k, x, y: y + h - r },
    { type: 'L', x, y: y + r },
    { type: 'C', x1: x, y1: y + k, x2: x + k, y2: y, x: x + r, y },
    { type: 'Z' },
  ];
}
