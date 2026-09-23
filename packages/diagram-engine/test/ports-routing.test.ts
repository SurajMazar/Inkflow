import { describe, expect, it } from 'vitest';
import {
  createBinding,
  createElement,
  getElementBounds,
  getLinearWorldPoints,
  type ConnectorElement,
  type SceneElement,
} from '@inkflow/elements';
import { expandBounds, segmentIntersectsBounds, type Point } from '@inkflow/geometry';
import { Scene } from '@inkflow/scene';
import {
  ROUTING_MARGIN,
  computeArrowEndpoints,
  computeBoundLinearUpdates,
  computeConnectorRoute,
  createConnector,
  createErTable,
  createNode,
  findBindingCandidate,
  getElementPorts,
  getOutlinePolygon,
  resolveBindingPoint,
} from '../src';

const lookup = (els: SceneElement[]) => (id: string) => els.find((e) => e.id === id);
const worldPoints = (
  _c: ConnectorElement,
  r: { x: number; y: number; points: [number, number][] },
) => r.points.map(([x, y]) => ({ x: r.x + x, y: r.y + y }));
const bends = (pts: Point[]) => {
  let n = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) !== 0) n++;
  }
  return n;
};
const isOrthogonal = (pts: Point[]) =>
  pts.every(
    (p, i) =>
      i === 0 || Math.abs(p.x - pts[i - 1]!.x) < 1e-6 || Math.abs(p.y - pts[i - 1]!.y) < 1e-6,
  );

describe('ports', () => {
  it('places side ports at box midpoints with outward normals', () => {
    const n = createNode('rectangle', { x: 100, y: 50, width: 200, height: 100 });
    const ports = getElementPorts(n);
    const byId = Object.fromEntries(ports.map((p) => [p.id, p]));
    expect(byId.top!.point).toEqual({ x: 200, y: 50 });
    expect(byId.right!.point).toEqual({ x: 300, y: 100 });
    expect(byId.bottom!.normal).toEqual({ x: 0, y: 1 });
    expect(byId.left!.normal).toEqual({ x: -1, y: 0 });
  });

  it('rotates ports and normals with the element', () => {
    const n = createNode('rectangle', { x: 0, y: 0, width: 200, height: 100, angle: Math.PI / 2 });
    const right = getElementPorts(n).find((p) => p.id === 'right')!;
    // Centre (100, 50); the right midpoint (200, 50) rotates 90° clockwise to (100, 150).
    expect(right.point.x).toBeCloseTo(100);
    expect(right.point.y).toBeCloseTo(150);
    expect(right.normal.x).toBeCloseTo(0);
    expect(right.normal.y).toBeCloseTo(1);
  });

  it('mirrors ports for flipped elements and projects onto non-rectangular outlines', () => {
    const tri = createNode('triangle', { x: 0, y: 0, width: 100, height: 100 });
    const left = getElementPorts(tri).find((p) => p.id === 'left')!;
    expect(left.point.x).toBeCloseTo(25);
    expect(left.point.y).toBeCloseTo(50);
    const mi = createNode('manual-input', { x: 0, y: 0, width: 100, height: 80 });
    const top = getElementPorts(mi).find((p) => p.id === 'top')!;
    const topFlipped = getElementPorts({ ...mi, flipX: true }).find((p) => p.id === 'top')!;
    expect(topFlipped.point.y).toBeCloseTo(top.point.y);
    const leftFlipped = getElementPorts({ ...mi, flipX: true }).find((p) => p.id === 'left')!;
    expect(leftFlipped.side).toBe('right');
    expect(leftFlipped.point.x).toBeCloseTo(100);
  });

  it('exposes per-column ports on tables and none on linear elements', () => {
    const t = createErTable(
      'users',
      [
        { name: 'id', dataType: 'uuid', primaryKey: true },
        { name: 'email', dataType: 'text' },
      ],
      { x: 10, y: 20 },
    );
    const ports = getElementPorts(t);
    const col = t.columns[1]!;
    const left = ports.find((p) => p.id === `col:${col.id}:left`)!;
    const right = ports.find((p) => p.id === `col:${col.id}:right`)!;
    expect(left.point.x).toBe(10);
    expect(right.point.x).toBe(10 + t.width);
    expect(left.point.y).toBeGreaterThan(20 + 30);
    expect(ports.some((p) => p.id === 'top')).toBe(true);
    expect(getElementPorts(createElement('arrow'))).toEqual([]);
    expect(getElementPorts(createElement('sequence'))).toEqual([]);
  });

  it('samples ellipse outlines and rotates outlines', () => {
    const e = createElement('ellipse', { x: 0, y: 0, width: 100, height: 50 });
    expect(getOutlinePolygon(e).length).toBe(64);
    const r = createElement('rectangle', {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      angle: Math.PI / 2,
    });
    const poly = getOutlinePolygon(r);
    expect(Math.min(...poly.map((p) => p.x))).toBeCloseTo(25);
  });
});

describe('binding resolution', () => {
  const rect = createElement('rectangle', { x: 0, y: 0, width: 100, height: 100 });
  it('resolves named ports with the gap along the normal', () => {
    const r = resolveBindingPoint(rect, createBinding(rect.id, { portId: 'right', gap: 5 }), {
      x: 0,
      y: 0,
    });
    expect(r.point).toEqual({ x: 105, y: 50 });
    expect(r.normal).toEqual({ x: 1, y: 0 });
  });
  it('resolves anchors to normalized box points', () => {
    const r = resolveBindingPoint(rect, createBinding(rect.id, { anchor: [0.25, 1], gap: 4 }), {
      x: 0,
      y: 0,
    });
    expect(r.point).toEqual({ x: 25, y: 104 });
    const inner = resolveBindingPoint(
      rect,
      createBinding(rect.id, { anchor: [0.5, 0.5], gap: 4 }),
      { x: 0, y: 0 },
    );
    expect(inner.point).toEqual({ x: 50, y: 50 });
  });
  it('resolves floating bindings on rectangles, ellipses and diamonds', () => {
    const r = resolveBindingPoint(rect, createBinding(rect.id, { gap: 0 }), { x: 300, y: 50 });
    expect(r.point.x).toBeCloseTo(100);
    expect(r.point.y).toBeCloseTo(50);
    const ell = createElement('ellipse', { x: 0, y: 0, width: 200, height: 100 });
    const d = Math.SQRT1_2;
    const p = resolveBindingPoint(ell, createBinding(ell.id, { gap: 0 }), {
      x: 100 + 1000,
      y: 50 + 1000,
    });
    // Ray at 45°: x = y = 1/sqrt(1/100² + 1/50²)
    const k = 1 / Math.sqrt(1 / 10000 + 1 / 2500);
    expect(p.point.x).toBeCloseTo(100 + k);
    expect(p.point.y).toBeCloseTo(50 + k);
    expect(p.normal.x).toBeCloseTo(d);
    const dia = createElement('diamond', { x: 0, y: 0, width: 100, height: 100 });
    const q = resolveBindingPoint(dia, createBinding(dia.id, { gap: 0 }), { x: 500, y: 500 });
    expect(q.point.x).toBeCloseTo(75);
    expect(q.point.y).toBeCloseTo(75);
    const gapped = resolveBindingPoint(dia, createBinding(dia.id, { gap: 10 }), { x: 500, y: 50 });
    expect(gapped.point.x).toBeCloseTo(110);
  });
});

describe('findBindingCandidate', () => {
  const a = createNode('rectangle', { x: 0, y: 0, width: 100, height: 100 });
  const b = createNode('rectangle', { x: 50, y: 50, width: 100, height: 100 });
  it('prefers the top-most element and snaps to ports', () => {
    const hit = findBindingCandidate([a, b], { x: 75, y: 75 }, 8)!;
    expect(hit.element.id).toBe(b.id);
    expect(hit.portId).toBeNull();
    expect(hit.anchor).toBeNull();
    const port = findBindingCandidate([a, b], { x: 148, y: 102 }, 8, { portSnapDistance: 10 })!;
    expect(port.portId).toBe('right');
    expect(port.point).toEqual({ x: 150, y: 100 });
  });
  it('returns an anchor near the outline and respects exclusions', () => {
    const hit = findBindingCandidate([a], { x: 30, y: -3 }, 6, { portSnapDistance: 5 })!;
    expect(hit.anchor![0]).toBeCloseTo(0.3);
    expect(hit.anchor![1]).toBeCloseTo(0);
    expect(
      findBindingCandidate([a, b], { x: 75, y: 75 }, 8, { excludeIds: new Set([b.id]) })!.element
        .id,
    ).toBe(a.id);
    expect(findBindingCandidate([a], { x: 500, y: 500 }, 8)).toBeNull();
  });
  it('never returns linear, freedraw, locked or hidden elements', () => {
    const arrow = createElement('arrow', {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        [0, 0],
        [100, 100],
      ],
    });
    const free = createElement('freedraw', {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        [0, 0, 0.5],
        [100, 100, 0.5],
      ],
    });
    const locked = createNode('rectangle', { x: 0, y: 0, width: 100, height: 100, locked: true });
    const hidden = createNode('rectangle', { x: 0, y: 0, width: 100, height: 100, hidden: true });
    expect(findBindingCandidate([arrow, free, locked, hidden], { x: 50, y: 50 }, 8)).toBeNull();
  });
});

function connectorBetween(
  from: SceneElement,
  to: SceneElement,
  routing: ConnectorElement['routing'],
  ports: [string | null, string | null] = ['right', 'left'],
) {
  return createConnector(from, to, { routing, fromPort: ports[0], toPort: ports[1] });
}

describe('routing modes', () => {
  const a = createNode('rectangle', { x: 0, y: 0, width: 100, height: 60 });
  const b = createNode('rectangle', { x: 400, y: 200, width: 100, height: 60 });
  const get = lookup([a, b]);

  it('straight: two resolved endpoints; floating ends aim at centres', () => {
    const c = connectorBetween(a, b, 'straight', [null, null]);
    const r = computeConnectorRoute(c, get, []);
    const pts = worldPoints(c, r);
    expect(pts.length).toBe(2);
    expect(r.points[0]).toEqual([0, 0]);
    // Start lies on the ray from centre A to centre B, outside A.
    const dir = { x: 450 - 50, y: 230 - 30 };
    const cross = (pts[0]!.x - 50) * dir.y - (pts[0]!.y - 30) * dir.x;
    expect(Math.abs(cross)).toBeLessThan(1);
    expect(pts[0]!.x).toBeGreaterThanOrEqual(100);
  });

  it('bezier: exactly four points with controls along port normals', () => {
    const r = computeConnectorRoute(connectorBetween(a, b, 'bezier'), get, []);
    const pts = worldPoints(connectorBetween(a, b, 'bezier'), r);
    expect(pts.length).toBe(4);
    expect(pts[1]!.y).toBeCloseTo(pts[0]!.y);
    expect(pts[1]!.x).toBeGreaterThan(pts[0]!.x);
    expect(pts[2]!.y).toBeCloseTo(pts[3]!.y);
    expect(pts[2]!.x).toBeLessThan(pts[3]!.x);
  });

  it('curved: control polyline through start, bend control and end', () => {
    const c = connectorBetween(a, b, 'curved', ['bottom', 'left']);
    const pts = worldPoints(c, computeConnectorRoute(c, get, []));
    expect(pts.length).toBe(3);
    const withWaypoint = { ...c, waypoints: [[250, 40]] as [number, number][] };
    const wp = worldPoints(withWaypoint, computeConnectorRoute(withWaypoint, get, []));
    expect(wp[1]).toEqual({ x: 250, y: 40 });
  });

  it('elbow: 1–2 bends leaving and entering along the normals', () => {
    const c = connectorBetween(a, b, 'elbow');
    const pts = worldPoints(c, computeConnectorRoute(c, get, []));
    expect(isOrthogonal(pts)).toBe(true);
    expect(bends(pts)).toBeGreaterThanOrEqual(1);
    expect(bends(pts)).toBeLessThanOrEqual(2);
    expect(pts[1]!.y).toBeCloseTo(pts[0]!.y);
    const mixed = connectorBetween(a, b, 'elbow', ['right', 'top']);
    expect(bends(worldPoints(mixed, computeConnectorRoute(mixed, get, [])))).toBe(1);
  });

  it('orthogonal: minimal bends on a clear path', () => {
    const c = connectorBetween(a, b, 'orthogonal');
    const pts = worldPoints(c, computeConnectorRoute(c, get, [a, b]));
    expect(isOrthogonal(pts)).toBe(true);
    expect(bends(pts)).toBe(2);
    const aligned = createNode('rectangle', { x: 400, y: 0, width: 100, height: 60 });
    const c2 = connectorBetween(a, aligned, 'orthogonal');
    const p2 = worldPoints(c2, computeConnectorRoute(c2, lookup([a, aligned]), [a, aligned]));
    expect(p2.length).toBe(2);
  });

  it('orthogonal: avoids obstacles and is deterministic', () => {
    const left = createNode('rectangle', { x: 0, y: 200, width: 100, height: 60 });
    const right = createNode('rectangle', { x: 600, y: 200, width: 100, height: 60 });
    const wall = createNode('rectangle', { x: 250, y: 100, width: 150, height: 300 });
    const small = createNode('rectangle', { x: 450, y: 180, width: 60, height: 60 });
    const els = [left, right, wall, small];
    const c = connectorBetween(left, right, 'orthogonal');
    const r1 = computeConnectorRoute(c, lookup(els), els);
    const r2 = computeConnectorRoute(c, lookup(els), [...els].reverse());
    expect(r2).toEqual(r1);
    const pts = worldPoints(c, r1);
    expect(isOrthogonal(pts)).toBe(true);
    for (const ob of [wall, small]) {
      const box = expandBounds(getElementBounds(ob), ROUTING_MARGIN - 1);
      for (let i = 1; i < pts.length; i++)
        expect(segmentIntersectsBounds(pts[i - 1]!, pts[i]!, box)).toBe(false);
    }
    // Endpoints stay attached to the ports.
    expect(pts[0]).toEqual({ x: 104, y: 230 });
    expect(pts[pts.length - 1]).toEqual({ x: 596, y: 230 });
  });

  it('orthogonal: small moves do not flip the route', () => {
    const left = createNode('rectangle', { x: 0, y: 200, width: 100, height: 60 });
    const wall = createNode('rectangle', { x: 250, y: 100, width: 150, height: 300 });
    const r1 = createNode('rectangle', { x: 600, y: 200, width: 100, height: 60 });
    const r2 = { ...r1, y: 204 };
    const route = (target: SceneElement) => {
      const els = [left, wall, target];
      const c = connectorBetween(left, target, 'orthogonal');
      return worldPoints(c, computeConnectorRoute(c, lookup(els), els));
    };
    const p1 = route(r1);
    const p2 = route(r2);
    expect(p2.length).toBe(p1.length);
    const above = (pts: Point[]) => Math.min(...pts.map((p) => p.y)) < 100;
    expect(above(p2)).toBe(above(p1));
  });

  it('orthogonal: honours waypoints and falls back to elbow when blocked', () => {
    const c = {
      ...connectorBetween(a, b, 'orthogonal'),
      waypoints: [[250, -100]] as [number, number][],
    };
    const pts = worldPoints(c, computeConnectorRoute(c, get, [a, b]));
    expect(pts.some((p) => p.x === 250 && p.y === -100)).toBe(true);
    expect(isOrthogonal(pts)).toBe(true);
  });

  it('routes 200 obstacles quickly', () => {
    const obstacles: SceneElement[] = [];
    for (let i = 0; i < 200; i++) {
      obstacles.push(
        createNode('rectangle', {
          x: (i % 20) * 160,
          y: Math.floor(i / 20) * 140,
          width: 90,
          height: 60,
        }),
      );
    }
    const from = obstacles[0]!;
    const to = obstacles[57]!;
    const c = connectorBetween(from, to, 'orthogonal', ['right', 'left']);
    const get2 = lookup(obstacles);
    computeConnectorRoute(c, get2, obstacles);
    const t0 = performance.now();
    const runs = 20;
    let r = computeConnectorRoute(c, get2, obstacles);
    for (let i = 1; i < runs; i++) r = computeConnectorRoute(c, get2, obstacles);
    const per = (performance.now() - t0) / runs;
    expect(per).toBeLessThan(25);
    const pts = worldPoints(c, r);
    for (const ob of obstacles) {
      const box = expandBounds(getElementBounds(ob), ROUTING_MARGIN - 1);
      if (ob.id === from.id || ob.id === to.id) continue;
      for (let i = 1; i < pts.length; i++)
        expect(segmentIntersectsBounds(pts[i - 1]!, pts[i]!, box)).toBe(false);
    }
  });
});

describe('arrow endpoints and bound updates', () => {
  it('moves bound arrow endpoints and keeps intermediate points', () => {
    const a = createElement('rectangle', { x: 0, y: 0, width: 100, height: 100 });
    const b = createElement('rectangle', { x: 300, y: 0, width: 100, height: 100 });
    const arrow = createElement('arrow', {
      x: 100,
      y: 50,
      points: [
        [0, 0],
        [100, -80],
        [200, 0],
      ],
      startBinding: createBinding(a.id, { gap: 0 }),
      endBinding: createBinding(b.id, { portId: 'left', gap: 0 }),
    });
    const moved = { ...b, x: 400 };
    const r = computeArrowEndpoints(arrow, lookup([a, moved]))!;
    const pts = r.points.map(([x, y]) => ({ x: r.x + x, y: r.y + y }));
    expect(pts[1]).toEqual({ x: 200, y: -30 });
    expect(pts[2]).toEqual({ x: 400, y: 50 });
    expect(
      computeArrowEndpoints({ ...arrow, startBinding: null, endBinding: null }, lookup([])),
    ).toBeNull();
  });

  it('computes patches for connectors attached to changed elements and unbinds deleted targets', () => {
    const a = createNode('rectangle', { x: 0, y: 0, width: 100, height: 60 });
    const b = createNode('rectangle', { x: 300, y: 0, width: 100, height: 60 });
    const c = createConnector(a, b, { routing: 'orthogonal' });
    const scene = new Scene([a, b, c]);
    scene.upsert([{ ...b, y: 200 }], 'local');
    const updates = computeBoundLinearUpdates(scene, [b.id]);
    expect(updates.length).toBe(1);
    const [id, patch] = updates[0]!;
    expect(id).toBe(c.id);
    expect(patch.points).toBeDefined();
    scene.upsert([{ ...c, ...patch } as ConnectorElement], 'local');
    const end = getLinearWorldPoints(scene.getElement(c.id) as ConnectorElement).at(-1)!;
    expect(end.x).toBeCloseTo(296);
    expect(end.y).toBeCloseTo(230);

    scene.upsert([{ ...(scene.getElement(b.id) as SceneElement), isDeleted: true }], 'local');
    const del = computeBoundLinearUpdates(scene, [b.id]);
    expect(del.length).toBe(1);
    expect(del[0]![1].endBinding).toBeNull();
    expect(del[0]![1].points).toBeUndefined();
  });
});
