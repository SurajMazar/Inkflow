import { describe, expect, it } from 'vitest';
import type { PressurePoint } from '@inkflow/elements';
import type { Point } from '@inkflow/geometry';
import { generateElementDrawable, getFreedrawOutline, outlineToPath } from '../src';
import { make } from './fixtures';

function distanceToPolyline(p: Point, pts: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

const opts = { size: 8, thinning: 0.7, smoothing: 0.3, streamline: 0.2, simulatePressure: false, last: true };

describe('getFreedrawOutline', () => {
  it('returns a closed polygon around the stroke', () => {
    const points: PressurePoint[] = Array.from({ length: 40 }, (_, i) => [i * 5, Math.sin(i / 4) * 20, 0.5]);
    const outline = getFreedrawOutline(points, opts);
    expect(outline.length).toBeGreaterThan(40);
    // The polygon wraps around the stroke: first and last outline points are near the start point.
    const first = outline[0]!;
    const last = outline[outline.length - 1]!;
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeLessThan(opts.size);
    // Every outline point is about one radius away from the centerline.
    const center = points.map(([x, y]) => ({ x, y }));
    for (const p of outline) expect(distanceToPolyline(p, center)).toBeLessThan(opts.size);
    const path = outlineToPath(outline);
    expect(path[0]!.type).toBe('M');
    expect(path[path.length - 1]!.type).toBe('Z');
  });

  it('width varies with pressure', () => {
    const points: PressurePoint[] = Array.from({ length: 60 }, (_, i) => [i * 4, 0, i < 30 ? 0.1 : 1]);
    const outline = getFreedrawOutline(points, { ...opts, streamline: 0 });
    const widthNear = (x: number) => {
      const ys = outline.filter((p) => Math.abs(p.x - x) < 3).map((p) => Math.abs(p.y));
      return Math.max(...ys);
    };
    const thin = widthNear(40);
    const thick = widthNear(190);
    expect(thin).toBeGreaterThan(0);
    expect(thick).toBeGreaterThan(thin * 2);
  });

  it('simulated pressure thins fast strokes', () => {
    const slow: PressurePoint[] = Array.from({ length: 80 }, (_, i) => [i * 0.8, 0, 0.5]);
    const fast: PressurePoint[] = Array.from({ length: 80 }, (_, i) => [i * 8, 0, 0.5]);
    const o = { ...opts, simulatePressure: true };
    const maxY = (pts: Point[]) => Math.max(...pts.slice(20, pts.length - 20).map((p) => Math.abs(p.y)));
    expect(maxY(getFreedrawOutline(fast, o))).toBeLessThan(maxY(getFreedrawOutline(slow, o)));
  });

  it('handles single points as dots', () => {
    const outline = getFreedrawOutline([[5, 5, 0.5]], opts);
    expect(outline.length).toBeGreaterThanOrEqual(8);
    for (const p of outline) expect(Math.hypot(p.x - 5, p.y - 5)).toBeCloseTo(opts.size / 2, 5);
  });

  it('renders freedraw elements as filled outlines (never rasters)', () => {
    const pts: PressurePoint[] = Array.from({ length: 30 }, (_, i) => [i * 3, i * 2, 0.5]);
    for (const brush of ['pencil', 'brush', 'highlighter'] as const) {
      const el = make('freedraw', { points: pts, brush, width: 90, height: 60, strokeColor: '#e03131' });
      const d = generateElementDrawable(el);
      const layer = d.layers[d.layers.length - 1]!;
      expect(layer.kind).toBe('shape');
      if (layer.kind !== 'shape') continue;
      expect(layer.fill).toBe('#e03131');
      expect(layer.stroke).toBeNull();
      expect(layer.sets[0]!.type).toBe('fill');
      if (brush === 'highlighter') expect(layer.alpha).toBeLessThan(1);
      else expect(layer.alpha).toBeUndefined();
    }
    const pencil = generateElementDrawable(make('freedraw', { points: pts, brush: 'pencil', strokeWidth: 2 }));
    const brush = generateElementDrawable(make('freedraw', { points: pts, brush: 'brush', strokeWidth: 2 }));
    const w = (d: typeof pencil) => d.localBounds.maxX - d.localBounds.minX;
    expect(w(brush)).toBeGreaterThan(w(pencil));
  });
});
