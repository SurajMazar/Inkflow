import { describe, expect, it } from 'vitest';
import {
  SeededRandom,
  SpatialIndex,
  applyMatrix,
  boundsContain,
  boundsIntersect,
  distanceToEllipseOutline,
  distanceToSegment,
  invert,
  multiply,
  pointAlongPolyline,
  pointInPolygon,
  rotatePoint,
  rotatedRectBounds,
  rotationAround,
  segmentIntersection,
  simplifyRDP,
  snapAngle,
  starPoints,
  regularPolygonPoints,
  convexHull,
  ellipseRayIntersection,
} from '../src';

describe('vectors & matrices', () => {
  it('rotates points around a center', () => {
    const p = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });

  it('inverts affine matrices', () => {
    const m = multiply(rotationAround(0.7, { x: 5, y: 3 }), [2, 0, 0, 3, 10, -4]);
    const p = { x: 12.5, y: -7 };
    const back = applyMatrix(invert(m), applyMatrix(m, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it('snaps angles within threshold only', () => {
    const step = Math.PI / 12;
    expect(snapAngle(step * 3 + 0.01, step, 0.05)).toBeCloseTo(step * 3);
    expect(snapAngle(step * 3 + 0.1, step, 0.05)).toBeCloseTo(step * 3 + 0.1);
  });
});

describe('bounds', () => {
  it('computes rotated rect bounds', () => {
    const b = rotatedRectBounds({ x: 0, y: 0, width: 100, height: 0 }, Math.PI / 2);
    expect(b.minX).toBeCloseTo(50);
    expect(b.maxX).toBeCloseTo(50);
    expect(b.minY).toBeCloseTo(-50);
    expect(b.maxY).toBeCloseTo(50);
  });

  it('tests intersection & containment', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(boundsIntersect(a, { minX: 5, minY: 5, maxX: 20, maxY: 20 })).toBe(true);
    expect(boundsIntersect(a, { minX: 11, minY: 0, maxX: 20, maxY: 10 })).toBe(false);
    expect(boundsContain(a, { minX: 1, minY: 1, maxX: 9, maxY: 9 })).toBe(true);
  });
});

describe('segments & polygons', () => {
  it('finds segment intersections', () => {
    const p = segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 });
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(5);
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });

  it('measures distance to segments', () => {
    expect(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5);
    expect(distanceToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5);
  });

  it('checks point in polygon', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
  });

  it('generates regular polygons and stars', () => {
    expect(regularPolygonPoints(0, 0, 100, 100, 6)).toHaveLength(6);
    const star = starPoints(0, 0, 100, 100, 5, 0.5);
    expect(star).toHaveLength(10);
    expect(star[0]!.y).toBeCloseTo(0);
  });

  it('computes convex hull', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    expect(hull).toHaveLength(4);
  });

  it('walks along a polyline', () => {
    const r = pointAlongPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      0.75,
    );
    expect(r.point.x).toBeCloseTo(10);
    expect(r.point.y).toBeCloseTo(5);
  });
});

describe('ellipse', () => {
  it('measures distance to the outline', () => {
    expect(distanceToEllipseOutline({ x: 0, y: 0 }, { x: 0, y: 0 }, 10, 5)).toBeCloseTo(5, 1);
    expect(distanceToEllipseOutline({ x: 20, y: 0 }, { x: 0, y: 0 }, 10, 5)).toBeCloseTo(10, 1);
  });

  it('intersects rays with the outline', () => {
    const p = ellipseRayIntersection({ x: 0, y: 0 }, 10, 5, { x: 0, y: 100 });
    expect(p.y).toBeCloseTo(5);
  });
});

describe('simplification', () => {
  it('removes collinear points', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyRDP(pts, 0.5)).toHaveLength(2);
  });
});

describe('SeededRandom', () => {
  it('is deterministic', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
    seqA.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    });
  });
});

describe('SpatialIndex', () => {
  it('finds intersecting entries and handles updates', () => {
    const idx = new SpatialIndex(100);
    idx.insert('a', { minX: 0, minY: 0, maxX: 50, maxY: 50 });
    idx.insert('b', { minX: 500, minY: 500, maxX: 550, maxY: 550 });
    idx.insert('huge', { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 });
    expect(idx.search({ minX: 10, minY: 10, maxX: 20, maxY: 20 }).sort()).toEqual(['a', 'huge']);
    idx.update('a', { minX: 1000, minY: 1000, maxX: 1010, maxY: 1010 });
    expect(idx.search({ minX: 10, minY: 10, maxX: 20, maxY: 20 })).toEqual(['huge']);
    idx.remove('huge');
    expect(idx.searchPoint(1005, 1005)).toEqual(['a']);
    expect(idx.size).toBe(2);
  });

  it('scales to many entries', () => {
    const idx = new SpatialIndex(256);
    for (let i = 0; i < 20000; i++) {
      const x = (i % 200) * 60;
      const y = Math.floor(i / 200) * 60;
      idx.insert(String(i), { minX: x, minY: y, maxX: x + 40, maxY: y + 40 });
    }
    const hits = idx.search({ minX: 0, minY: 0, maxX: 119, maxY: 119 });
    expect(hits.sort()).toEqual(['0', '1', '200', '201']);
  });
});

import { parseSvgPath, pathBounds, pathToSvg, flattenPath, roundedRectPath } from '../src';

describe('paths', () => {
  it('parses relative/absolute commands and arcs', () => {
    const p = parseSvgPath('M10 10 h 20 v20 H10 Z m 50 0 a 10 10 0 1 0 20 0 a 10 10 0 1 0 -20 0 q 5 5 10 0 t 10 0');
    expect(p[0]).toEqual({ type: 'M', x: 10, y: 10 });
    expect(p[1]).toEqual({ type: 'L', x: 30, y: 10 });
    const b = pathBounds(p);
    expect(b.minX).toBeCloseTo(10);
    expect(b.maxX).toBeGreaterThan(79);
    expect(pathToSvg(p)).toContain('C');
  });

  it('rejects malformed data', () => {
    expect(() => parseSvgPath('M 10')).toThrow();
  });

  it('flattens rounded rectangles into closed subpaths', () => {
    const sub = flattenPath(roundedRectPath(0, 0, 100, 50, 10));
    expect(sub).toHaveLength(1);
    expect(sub[0]!.closed).toBe(true);
  });
});
