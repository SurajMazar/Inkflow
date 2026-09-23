import type { FreedrawBrush, FreedrawElement, PressurePoint } from '@inkflow/elements';
import type { Path, Point } from '@inkflow/geometry';

export interface FreedrawOutlineOptions {
  /** Base diameter of the stroke. */
  size: number;
  /** How much pressure affects the width (0 = constant width, 1 = maximum variation). */
  thinning: number;
  /** Minimum distance between outline points relative to size (0..1). */
  smoothing: number;
  /** How strongly input points are pulled toward the previous point (0..1). */
  streamline: number;
  /** Derive pressure from drawing speed instead of the recorded pressure. */
  simulatePressure: boolean;
  /** The stroke is complete: draw the end cap. */
  last: boolean;
}

interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  /** Unit direction of travel. */
  vx: number;
  vy: number;
  distance: number;
  running: number;
  radius: number;
}

const RATE_OF_PRESSURE_CHANGE = 0.275;
const CAP_STEPS = 13;

function rotateAround(p: Point, c: Point, angle: number): Point {
  const s = Math.sin(angle);
  const co = Math.cos(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co };
}

/** Streamlines raw samples and computes direction, running length and pressure per point. */
function strokePoints(input: readonly PressurePoint[], o: FreedrawOutlineOptions): StrokePoint[] {
  const t = 0.15 + (1 - Math.max(0, Math.min(1, o.streamline))) * 0.85;
  const pts: { x: number; y: number; p: number }[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i]!;
    const pressure = Number.isFinite(raw[2]) ? Math.max(0, Math.min(1, raw[2])) : 0.5;
    if (pts.length === 0) {
      pts.push({ x: raw[0], y: raw[1], p: pressure });
      continue;
    }
    const prev = pts[pts.length - 1]!;
    const isLast = i === input.length - 1;
    const x = isLast && o.last ? raw[0] : prev.x + (raw[0] - prev.x) * t;
    const y = isLast && o.last ? raw[1] : prev.y + (raw[1] - prev.y) * t;
    if (Math.hypot(x - prev.x, y - prev.y) < 0.05 && !isLast) continue;
    pts.push({ x, y, p: pressure });
  }
  const out: StrokePoint[] = [];
  let running = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const prev = pts[i - 1];
    const distance = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) : 0;
    running += distance;
    out.push({ x: p.x, y: p.y, pressure: p.p, vx: 0, vy: 0, distance, running, radius: 0 });
  }
  // Direction: central differences, one-sided at the ends.
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 1)]!;
    const b = out[Math.min(out.length - 1, i + 1)]!;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len = Math.hypot(dx, dy);
    if (len < 1e-9 && out.length > 1) {
      const n = out[out.length - 1]!;
      dx = n.x - out[0]!.x;
      dy = n.y - out[0]!.y;
      len = Math.hypot(dx, dy);
    }
    out[i]!.vx = len < 1e-9 ? 1 : dx / len;
    out[i]!.vy = len < 1e-9 ? 0 : dy / len;
  }
  // Pressure → radius.
  const size = Math.max(0.1, o.size);
  const thinning = Math.max(-1, Math.min(1, o.thinning));
  let prevPressure = o.simulatePressure ? Math.min(1, 0.25 + (out[1]?.distance ?? 0) / size) : (out[0]?.pressure ?? 0.5);
  for (const p of out) {
    let pressure: number;
    if (o.simulatePressure) {
      const sp = Math.min(1, p.distance / size);
      const rp = Math.min(1, 1 - sp);
      pressure = Math.min(1, prevPressure + (rp - prevPressure) * (sp * RATE_OF_PRESSURE_CHANGE));
    } else {
      pressure = p.pressure;
    }
    prevPressure = pressure;
    const radius = thinning ? size * (0.5 - thinning * (0.5 - pressure)) : size / 2;
    p.radius = Math.max(0.05, radius);
  }
  return out;
}

function circleOutline(c: Point, r: number, steps = 16): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return out;
}

/**
 * Variable-width stroke outline (a closed polygon) around the centerline of freehand samples.
 * Own implementation of the perfect-freehand approach: streamlined input, pressure (recorded or
 * speed-simulated) mapped to radius, offset left/right along the normal, rounded caps and rounded
 * joins at sharp corners.
 */
export function getFreedrawOutline(points: readonly PressurePoint[], options: FreedrawOutlineOptions): Point[] {
  if (points.length === 0) return [];
  const pts = strokePoints(points, options);
  const first = pts[0]!;
  if (pts.length === 1 || pts[pts.length - 1]!.running < 0.5) {
    return circleOutline(first, Math.max(first.radius, options.size / 2));
  }
  const minDistSq = (options.size * Math.max(0, Math.min(1, options.smoothing))) ** 2 * 0.25;
  const left: Point[] = [];
  const right: Point[] = [];
  const pushL = (p: Point, force = false) => {
    const last = left[left.length - 1];
    if (force || !last || (p.x - last.x) ** 2 + (p.y - last.y) ** 2 > minDistSq) left.push(p);
  };
  const pushR = (p: Point, force = false) => {
    const last = right[right.length - 1];
    if (force || !last || (p.x - last.x) ** 2 + (p.y - last.y) ** 2 > minDistSq) right.push(p);
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const r = p.radius;
    const prev = pts[i - 1];
    const next = pts[i + 1];
    if (prev && next) {
      // Sharp corner: turn by more than ~100° → wrap a round join around the point.
      const inX = p.x - prev.x;
      const inY = p.y - prev.y;
      const outX = next.x - p.x;
      const outY = next.y - p.y;
      const inLen = Math.hypot(inX, inY);
      const outLen = Math.hypot(outX, outY);
      if (inLen > 1e-9 && outLen > 1e-9) {
        const dpr = (inX * outX + inY * outY) / (inLen * outLen);
        if (dpr < -0.2) {
          const nx = -inY / inLen;
          const ny = inX / inLen;
          const pl = { x: p.x + nx * r, y: p.y + ny * r };
          const pr = { x: p.x - nx * r, y: p.y - ny * r };
          const turn = Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY);
          for (let s = 0; s <= CAP_STEPS; s++) {
            const t = s / CAP_STEPS;
            pushL(rotateAround(pl, p, turn * t), true);
            pushR(rotateAround(pr, p, turn * t), true);
          }
          continue;
        }
      }
    }
    const nx = -p.vy;
    const ny = p.vx;
    const isEnd = i === 0 || i === pts.length - 1;
    pushL({ x: p.x + nx * r, y: p.y + ny * r }, isEnd);
    pushR({ x: p.x - nx * r, y: p.y - ny * r }, isEnd);
  }
  const last = pts[pts.length - 1]!;
  // Start cap: half circle from the right side around the back of the first point to the left.
  const startCap: Point[] = [];
  const s0 = right[0]!;
  for (let s = 1; s < CAP_STEPS; s++) startCap.push(rotateAround(s0, first, (-Math.PI * s) / CAP_STEPS));
  // End cap: half circle from the left side around the front of the last point to the right.
  const endCap: Point[] = [];
  const e0 = left[left.length - 1]!;
  if (options.last) {
    for (let s = 1; s < CAP_STEPS; s++) endCap.push(rotateAround(e0, last, (-Math.PI * s) / CAP_STEPS));
  }
  return [...startCap, ...left, ...endCap, ...right.reverse()];
}

/** Closed smooth path through outline points (quadratic midpoints → cubic). */
export function outlineToPath(outline: readonly Point[]): Path {
  const n = outline.length;
  if (n < 3) return [];
  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = mid(outline[n - 1]!, outline[0]!);
  const out: Path = [{ type: 'M', x: start.x, y: start.y }];
  let cursor = start;
  for (let i = 0; i < n; i++) {
    const ctrl = outline[i]!;
    const end = mid(ctrl, outline[(i + 1) % n]!);
    out.push({
      type: 'C',
      x1: cursor.x + ((ctrl.x - cursor.x) * 2) / 3,
      y1: cursor.y + ((ctrl.y - cursor.y) * 2) / 3,
      x2: end.x + ((ctrl.x - end.x) * 2) / 3,
      y2: end.y + ((ctrl.y - end.y) * 2) / 3,
      x: end.x,
      y: end.y,
    });
    cursor = end;
  }
  out.push({ type: 'Z' });
  return out;
}

export interface BrushSettings {
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  /** Extra alpha multiplier (highlighter). */
  alpha: number;
  simulatePressure: boolean;
}

/** Stroke parameters per brush; sizes scale with the element stroke width. */
export function getBrushSettings(el: Pick<FreedrawElement, 'brush' | 'strokeWidth' | 'simulatePressure'>): BrushSettings {
  const sw = Math.max(0.5, el.strokeWidth);
  const brush: FreedrawBrush = el.brush;
  switch (brush) {
    case 'brush':
      return { size: sw * 3 + 2, thinning: 0.75, smoothing: 0.75, streamline: 0.65, alpha: 1, simulatePressure: el.simulatePressure };
    case 'highlighter':
      return { size: sw * 4 + 4, thinning: 0, smoothing: 0.6, streamline: 0.6, alpha: 0.4, simulatePressure: false };
    default:
      return { size: sw * 1.75 + 1, thinning: 0.6, smoothing: 0.5, streamline: 0.5, alpha: 1, simulatePressure: el.simulatePressure };
  }
}
