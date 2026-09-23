import { describe, expect, it } from 'vitest';
import {
  ellipsePath,
  polygonPath,
  roundedRectPath,
  starPoints,
  type Path,
  type PathCommand,
  type Point,
} from '@inkflow/geometry';
import {
  hachureLines,
  pointInPolygons,
  roughEllipse,
  roughLine,
  roughPath,
  zigzagLines,
  type RoughOptions,
} from '../src';

const base = (o: Partial<RoughOptions> = {}): RoughOptions => ({
  seed: 42,
  roughness: 1,
  strokeWidth: 2,
  fillStyle: 'hachure',
  ...o,
});

const rect: Point[] = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 120 },
  { x: 0, y: 120 },
];

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function distToRings(p: Point, rings: Point[][]): number {
  let d = Infinity;
  for (const r of rings)
    for (let i = 0; i < r.length; i++)
      d = Math.min(d, distToSegment(p, r[i]!, r[(i + 1) % r.length]!));
  return d;
}

/** Inside (even-odd) or on the boundary within `tol`. */
function insideOrOn(p: Point, rings: Point[][], tol: number): boolean {
  return pointInPolygons(p, rings) || distToRings(p, rings) <= tol;
}

function endpoints(path: PathCommand[]): Point[] {
  const out: Point[] = [];
  for (const c of path) if (c.type !== 'Z') out.push({ x: c.x, y: c.y });
  return out;
}

describe('rough generator determinism', () => {
  const path: Path = polygonPath(rect);

  it('produces identical op sets for the same seed', () => {
    const a = roughPath(path, base(), true);
    const b = roughPath(path, base(), true);
    expect(a).toEqual(b);
    expect(roughEllipse(50, 40, 100, 80, base(), true)).toEqual(
      roughEllipse(50, 40, 100, 80, base(), true),
    );
    expect(roughLine(0, 0, 100, 30, base())).toEqual(roughLine(0, 0, 100, 30, base()));
  });

  it('produces different op sets for different seeds', () => {
    const a = roughPath(path, base({ seed: 1 }), true);
    const b = roughPath(path, base({ seed: 2 }), true);
    expect(a).not.toEqual(b);
    expect(roughEllipse(50, 40, 100, 80, base({ seed: 1 }), false)).not.toEqual(
      roughEllipse(50, 40, 100, 80, base({ seed: 2 }), false),
    );
  });

  it('keeps the outline stable when a fill is added', () => {
    const stroked = roughPath(path, base(), false);
    const filled = roughPath(path, base(), true);
    expect(filled[filled.length - 1]).toEqual(stroked[0]);
  });

  it('never uses Math.random', () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error('Math.random used');
    };
    try {
      roughPath(path, base({ fillStyle: 'cross-hatch' }), true);
      roughEllipse(0, 0, 50, 50, base({ fillStyle: 'zigzag' }), true);
    } finally {
      Math.random = original;
    }
  });
});

describe('roughness 0', () => {
  it('returns the exact geometry for paths', () => {
    const path = polygonPath(rect);
    const [stroke] = roughPath(path, base({ roughness: 0 }), false);
    expect(stroke!.type).toBe('stroke');
    expect(stroke!.path).toEqual(path);
    const rounded = roundedRectPath(0, 0, 100, 60, 12);
    expect(roughPath(rounded, base({ roughness: 0 }), false)[0]!.path).toEqual(rounded);
  });

  it('returns exact ellipses and lines', () => {
    const sets = roughEllipse(50, 30, 100, 60, base({ roughness: 0 }), false);
    expect(sets[0]!.path).toEqual(ellipsePath(50, 30, 50, 30));
    expect(roughLine(1, 2, 3, 4, base({ roughness: 0 })).path).toEqual([
      { type: 'M', x: 1, y: 2 },
      { type: 'L', x: 3, y: 4 },
    ]);
  });

  it('solid fill of an exact shape is the closed outline', () => {
    const path = polygonPath(rect);
    const sets = roughPath(path, base({ roughness: 0, fillStyle: 'solid' }), true);
    expect(sets.map((s) => s.type)).toEqual(['fill', 'stroke']);
    expect(sets[0]!.path).toEqual(path);
  });
});

describe('sketchy strokes', () => {
  it('draws a double stroke for solid lines and a single pass when multi-stroke is disabled', () => {
    const double = roughLine(0, 0, 100, 0, base());
    const single = roughLine(0, 0, 100, 0, base({ disableMultiStroke: true }));
    expect(double.path.filter((c) => c.type === 'M')).toHaveLength(2);
    expect(single.path.filter((c) => c.type === 'M')).toHaveLength(1);
  });

  it('keeps jitter bounded by roughness', () => {
    const line = roughLine(0, 0, 300, 0, base({ roughness: 1 }));
    const wild = roughLine(0, 0, 300, 0, base({ roughness: 2 }));
    const maxDev = (s: { path: PathCommand[] }) =>
      Math.max(...endpoints(s.path).map((p) => Math.abs(p.y)));
    expect(maxDev(line)).toBeLessThan(6);
    expect(maxDev(line)).toBeGreaterThan(0);
    expect(maxDev(wild)).toBeLessThan(12);
  });

  it('preserveVertices keeps segment endpoints in place', () => {
    const set = roughLine(10, 10, 110, 60, base({ preserveVertices: true }));
    const pts = endpoints(set.path);
    expect(pts[0]).toEqual({ x: 10, y: 10 });
    expect(pts[pts.length - 1]).toEqual({ x: 110, y: 60 });
  });
});

describe('hachure fills', () => {
  it('uses a gap of about 4 × strokeWidth', () => {
    const lines = hachureLines([rect], 8, 0);
    const ys = [...new Set(lines.map(([a]) => Math.round(a.y * 1000) / 1000))].sort(
      (a, b) => a - b,
    );
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeCloseTo(8, 6);
    // Default gap from strokeWidth 2 → 8
    const [fill] = roughPath(polygonPath(rect), base({ roughness: 0, hachureAngle: 0 }), true);
    const moves = fill!.path.filter((c) => c.type === 'M').map((c) => (c as { y: number }).y);
    const sorted = [...new Set(moves.map((y) => Math.round(y * 1000) / 1000))].sort(
      (a, b) => a - b,
    );
    expect(sorted[1]! - sorted[0]!).toBeCloseTo(8, 6);
  });

  it('stays within a concave polygon', () => {
    const star = starPoints(0, 0, 200, 200, 5, 0.4);
    for (const angle of [-41, 0, 45, 90]) {
      for (const [a, b] of hachureLines([star], 6, angle)) {
        expect(insideOrOn(a, [star], 1e-6)).toBe(true);
        expect(insideOrOn(b, [star], 1e-6)).toBe(true);
        expect(pointInPolygons({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, [star])).toBe(true);
      }
    }
  });

  it('keeps sketchy hachure endpoints on the outline and control points close', () => {
    const star = starPoints(0, 0, 200, 200, 5, 0.4);
    const sets = roughPath(polygonPath(star), base({ roughness: 1, strokeWidth: 2 }), true);
    const sketch = sets.find((s) => s.type === 'fillSketch')!;
    expect(sketch.path.length).toBeGreaterThan(10);
    for (const c of sketch.path) {
      if (c.type === 'M' || c.type === 'C')
        expect(insideOrOn({ x: c.x, y: c.y }, [star], 1e-6)).toBe(true);
      if (c.type === 'C') {
        expect(insideOrOn({ x: c.x1, y: c.y1 }, [star], 4)).toBe(true);
        expect(insideOrOn({ x: c.x2, y: c.y2 }, [star], 4)).toBe(true);
      }
    }
  });

  it('respects holes (even-odd)', () => {
    const hole: Point[] = [
      { x: 50, y: 30 },
      { x: 150, y: 30 },
      { x: 150, y: 90 },
      { x: 50, y: 90 },
    ];
    const lines = hachureLines([rect, hole], 5, -41);
    expect(lines.length).toBeGreaterThan(0);
    for (const [a, b] of lines) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      expect(pointInPolygons(mid, [rect, hole])).toBe(true);
      const insideHole = mid.x > 50 && mid.x < 150 && mid.y > 30 && mid.y < 90;
      expect(insideHole).toBe(false);
    }
    // Path with a hole subpath → sketch fill skips the hole.
    const path: Path = [...polygonPath(rect), ...polygonPath(hole)];
    const sketch = roughPath(path, base({ roughness: 0 }), true)[0]!;
    const segs = sketch.path;
    for (let i = 0; i + 1 < segs.length; i += 2) {
      const a = segs[i] as { x: number; y: number };
      const b = segs[i + 1] as { x: number; y: number };
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      expect(mid.x > 50.5 && mid.x < 149.5 && mid.y > 30.5 && mid.y < 89.5).toBe(false);
    }
  });

  it('cross-hatch draws two line families and zigzag stays inside', () => {
    const cross = roughPath(
      polygonPath(rect),
      base({ roughness: 0, fillStyle: 'cross-hatch', hachureAngle: 0 }),
      true,
    )[0]!;
    const segs: [Point, Point][] = [];
    for (let i = 0; i + 1 < cross.path.length; i += 2) {
      const a = cross.path[i] as Point;
      const b = cross.path[i + 1] as Point;
      segs.push([a, b]);
    }
    const horizontal = segs.filter(([a, b]) => Math.abs(a.y - b.y) < 1e-6).length;
    const vertical = segs.filter(([a, b]) => Math.abs(a.x - b.x) < 1e-6).length;
    expect(horizontal).toBeGreaterThan(5);
    expect(vertical).toBeGreaterThan(5);

    const ring = starPoints(0, 0, 160, 160, 6, 0.5);
    const zig = zigzagLines([ring], 8, -41);
    expect(zig.length).toBeGreaterThan(5);
    for (const [a, b] of zig) {
      expect(insideOrOn(a, [ring], 1e-6)).toBe(true);
      expect(insideOrOn(b, [ring], 1e-6)).toBe(true);
    }
  });

  it('fills ellipses with hachure inside the jittered outline area', () => {
    const sets = roughEllipse(100, 60, 200, 120, base(), true);
    expect(sets.map((s) => s.type)).toEqual(['fillSketch', 'stroke']);
    for (const c of sets[0]!.path) {
      if (c.type === 'M' || c.type === 'C') {
        const nx = (c.x - 100) / 100;
        const ny = (c.y - 60) / 60;
        expect(nx * nx + ny * ny).toBeLessThan(1.15);
      }
    }
  });
});
