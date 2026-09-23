import type { Point } from './vec';

/**
 * Approximate distance from p to the outline of an axis-aligned ellipse centered at c
 * with radii rx, ry. Uses iterative projection (accurate to well below a pixel).
 */
export function distanceToEllipseOutline(p: Point, c: Point, rx: number, ry: number): number {
  if (rx <= 0 || ry <= 0) return Math.hypot(p.x - c.x, p.y - c.y);
  const px = Math.abs(p.x - c.x);
  const py = Math.abs(p.y - c.y);
  let tx = 0.707;
  let ty = 0.707;
  for (let i = 0; i < 4; i++) {
    const x = rx * tx;
    const y = ry * ty;
    const ex = ((rx * rx - ry * ry) * tx ** 3) / rx;
    const ey = ((ry * ry - rx * rx) * ty ** 3) / ry;
    const qx = px - ex;
    const qy = py - ey;
    const rxv = x - ex;
    const ryv = y - ey;
    const q = Math.hypot(qx, qy);
    const r = Math.hypot(rxv, ryv);
    tx = Math.min(1, Math.max(0, ((qx * r) / q + ex) / rx));
    ty = Math.min(1, Math.max(0, ((qy * r) / q + ey) / ry));
    const t = Math.hypot(tx, ty);
    tx /= t;
    ty /= t;
  }
  return Math.hypot(px - rx * tx, py - ry * ty);
}

export function pointInEllipse(p: Point, c: Point, rx: number, ry: number): boolean {
  if (rx <= 0 || ry <= 0) return false;
  const dx = (p.x - c.x) / rx;
  const dy = (p.y - c.y) / ry;
  return dx * dx + dy * dy <= 1;
}

/** Intersection of the ray from the ellipse center toward `toward` with its outline. */
export function ellipseRayIntersection(c: Point, rx: number, ry: number, toward: Point): Point {
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return { x: c.x + rx, y: c.y };
  const k = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  return { x: c.x + dx * k, y: c.y + dy * k };
}

export function ellipsePoints(c: Point, rx: number, ry: number, segments = 48): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: c.x + Math.cos(a) * rx, y: c.y + Math.sin(a) * ry });
  }
  return pts;
}
