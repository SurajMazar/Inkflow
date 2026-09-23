import type { Point } from '@inkflow/geometry';

export type Line = [Point, Point];

/** Upper bound of scanlines per fill (keeps gigantic shapes cheap; the gap grows instead). */
const MAX_SCANLINES = 2500;

const rotate = (p: Point, cos: number, sin: number): Point => ({
  x: p.x * cos - p.y * sin,
  y: p.x * sin + p.y * cos,
});

/** Even-odd point-in-polygons test (holes are simply additional rings). */
export function pointInPolygons(p: Point, polygons: readonly (readonly Point[])[]): boolean {
  let inside = false;
  for (const poly of polygons) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!;
      const b = poly[j]!;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside;
    }
  }
  return inside;
}

function usableRings(polygons: readonly (readonly Point[])[]): Point[][] {
  const out: Point[][] = [];
  for (const poly of polygons) {
    const ring: Point[] = [];
    for (const p of poly) {
      const last = ring[ring.length - 1];
      if (!last || Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.y - p.y) > 1e-9)
        ring.push({ x: p.x, y: p.y });
    }
    if (ring.length > 1) {
      const first = ring[0]!;
      const last = ring[ring.length - 1]!;
      if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) ring.pop();
    }
    if (ring.length >= 3) out.push(ring);
  }
  return out;
}

/**
 * Scanline hatching of a set of polygon rings (even-odd, so inner rings become holes) with lines at
 * `angleDeg`, spaced by `gap`. Returned segments lie exactly inside the polygons.
 */
export function hachureLines(
  polygons: readonly (readonly Point[])[],
  gapIn: number,
  angleDeg: number,
): Line[] {
  const rings = usableRings(polygons);
  if (rings.length === 0 || !(gapIn > 0)) return [];
  let gap = gapIn;
  const angle = (angleDeg * Math.PI) / 180;
  // Rotate the polygons by -angle so that hatch lines become horizontal scanlines.
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const rotated = rings.map((ring) => ring.map((p) => rotate(p, cos, sin)));
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rotated) {
    for (const p of ring) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const height = maxY - minY;
  if (!(height > 0)) return [];
  if (height / gap > MAX_SCANLINES) gap = height / MAX_SCANLINES;
  const count = Math.floor(height / gap);
  // Center the pattern vertically so thin shapes still receive at least one line.
  const start = minY + (height - count * gap) / 2 + (count === 0 ? height / 2 : 0);
  const steps = count === 0 ? 1 : count + 1;
  const back = { cos: Math.cos(angle), sin: Math.sin(angle) };
  const out: Line[] = [];
  const xs: number[] = [];
  for (let k = 0; k < steps; k++) {
    const y = start + k * gap;
    if (y <= minY || y >= maxY) continue;
    xs.length = 0;
    for (const ring of rotated) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j]!;
        const b = ring[i]!;
        if (a.y <= y !== b.y <= y) {
          xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
      }
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x1 = xs[i]!;
      const x2 = xs[i + 1]!;
      if (x2 - x1 < 1e-6) continue;
      out.push([
        rotate({ x: x1, y }, back.cos, back.sin),
        rotate({ x: x2, y }, back.cos, back.sin),
      ]);
    }
  }
  return out;
}

/** Clips segment ab to the inside of the polygons (even-odd), returning the inside pieces. */
export function clipSegmentToPolygons(
  a: Point,
  b: Point,
  polygons: readonly (readonly Point[])[],
): Line[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ts = [0, 1];
  for (const poly of polygons) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const p = poly[j]!;
      const q = poly[i]!;
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-12) continue;
      const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / denom;
      const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / denom;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
  }
  ts.sort((m, n) => m - n);
  const out: Line[] = [];
  let open: number | null = null;
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if (t1 - t0 < 1e-9) continue;
    const mid = (t0 + t1) / 2;
    const inside = pointInPolygons({ x: a.x + dx * mid, y: a.y + dy * mid }, polygons);
    if (inside) {
      if (open === null) open = t0;
    } else if (open !== null) {
      out.push([
        { x: a.x + dx * open, y: a.y + dy * open },
        { x: a.x + dx * t0, y: a.y + dy * t0 },
      ]);
      open = null;
    }
  }
  if (open !== null) {
    out.push([
      { x: a.x + dx * open, y: a.y + dy * open },
      { x: b.x, y: b.y },
    ]);
  }
  return out;
}

/**
 * Zigzag fill: a continuous back-and-forth scribble across the (rotated) bounding box, with turns
 * `gap` apart, clipped to the polygons. Pieces are exactly inside the outline.
 */
export function zigzagLines(
  polygons: readonly (readonly Point[])[],
  gapIn: number,
  angleDeg: number,
): Line[] {
  const rings = usableRings(polygons);
  if (rings.length === 0 || !(gapIn > 0)) return [];
  let gap = gapIn;
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const rotated = rings.map((ring) => ring.map((p) => rotate(p, cos, sin)));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rotated) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!(maxY > minY) || !(maxX > minX)) return [];
  const back = { cos: Math.cos(angle), sin: Math.sin(angle) };
  // Scribble strokes go diagonally between the left and right edges of the rotated bbox.
  const pad = 0.5;
  const left = minX - pad;
  const right = maxX + pad;
  const out: Line[] = [];
  if ((maxY - minY) / gap > MAX_SCANLINES) gap = (maxY - minY) / MAX_SCANLINES;
  const rows = Math.max(1, Math.ceil((maxY - minY) / gap));
  const startY = minY - (rows * gap - (maxY - minY)) / 2;
  for (let k = 0; k < rows; k++) {
    const y0 = startY + k * gap;
    const y1 = y0 + gap;
    const a = k % 2 === 0 ? { x: left, y: y0 } : { x: right, y: y0 };
    const b = k % 2 === 0 ? { x: right, y: y1 } : { x: left, y: y1 };
    for (const [p, q] of clipSegmentToPolygons(a, b, rotated)) {
      out.push([rotate(p, back.cos, back.sin), rotate(q, back.cos, back.sin)]);
    }
  }
  return out;
}
