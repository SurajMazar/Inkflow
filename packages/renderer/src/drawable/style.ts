import type { FillStyle, SceneElement, StrokeStyle } from '@inkflow/elements';
import { deriveSeed, type RoughOptions } from '../rough/types';
import type { LineCap, StrokePaint } from './types';

export function isTransparentColor(color: string | null | undefined): boolean {
  if (!color) return true;
  const c = color.trim().toLowerCase();
  return (
    c === 'transparent' ||
    c === 'none' ||
    /^#[0-9a-f]{6}00$/.test(c) ||
    /^#[0-9a-f]{3}0$/.test(c) ||
    /^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(c) ||
    /^hsla\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(c)
  );
}

/** Dash pattern scaled by stroke width (null = solid). */
export function dashPattern(style: StrokeStyle, strokeWidth: number): number[] | null {
  const sw = Math.max(0.5, strokeWidth);
  switch (style) {
    case 'dashed':
      return [sw * 4 + 4, sw * 3 + 4];
    case 'dotted':
      return [0.5, sw * 2.5 + 2];
    default:
      return null;
  }
}

export function strokePaint(
  el: Pick<SceneElement, 'strokeColor' | 'strokeWidth' | 'strokeStyle'>,
  cap?: LineCap,
): StrokePaint | null {
  if (isTransparentColor(el.strokeColor) || el.strokeWidth <= 0) return null;
  return {
    color: el.strokeColor,
    width: el.strokeWidth,
    dash: dashPattern(el.strokeStyle, el.strokeWidth),
    cap: cap ?? 'round',
    join: 'round',
  };
}

export function solidPaint(
  color: string,
  width: number,
  dash: number[] | null = null,
): StrokePaint {
  return { color, width, dash, cap: 'round', join: 'round' };
}

/**
 * Roughness actually used for an element: small shapes get less jitter so they keep their form
 * (a 12px circle drawn with full roughness would look like a scribble).
 */
export function effectiveRoughness(roughness: number, width: number, height: number): number {
  if (roughness <= 0) return 0;
  const minSize = Math.min(Math.abs(width), Math.abs(height));
  const maxSize = Math.max(Math.abs(width), Math.abs(height));
  let r = roughness;
  if (maxSize < 10) r /= 3;
  else if (minSize < 20) r /= 2;
  return Math.min(r, 2.5);
}

export function roughOptionsFor(
  el: SceneElement,
  salt: number,
  overrides: Partial<RoughOptions> & { width?: number; height?: number } = {},
): RoughOptions {
  const width = overrides.width ?? el.width;
  const height = overrides.height ?? el.height;
  const fillStyle: FillStyle = overrides.fillStyle ?? el.fillStyle;
  return {
    seed: salt === 0 ? el.seed : deriveSeed(el.seed, salt),
    roughness: overrides.roughness ?? effectiveRoughness(el.roughness, width, height),
    bowing: overrides.bowing ?? 1,
    strokeWidth: overrides.strokeWidth ?? el.strokeWidth,
    fillStyle,
    hachureGap: overrides.hachureGap,
    hachureAngle: overrides.hachureAngle,
    fillWeight: overrides.fillWeight ?? Math.max(0.5, el.strokeWidth / 2),
    curveStepCount: overrides.curveStepCount,
    preserveVertices: overrides.preserveVertices ?? false,
    disableMultiStroke: overrides.disableMultiStroke ?? el.strokeStyle !== 'solid',
    maxRandomnessOffset: overrides.maxRandomnessOffset,
  };
}
