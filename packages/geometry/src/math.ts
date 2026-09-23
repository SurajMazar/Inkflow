export const EPSILON = 1e-9;
export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function approxEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function snapToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

/** Normalizes an angle in radians to [0, 2π). */
export function normalizeAngle(angle: number): number {
  const a = angle % TAU;
  return a < 0 ? a + TAU : a;
}

export const degToRad = (deg: number) => (deg * Math.PI) / 180;
export const radToDeg = (rad: number) => (rad * 180) / Math.PI;

/** Snaps an angle to the nearest multiple of `stepRad`, when within `thresholdRad`. */
export function snapAngle(angle: number, stepRad: number, thresholdRad = stepRad / 2): number {
  const snapped = Math.round(angle / stepRad) * stepRad;
  return Math.abs(snapped - angle) <= thresholdRad
    ? normalizeAngle(snapped)
    : normalizeAngle(angle);
}
