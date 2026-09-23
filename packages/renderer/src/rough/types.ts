import type { FillStyle } from '@inkflow/elements';
import type { PathCommand } from '@inkflow/geometry';

/** Options of the hand-drawn generator. All randomness derives from `seed`. */
export interface RoughOptions {
  seed: number;
  /** 0 = crisp geometry (no jitter), 1 = artist, 2 = cartoonist. */
  roughness: number;
  /** How much straight lines bow outward (default 1). */
  bowing?: number;
  strokeWidth: number;
  fillStyle: FillStyle;
  /** Distance between hachure lines (default 4 × strokeWidth). */
  hachureGap?: number;
  /** Angle of hachure lines in degrees (default -41). */
  hachureAngle?: number;
  /** Width of sketch fill lines (default strokeWidth / 2). */
  fillWeight?: number;
  /** Minimum number of points used to approximate ellipses (default 9). */
  curveStepCount?: number;
  /** Keep path vertices exactly in place (only jitter in between). */
  preserveVertices?: boolean;
  /** Draw a single stroke pass instead of the double sketchy pass (used for dashed/dotted). */
  disableMultiStroke?: boolean;
  /** Maximum random offset of vertices in world units (default 2). */
  maxRandomnessOffset?: number;
}

/**
 * A set of path commands with a paint role:
 * - `stroke`: stroked with the element stroke color/width
 * - `fill`: filled with the fill color
 * - `fillSketch`: stroked with the fill color at `fillWeight` (hachure, cross-hatch, zigzag)
 */
export interface DrawOpSet {
  type: 'stroke' | 'fill' | 'fillSketch';
  path: PathCommand[];
}

export interface ResolvedRoughOptions {
  seed: number;
  roughness: number;
  bowing: number;
  strokeWidth: number;
  fillStyle: FillStyle;
  hachureGap: number;
  hachureAngle: number;
  fillWeight: number;
  curveStepCount: number;
  preserveVertices: boolean;
  disableMultiStroke: boolean;
  maxRandomnessOffset: number;
  curveFitting: number;
  curveTightness: number;
}

export function resolveRoughOptions(o: RoughOptions): ResolvedRoughOptions {
  const strokeWidth = Math.max(0, o.strokeWidth);
  const gap =
    o.hachureGap !== undefined && o.hachureGap > 0 ? o.hachureGap : Math.max(strokeWidth, 0.5) * 4;
  return {
    seed: o.seed,
    roughness: Math.max(0, o.roughness),
    bowing: o.bowing ?? 1,
    strokeWidth,
    fillStyle: o.fillStyle,
    hachureGap: Math.max(1, gap),
    hachureAngle: o.hachureAngle ?? -41,
    fillWeight:
      o.fillWeight !== undefined && o.fillWeight > 0
        ? o.fillWeight
        : Math.max(0.5, strokeWidth / 2),
    curveStepCount: Math.max(4, o.curveStepCount ?? 9),
    preserveVertices: o.preserveVertices ?? false,
    disableMultiStroke: o.disableMultiStroke ?? false,
    maxRandomnessOffset: o.maxRandomnessOffset ?? 2,
    curveFitting: 0.95,
    curveTightness: 0,
  };
}

/** Derives an independent, deterministic sub-seed (for parts of one element). */
export function deriveSeed(seed: number, salt: number): number {
  let h = (Math.floor(Math.abs(seed)) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h % 2147483646) + 1;
}
