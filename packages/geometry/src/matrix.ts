import type { Point } from './vec';

/** 2D affine matrix in canvas order: [a, b, c, d, e, f] ≙ | a c e | b d f | 0 0 1 |. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (det === 0) return IDENTITY;
  const inv = 1 / det;
  return [
    m[3] * inv,
    -m[1] * inv,
    -m[2] * inv,
    m[0] * inv,
    (m[2] * m[5] - m[3] * m[4]) * inv,
    (m[1] * m[4] - m[0] * m[5]) * inv,
  ];
}

export function applyMatrix(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export const translation = (tx: number, ty: number): Matrix => [1, 0, 0, 1, tx, ty];
export const scaling = (sx: number, sy = sx): Matrix => [sx, 0, 0, sy, 0, 0];

export function rotation(angle: number): Matrix {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, -s, c, 0, 0];
}

export function rotationAround(angle: number, center: Point): Matrix {
  return multiply(
    translation(center.x, center.y),
    multiply(rotation(angle), translation(-center.x, -center.y)),
  );
}

export function compose(...matrices: Matrix[]): Matrix {
  return matrices.reduce((acc, m) => multiply(acc, m), IDENTITY);
}
