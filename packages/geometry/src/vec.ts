export interface Point {
  x: number;
  y: number;
}

export type PointTuple = readonly [number, number];

export const point = (x: number, y: number): Point => ({ x, y });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
export const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
export const length = (a: Point): number => Math.hypot(a.x, a.y);
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const distanceSq = (a: Point, b: Point): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const perpendicular = (a: Point): Point => ({ x: -a.y, y: a.x });
export const equals = (a: Point, b: Point, epsilon = 1e-9): boolean =>
  Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;

export function normalize(a: Point): Point {
  const len = Math.hypot(a.x, a.y);
  return len === 0 ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Rotates `p` around `center` by `angle` radians (clockwise in screen space, y down). */
export function rotatePoint(p: Point, center: Point, angle: number): Point {
  if (angle === 0) return { x: p.x, y: p.y };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/** Angle of the vector from `a` to `b` in radians. */
export const angleOf = (a: Point, b: Point): number => Math.atan2(b.y - a.y, b.x - a.x);

export const toTuple = (p: Point): [number, number] => [p.x, p.y];
export const fromTuple = (t: PointTuple): Point => ({ x: t[0], y: t[1] });
