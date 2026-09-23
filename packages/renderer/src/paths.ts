import {
  catmullRomToBeziers,
  cubicPoint,
  flattenPath,
  type Bounds,
  type CubicBezier,
  type Path,
  type PathCommand,
  type Point,
} from '@inkflow/geometry';

/** Adaptive corner radius used for rounded rectangles (proportional for small boxes, capped). */
export function adaptiveCornerRadius(size: number): number {
  const cutoff = 32;
  return size <= cutoff / 0.25 ? size * 0.25 : cutoff;
}

/** Closed polygon with rounded corners (each vertex replaced by a smooth curve). */
export function roundedPolygonPath(points: readonly Point[], radius: number): Path {
  const n = points.length;
  if (n < 3 || radius <= 0) return polygon(points, true);
  const corners: { a: Point; v: Point; b: Point }[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]!;
    const cur = points[i]!;
    const next = points[(i + 1) % n]!;
    corners.push(cornerAt(prev, cur, next, radius));
  }
  const out: Path = [{ type: 'M', x: corners[0]!.b.x, y: corners[0]!.b.y }];
  for (let i = 1; i <= n; i++) {
    const c = corners[i % n]!;
    out.push({ type: 'L', x: c.a.x, y: c.a.y });
    out.push(cornerCurve(c));
  }
  out.push({ type: 'Z' });
  return out;
}

function cornerAt(
  prev: Point,
  cur: Point,
  next: Point,
  radius: number,
): { a: Point; v: Point; b: Point } {
  const d1 = Math.hypot(prev.x - cur.x, prev.y - cur.y);
  const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
  const r = Math.max(0, Math.min(radius, d1 / 2, d2 / 2));
  const a =
    d1 === 0
      ? cur
      : { x: cur.x + ((prev.x - cur.x) * r) / d1, y: cur.y + ((prev.y - cur.y) * r) / d1 };
  const b =
    d2 === 0
      ? cur
      : { x: cur.x + ((next.x - cur.x) * r) / d2, y: cur.y + ((next.y - cur.y) * r) / d2 };
  return { a, v: cur, b };
}

/** Quadratic corner (control point at the vertex) expressed as a cubic. */
function cornerCurve(c: { a: Point; v: Point; b: Point }): PathCommand {
  return {
    type: 'C',
    x1: c.a.x + ((c.v.x - c.a.x) * 2) / 3,
    y1: c.a.y + ((c.v.y - c.a.y) * 2) / 3,
    x2: c.b.x + ((c.v.x - c.b.x) * 2) / 3,
    y2: c.b.y + ((c.v.y - c.b.y) * 2) / 3,
    x: c.b.x,
    y: c.b.y,
  };
}

export function polygon(points: readonly Point[], closed: boolean): Path {
  if (points.length === 0) return [];
  const out: Path = [{ type: 'M', x: points[0]!.x, y: points[0]!.y }];
  for (let i = 1; i < points.length; i++) out.push({ type: 'L', x: points[i]!.x, y: points[i]!.y });
  if (closed) out.push({ type: 'Z' });
  return out;
}

/** Open polyline whose interior bends are rounded with `radius` (orthogonal connectors). */
export function roundedPolylinePath(points: readonly Point[], radius: number): Path {
  const pts = dedupe(points);
  if (pts.length < 3 || radius <= 0) return polygon(pts, false);
  const out: Path = [{ type: 'M', x: pts[0]!.x, y: pts[0]!.y }];
  for (let i = 1; i < pts.length - 1; i++) {
    const c = cornerAt(pts[i - 1]!, pts[i]!, pts[i + 1]!, radius);
    out.push({ type: 'L', x: c.a.x, y: c.a.y });
    out.push(cornerCurve(c));
  }
  const last = pts[pts.length - 1]!;
  out.push({ type: 'L', x: last.x, y: last.y });
  return out;
}

function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.y - p.y) > 1e-9) out.push(p);
  }
  return out;
}

/** Smooth open (or closed) curve through points using the shared Catmull-Rom conversion. */
export function curvePath(points: readonly Point[], closed = false): Path {
  const pts = dedupe(points);
  if (pts.length < 2) return pts.length === 1 ? [{ type: 'M', x: pts[0]!.x, y: pts[0]!.y }] : [];
  if (pts.length === 2) return polygon(pts, closed);
  const input = closed ? [...pts, pts[0]!] : pts;
  const beziers = catmullRomToBeziers(input);
  const out: Path = [{ type: 'M', x: pts[0]!.x, y: pts[0]!.y }];
  for (const b of beziers) out.push(bezierCommand(b));
  if (closed) out.push({ type: 'Z' });
  return out;
}

export function bezierCommand(b: CubicBezier): PathCommand {
  return { type: 'C', x1: b.c1.x, y1: b.c1.y, x2: b.c2.x, y2: b.c2.y, x: b.p1.x, y: b.p1.y };
}

/** Path segment with explicit start point (for measuring/trimming). */
export type Segment =
  | { type: 'L'; from: Point; to: Point }
  | { type: 'C'; from: Point; c1: Point; c2: Point; to: Point };

/** Splits the first subpath of a path into explicit segments. */
export function pathSegments(path: Path): Segment[] {
  const out: Segment[] = [];
  let cursor: Point | null = null;
  let start: Point | null = null;
  for (const c of path) {
    if (c.type === 'M') {
      if (cursor && out.length > 0) break;
      cursor = { x: c.x, y: c.y };
      start = cursor;
    } else if (c.type === 'L' && cursor) {
      out.push({ type: 'L', from: cursor, to: { x: c.x, y: c.y } });
      cursor = { x: c.x, y: c.y };
    } else if (c.type === 'C' && cursor) {
      out.push({
        type: 'C',
        from: cursor,
        c1: { x: c.x1, y: c.y1 },
        c2: { x: c.x2, y: c.y2 },
        to: { x: c.x, y: c.y },
      });
      cursor = { x: c.x, y: c.y };
    } else if (c.type === 'Z' && cursor && start) {
      out.push({ type: 'L', from: cursor, to: start });
      cursor = start;
    }
  }
  return out;
}

export function segmentsToPath(segments: readonly Segment[]): Path {
  if (segments.length === 0) return [];
  const first = segments[0]!;
  const out: Path = [{ type: 'M', x: first.from.x, y: first.from.y }];
  for (const s of segments) {
    if (s.type === 'L') out.push({ type: 'L', x: s.to.x, y: s.to.y });
    else
      out.push({ type: 'C', x1: s.c1.x, y1: s.c1.y, x2: s.c2.x, y2: s.c2.y, x: s.to.x, y: s.to.y });
  }
  return out;
}

function segmentLength(s: Segment): number {
  if (s.type === 'L') return Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y);
  let len = 0;
  let prev = s.from;
  const b = { p0: s.from, c1: s.c1, c2: s.c2, p1: s.to };
  for (let i = 1; i <= 16; i++) {
    const p = cubicPoint(b, i / 16);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

/** de Casteljau split of a cubic at t. */
function splitCubic(s: Extract<Segment, { type: 'C' }>, t: number): [Segment, Segment] {
  const lerp = (a: Point, b: Point) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const p01 = lerp(s.from, s.c1);
  const p12 = lerp(s.c1, s.c2);
  const p23 = lerp(s.c2, s.to);
  const p012 = lerp(p01, p12);
  const p123 = lerp(p12, p23);
  const mid = lerp(p012, p123);
  return [
    { type: 'C', from: s.from, c1: p01, c2: p012, to: mid },
    { type: 'C', from: mid, c1: p123, c2: p23, to: s.to },
  ];
}

/** Parameter t at which a cubic has travelled `dist` from its start. */
function cubicTAtLength(s: Extract<Segment, { type: 'C' }>, dist: number): number {
  const b = { p0: s.from, c1: s.c1, c2: s.c2, p1: s.to };
  const steps = 32;
  let acc = 0;
  let prev = s.from;
  for (let i = 1; i <= steps; i++) {
    const p = cubicPoint(b, i / steps);
    const d = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (acc + d >= dist) return (i - 1 + (d === 0 ? 0 : (dist - acc) / d)) / steps;
    acc += d;
    prev = p;
  }
  return 1;
}

/** Removes `amount` of length from the start (atStart) or end of a single open subpath. */
export function trimPath(path: Path, amount: number, atStart: boolean): Path {
  if (amount <= 0) return path;
  const segments = pathSegments(path);
  if (segments.length === 0) return path;
  const total = segments.reduce((s, seg) => s + segmentLength(seg), 0);
  if (amount >= total * 0.95) return path;
  if (!atStart) {
    const reversed = segments.map(reverseSegment).reverse();
    const trimmed = trimSegmentsStart(reversed, amount);
    return segmentsToPath(trimmed.map(reverseSegment).reverse());
  }
  return segmentsToPath(trimSegmentsStart(segments, amount));
}

function reverseSegment(s: Segment): Segment {
  return s.type === 'L'
    ? { type: 'L', from: s.to, to: s.from }
    : { type: 'C', from: s.to, c1: s.c2, c2: s.c1, to: s.from };
}

function trimSegmentsStart(segments: Segment[], amount: number): Segment[] {
  let remaining = amount;
  const out = segments.slice();
  while (out.length > 0) {
    const s = out[0]!;
    const len = segmentLength(s);
    if (len <= remaining) {
      remaining -= len;
      out.shift();
      continue;
    }
    if (s.type === 'L') {
      const k = remaining / len;
      out[0] = {
        type: 'L',
        from: { x: s.from.x + (s.to.x - s.from.x) * k, y: s.from.y + (s.to.y - s.from.y) * k },
        to: s.to,
      };
    } else {
      out[0] = splitCubic(s, cubicTAtLength(s, remaining))[1];
    }
    break;
  }
  return out;
}

/**
 * Unit tangent direction at the start (pointing backwards out of the path) or at the end
 * (pointing forward out of the path) of the first subpath.
 */
export function endTangent(path: Path, atStart: boolean): { point: Point; dir: Point } | null {
  const segments = pathSegments(path);
  if (segments.length === 0) return null;
  const ordered = atStart ? segments.map(reverseSegment).reverse() : segments;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const s = ordered[i]!;
    const tip = ordered[ordered.length - 1]!.to;
    const candidates = s.type === 'L' ? [s.from] : [s.c2, s.c1, s.from];
    for (const c of candidates) {
      const dx = tip.x - c.x;
      const dy = tip.y - c.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) return { point: tip, dir: { x: dx / len, y: dy / len } };
    }
  }
  return null;
}

/** Flattened points of the first subpath. */
export function flattenFirst(path: Path, segments = 12): Point[] {
  return flattenPath(path, segments)[0]?.points ?? [];
}

export function pathCommandBounds(path: Path, into?: Bounds): Bounds {
  const b = into ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => {
    if (x < b.minX) b.minX = x;
    if (y < b.minY) b.minY = y;
    if (x > b.maxX) b.maxX = x;
    if (y > b.maxY) b.maxY = y;
  };
  for (const c of path) {
    if (c.type === 'M' || c.type === 'L') add(c.x, c.y);
    else if (c.type === 'C') {
      add(c.x1, c.y1);
      add(c.x2, c.y2);
      add(c.x, c.y);
    }
  }
  return b;
}

/** Mirrors path coordinates inside a w×h box. */
export function flipPath(path: Path, w: number, h: number, flipX: boolean, flipY: boolean): Path {
  if (!flipX && !flipY) return path;
  const fx = (x: number) => (flipX ? w - x : x);
  const fy = (y: number) => (flipY ? h - y : y);
  return path.map((c) => {
    switch (c.type) {
      case 'M':
      case 'L':
        return { type: c.type, x: fx(c.x), y: fy(c.y) };
      case 'C':
        return {
          type: 'C',
          x1: fx(c.x1),
          y1: fy(c.y1),
          x2: fx(c.x2),
          y2: fy(c.y2),
          x: fx(c.x),
          y: fy(c.y),
        };
      case 'Z':
        return c;
    }
  });
}

/** Rectangle path helper. */
export function rectPath(x: number, y: number, w: number, h: number): Path {
  return polygon(
    [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    true,
  );
}

/** Rectangle with only the top corners rounded (table headers). */
export function topRoundedRectPath(x: number, y: number, w: number, h: number, r: number): Path {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  if (rr === 0) return rectPath(x, y, w, h);
  const k = rr * (1 - 0.5522847498307936);
  return [
    { type: 'M', x, y: y + h },
    { type: 'L', x, y: y + rr },
    { type: 'C', x1: x, y1: y + k, x2: x + k, y2: y, x: x + rr, y },
    { type: 'L', x: x + w - rr, y },
    { type: 'C', x1: x + w - k, y1: y, x2: x + w, y2: y + k, x: x + w, y: y + rr },
    { type: 'L', x: x + w, y: y + h },
    { type: 'Z' },
  ];
}
