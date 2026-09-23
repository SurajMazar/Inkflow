import {
  getElementBounds,
  getElementCenter,
  getLinearWorldPoints,
  isLinearElement,
  normalizeLinearPoints,
  toElementSpace,
  type ArrowElement,
  type Binding,
  type ConnectorElement,
  type ElementPatch,
  type LinearElement,
  type LocalPoint,
  type SceneElement,
} from '@inkflow/elements';
import { boundsIntersect, expandBounds, unionBounds, type Bounds, type Point } from '@inkflow/geometry';
import type { Scene } from '@inkflow/scene';
import { getElementPorts, resolveBindingPoint, sideForDirection } from '../ports';
import { CONTAINER_SHAPE_KEYS } from '../shapes/catalog';
import { dirIndex, dirVector, findOrthogonalPath, simplifyOrthogonal } from './orthogonal';

export type RouteResult = { x: number; y: number; width: number; height: number; points: LocalPoint[] };

/** Clearance kept between orthogonal routes and obstacles. */
export const ROUTING_MARGIN = 16;
/** Cost of a bend in orthogonal routing, in units of path length. */
export const ROUTING_BEND_PENALTY = 36;

type GetElement = (id: string) => SceneElement | undefined;

interface Endpoint {
  point: Point;
  /** Outward unit normal at the attachment (null for free endpoints). */
  normal: Point | null;
  target: SceneElement | null;
  /** True when the attachment depends on the opposite end (floating binding). */
  floating: boolean;
}

const round = (v: number) => Math.round(v * 100) / 100;

function liveTarget(binding: Binding | null, getElement: GetElement): SceneElement | null {
  if (!binding) return null;
  const el = getElement(binding.elementId);
  return el && !el.isDeleted ? el : null;
}

function hasFixedAttachment(binding: Binding, target: SceneElement): boolean {
  if (binding.anchor) return true;
  if (binding.portId) return getElementPorts(target).some((p) => p.id === binding.portId);
  return false;
}

/** Side port facing `toward`, judged in the target's own frame relative to its aspect ratio. */
function facingSideAttachment(target: SceneElement, toward: Point, gap: number): { point: Point; normal: Point } {
  const c = getElementCenter(target);
  const local = toElementSpace(target, toward);
  const dx = (local.x - c.x) / Math.max(target.width, 1);
  const dy = (local.y - c.y) / Math.max(target.height, 1);
  let side = sideForDirection({ x: dx, y: dy });
  if (target.flipX && (side === 'left' || side === 'right')) side = side === 'left' ? 'right' : 'left';
  if (target.flipY && (side === 'top' || side === 'bottom')) side = side === 'top' ? 'bottom' : 'top';
  const ports = getElementPorts(target);
  let port = ports.find((p) => p.id === side);
  if (!port) {
    const dir = { x: toward.x - c.x, y: toward.y - c.y };
    let best = -Infinity;
    for (const p of ports) {
      const d = p.normal.x * dir.x + p.normal.y * dir.y;
      if (d > best) {
        best = d;
        port = p;
      }
    }
  }
  if (!port) return resolveBindingPoint(target, { elementId: target.id, portId: null, anchor: null, gap }, toward);
  return { point: { x: port.point.x + port.normal.x * gap, y: port.point.y + port.normal.y * gap }, normal: port.normal };
}

/**
 * Resolves both endpoints. Fixed attachments (ports, anchors) resolve first; floating ends then aim
 * at the nearest waypoint, the opposite fixed point, or the opposite target's centre. With
 * `sideAttach` (orthogonal/elbow routing) floating ends snap to the side port facing that point.
 */
function resolveEndpoints(
  linear: LinearElement,
  getElement: GetElement,
  waypoints: readonly Point[],
  sideAttach: boolean,
): [Endpoint, Endpoint] {
  const world = getLinearWorldPoints(linear);
  const rawStart = world[0] ?? { x: linear.x, y: linear.y };
  const rawEnd = world[world.length - 1] ?? rawStart;
  const bindings = [linear.startBinding, linear.endBinding] as const;
  const targets = [liveTarget(bindings[0], getElement), liveTarget(bindings[1], getElement)] as const;
  const out: (Endpoint | null)[] = [null, null];
  for (let k = 0; k < 2; k++) {
    const b = bindings[k];
    const t = targets[k];
    if (!b || !t) out[k] = { point: k === 0 ? rawStart : rawEnd, normal: null, target: null, floating: false };
    else if (hasFixedAttachment(b, t)) {
      const r = resolveBindingPoint(t, b, getElementCenter(t));
      out[k] = { point: r.point, normal: r.normal, target: t, floating: false };
    }
  }
  for (let k = 0; k < 2; k++) {
    if (out[k]) continue;
    const b = bindings[k]!;
    const t = targets[k]!;
    const other = out[1 - k];
    const otherTarget = targets[1 - k];
    const toward =
      (k === 0 ? waypoints[0] : waypoints[waypoints.length - 1]) ??
      (other && !other.floating ? other.point : otherTarget ? getElementCenter(otherTarget) : k === 0 ? rawEnd : rawStart);
    const r = sideAttach ? facingSideAttachment(t, toward, b.gap) : resolveBindingPoint(t, b, toward);
    out[k] = { point: r.point, normal: r.normal, target: t, floating: true };
  }
  return [out[0]!, out[1]!];
}

function toResult(points: readonly Point[]): RouteResult {
  const clean: Point[] = [];
  for (const p of points) {
    const q = { x: round(p.x), y: round(p.y) };
    const last = clean[clean.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) clean.push(q);
  }
  if (clean.length === 1) clean.push({ ...clean[0]! });
  const n = normalizeLinearPoints(
    0,
    0,
    clean.map((p) => [p.x, p.y] as LocalPoint),
  );
  return { x: round(n.x), y: round(n.y), width: round(n.width), height: round(n.height), points: n.points.map(([x, y]) => [round(x), round(y)]) };
}

const axisOf = (n: Point | null, from: Point, to: Point): Point => {
  if (n && (Math.abs(n.x) > 1e-9 || Math.abs(n.y) > 1e-9)) return dirVector(dirIndex(n));
  return dirVector(dirIndex({ x: to.x - from.x, y: to.y - from.y }));
};

/**
 * Orthogonal path with one or two bends between `a` (leaving along `da`) and `b` (entered against
 * `db`, i.e. `db` is b's outward normal). No obstacle avoidance.
 */
export function elbowPath(a: Point, da: Point | null, b: Point, db: Point | null, stub = 20): Point[] {
  const sa = axisOf(da, a, b);
  const sb = axisOf(db, b, a);
  const hA = sa.x !== 0;
  const hB = sb.x !== 0;
  if (hA && hB) {
    if (Math.abs(a.y - b.y) < 0.5 && Math.sign(b.x - a.x) === sa.x) return [a, b];
    let mx = (a.x + b.x) / 2;
    if (sa.x === sb.x) mx = sa.x > 0 ? Math.max(a.x, b.x) + stub : Math.min(a.x, b.x) - stub;
    return simplifyOrthogonal([a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]);
  }
  if (!hA && !hB) {
    if (Math.abs(a.x - b.x) < 0.5 && Math.sign(b.y - a.y) === sa.y) return [a, b];
    let my = (a.y + b.y) / 2;
    if (sa.y === sb.y) my = sa.y > 0 ? Math.max(a.y, b.y) + stub : Math.min(a.y, b.y) - stub;
    return simplifyOrthogonal([a, { x: a.x, y: my }, { x: b.x, y: my }, b]);
  }
  return simplifyOrthogonal(hA ? [a, { x: b.x, y: a.y }, b] : [a, { x: a.x, y: b.y }, b]);
}

function elbowThrough(start: Endpoint, end: Endpoint, waypoints: readonly Point[]): Point[] {
  const stops = [start.point, ...waypoints, end.point];
  const out: Point[] = [start.point];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    const da = i === 0 ? start.normal : null;
    const db = i === stops.length - 2 ? end.normal : null;
    out.push(...elbowPath(a, da, b, db).slice(1));
  }
  return simplifyOrthogonal(out);
}

function isObstacleCandidate(el: SceneElement, exclude: ReadonlySet<string>): boolean {
  return (
    !el.isDeleted &&
    !el.hidden &&
    !exclude.has(el.id) &&
    !isLinearElement(el) &&
    el.type !== 'freedraw' &&
    el.type !== 'frame' &&
    !(el.type === 'node' && CONTAINER_SHAPE_KEYS.has(el.shape)) &&
    el.width > 0 &&
    el.height > 0
  );
}

const strictlyInside = (p: Point, b: Bounds) => p.x > b.minX + 1e-6 && p.x < b.maxX - 1e-6 && p.y > b.minY + 1e-6 && p.y < b.maxY - 1e-6;

/** Point where leaving `p` along axis `d` exits bounds `b` (at least `min` away from `p`). */
function stubExit(p: Point, d: Point, b: Bounds | null, min: number): Point {
  if (d.x > 0) return { x: Math.max(p.x + min, b ? b.maxX : -Infinity), y: p.y };
  if (d.x < 0) return { x: Math.min(p.x - min, b ? b.minX : Infinity), y: p.y };
  if (d.y > 0) return { x: p.x, y: Math.max(p.y + min, b ? b.maxY : -Infinity) };
  return { x: p.x, y: Math.min(p.y - min, b ? b.minY : Infinity) };
}

function segmentCrossesInterior(a: Point, b: Point, box: Bounds): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const e = 1e-6;
  return minX < box.maxX - e && maxX > box.minX + e && minY < box.maxY - e && maxY > box.minY + e;
}

interface Obstacle {
  id: string;
  bounds: Bounds;
}

/**
 * Orthogonal obstacle-avoiding route. Obstacles are pruned to the neighbourhood of the endpoints;
 * when the resulting path clips an obstacle outside that neighbourhood, those obstacles (and the
 * region around the path) are added and the search repeats, so the result is always checked
 * against every obstacle while typical routes only look at a handful of them.
 */
function orthogonalRoute(start: Endpoint, end: Endpoint, waypoints: readonly Point[], obstacleElements: readonly SceneElement[], selfId: string): Point[] {
  const margin = ROUTING_MARGIN;
  const inflate = (el: SceneElement) => expandBounds(getElementBounds(el), margin);
  const startBox = start.target ? inflate(start.target) : null;
  const endBox = end.target ? inflate(end.target) : null;
  const sDir = start.normal ? dirVector(dirIndex(start.normal)) : null;
  const eDir = end.normal ? dirVector(dirIndex(end.normal)) : null;
  const sStub = sDir ? stubExit(start.point, sDir, startBox, 8) : start.point;
  const eStub = eDir ? stubExit(end.point, eDir, endBox, 8) : end.point;
  const stops = [sStub, ...waypoints, eStub];

  const exclude = new Set<string>([selfId]);
  const all: Obstacle[] = [];
  for (const el of obstacleElements) {
    if (!isObstacleCandidate(el, exclude)) continue;
    const b = inflate(el);
    // Containers around an endpoint (swimlanes, boundaries, groups drawn as nodes) are not obstacles.
    if (stops.some((p) => strictlyInside(p, b))) continue;
    if (el.id !== start.target?.id && el.id !== end.target?.id) {
      if (strictlyInside(start.point, b) || strictlyInside(end.point, b)) continue;
    }
    all.push({ id: el.id, bounds: b });
  }
  all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const pad = margin * 2 + 40;
  let region = expandBounds(
    unionBounds(
      ...stops.map((p) => ({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y })),
      ...(startBox ? [startBox] : []),
      ...(endBox ? [endBox] : []),
    ),
    pad,
  );
  const selected = new Map<string, Bounds>();
  const addInRegion = () => {
    for (const o of all) if (!selected.has(o.id) && boundsIntersect(o.bounds, region)) selected.set(o.id, o.bounds);
  };
  addInRegion();

  for (let attempt = 0; attempt < 5; attempt++) {
    const obstacles = [...selected.values()];
    const path = routeLegs(stops, sDir ? dirIndex(sDir) : null, eDir ? dirIndex({ x: -eDir.x, y: -eDir.y }) : null, obstacles);
    if (!path) break;
    const violators = all.filter(
      (o) => !selected.has(o.id) && path.some((p, i) => i > 0 && segmentCrossesInterior(path[i - 1]!, p, o.bounds)),
    );
    if (violators.length === 0) {
      const own = new Set([start.target?.id, end.target?.id]);
      const obstacleBoxes = all.filter((o) => !own.has(o.id)).map((o) => o.bounds);
      const lead = (p: Point, stub: Point, dir: Point | null): Lead | null =>
        dir ? { dir, length: Math.hypot(stub.x - p.x, stub.y - p.y) } : null;
      return centerChannels([start.point, ...path, end.point], waypoints, obstacleBoxes, lead(start.point, sStub, sDir), lead(end.point, eStub, eDir));
    }
    for (const v of violators) selected.set(v.id, v.bounds);
    const pb = unionBounds(...path.map((p) => ({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y })));
    region = expandBounds(unionBounds(region, pb), pad);
    if (attempt >= 3) for (const o of all) selected.set(o.id, o.bounds);
    else addInRegion();
  }
  return elbowThrough(start, end, waypoints);
}

interface Lead {
  dir: Point;
  /** Minimum distance the path must travel along `dir` before its first turn. */
  length: number;
}

/**
 * Channel centering: every interior segment of a Z-shaped step (neighbours on opposite sides) is
 * moved to the middle of its channel — halfway between the adjacent turns — when that keeps the
 * path clear of obstacles and keeps the lead-out/lead-in stubs long enough to clear the endpoint
 * targets. A* alone picks an arbitrary position among equal-cost jogs; centring makes routes
 * symmetric and stable. Endpoints and waypoints never move.
 */
function centerChannels(path: readonly Point[], fixedPoints: readonly Point[], obstacles: readonly Bounds[], startLead: Lead | null, endLead: Lead | null): Point[] {
  const pts = simplifyOrthogonal(path);
  const last = pts.length - 1;
  const fixed = (i: number) =>
    i === 0 || i === last || fixedPoints.some((s) => Math.abs(s.x - pts[i]!.x) < 1e-6 && Math.abs(s.y - pts[i]!.y) < 1e-6);
  const clear = (a: Point, b: Point) => !obstacles.some((o) => segmentCrossesInterior(a, b, o));
  const leadOk = (p: Point, origin: Point, lead: Lead | null) => !lead || (p.x - origin.x) * lead.dir.x + (p.y - origin.y) * lead.dir.y >= lead.length - 1e-6;
  for (let k = 1; k + 2 <= last; k++) {
    const a = pts[k - 1]!;
    const p = pts[k]!;
    const q = pts[k + 1]!;
    const d = pts[k + 2]!;
    if (fixed(k) || fixed(k + 1)) continue;
    const vertical = Math.abs(p.x - q.x) < 1e-6;
    const before = vertical ? a.x : a.y;
    const after = vertical ? d.x : d.y;
    const at = vertical ? p.x : p.y;
    if (!((before < at && after > at) || (before > at && after < at))) continue;
    const target = (before + after) / 2;
    if (Math.abs(target - at) < 0.5) continue;
    const np = vertical ? { x: target, y: p.y } : { x: p.x, y: target };
    const nq = vertical ? { x: target, y: q.y } : { x: q.x, y: target };
    if (k - 1 === 0 && !leadOk(np, a, startLead)) continue;
    if (k + 2 === last && !leadOk(nq, d, endLead)) continue;
    if (clear(a, np) && clear(np, nq) && clear(nq, d)) {
      pts[k] = np;
      pts[k + 1] = nq;
    }
  }
  return simplifyOrthogonal(pts);
}

function routeLegs(stops: readonly Point[], startDir: number | null, endDir: number | null, obstacles: readonly Bounds[]): Point[] | null {
  const out: Point[] = [stops[0]!];
  let dir = startDir;
  for (let i = 0; i < stops.length - 1; i++) {
    const last = i === stops.length - 2;
    const leg = findOrthogonalPath(stops[i]!, stops[i + 1]!, dir, last ? endDir : null, obstacles, {
      bendPenalty: ROUTING_BEND_PENALTY,
      regionPadding: ROUTING_MARGIN * 2,
      maxGridNodes: 160_000,
    });
    if (!leg) return null;
    out.push(...leg.slice(1));
    if (leg.length >= 2) {
      const a = leg[leg.length - 2]!;
      const b = leg[leg.length - 1]!;
      dir = dirIndex({ x: b.x - a.x, y: b.y - a.y });
    }
  }
  return out;
}

function fallbackNormal(n: Point | null, from: Point, to: Point): Point {
  if (n) return n;
  const d = { x: to.x - from.x, y: to.y - from.y };
  const len = Math.hypot(d.x, d.y);
  return len < 1e-9 ? { x: 1, y: 0 } : { x: d.x / len, y: d.y / len };
}

/**
 * Computes the path of a connector from its bindings and routing mode:
 * - `straight`: segments through the resolved endpoints (and waypoints);
 * - `curved`: control polyline (start, waypoints or one bend control derived from the port normals,
 *   end) that renderers draw as a Catmull-Rom curve;
 * - `bezier`: exactly [start, c1, c2, end] with controls along the port normals at 40 % distance;
 * - `elbow`: one or two bends leaving/entering along the port normals;
 * - `orthogonal`: A* over a sparse orthogonal visibility grid around `obstacles`.
 * The result is normalized (min point at 0,0) and relative to (x, y).
 */
export function computeConnectorRoute(connector: ConnectorElement, getElement: GetElement, obstacles: readonly SceneElement[]): RouteResult {
  const waypoints = connector.waypoints.map(([x, y]) => ({ x, y }));
  const orthogonal = connector.routing === 'orthogonal' || connector.routing === 'elbow';
  const [start, end] = resolveEndpoints(connector, getElement, waypoints, orthogonal);
  switch (connector.routing) {
    case 'straight':
      return toResult([start.point, ...waypoints, end.point]);
    case 'curved': {
      if (waypoints.length > 0) return toResult([start.point, ...waypoints, end.point]);
      const d = Math.hypot(end.point.x - start.point.x, end.point.y - start.point.y);
      const ns = fallbackNormal(start.normal, start.point, end.point);
      const ne = fallbackNormal(end.normal, end.point, start.point);
      const k = d * 0.3;
      const a = { x: start.point.x + ns.x * k, y: start.point.y + ns.y * k };
      const b = { x: end.point.x + ne.x * k, y: end.point.y + ne.y * k };
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const chordMid = { x: (start.point.x + end.point.x) / 2, y: (start.point.y + end.point.y) / 2 };
      const offset = Math.hypot(mid.x - chordMid.x, mid.y - chordMid.y);
      return toResult(offset < 1 ? [start.point, end.point] : [start.point, mid, end.point]);
    }
    case 'bezier': {
      const d = Math.hypot(end.point.x - start.point.x, end.point.y - start.point.y);
      const k = Math.max(20, d * 0.4);
      const ns = fallbackNormal(start.normal, start.point, end.point);
      const ne = fallbackNormal(end.normal, end.point, start.point);
      return bezierExact(start.point, ns, end.point, ne, k);
    }
    case 'elbow':
      return toResult(elbowThrough(start, end, waypoints));
    case 'orthogonal':
      return toResult(orthogonalRoute(start, end, waypoints, obstacles, connector.id));
  }
}

/** Bezier result that always keeps 4 points, even for degenerate (coincident) controls. */
function bezierExact(s: Point, ns: Point, e: Point, ne: Point, k: number): RouteResult {
  const pts = [s, { x: s.x + ns.x * k, y: s.y + ns.y * k }, { x: e.x + ne.x * k, y: e.y + ne.y * k }, e].map(
    (p) => [round(p.x), round(p.y)] as LocalPoint,
  );
  const n = normalizeLinearPoints(0, 0, pts);
  return { x: round(n.x), y: round(n.y), width: round(n.width), height: round(n.height), points: n.points };
}

/**
 * New geometry for an arrow whose endpoints are bound: bound ends follow their targets (floating
 * ends aim at the adjacent point, or at the other end's target centre for two-point arrows);
 * intermediate points are kept. Elbow arrows are re-routed with one or two bends. Connectors are
 * delegated to `computeConnectorRoute` without obstacles. Returns null when nothing is bound.
 */
export function computeArrowEndpoints(arrow: ArrowElement | ConnectorElement, getElement: GetElement): RouteResult | null {
  if (arrow.type === 'connector') {
    if (!arrow.startBinding && !arrow.endBinding) return null;
    return computeConnectorRoute(arrow, getElement, []);
  }
  const startT = liveTarget(arrow.startBinding, getElement);
  const endT = liveTarget(arrow.endBinding, getElement);
  if (!startT && !endT) return null;
  const world = getLinearWorldPoints(arrow);
  if (world.length === 0) return null;
  const n = world.length;
  const pts = world.map((p) => ({ ...p }));
  const fixed = (b: Binding | null, t: SceneElement | null) => (b && t && hasFixedAttachment(b, t) ? resolveBindingPoint(t, b, getElementCenter(t)) : null);
  let s = fixed(arrow.startBinding, startT);
  let e = fixed(arrow.endBinding, endT);
  if (startT && !s) {
    const toward = n > 2 ? pts[1]! : e ? e.point : endT ? getElementCenter(endT) : pts[n - 1]!;
    s = resolveBindingPoint(startT, arrow.startBinding!, toward);
  }
  if (endT && !e) {
    const toward = n > 2 ? pts[n - 2]! : s ? s.point : startT ? getElementCenter(startT) : pts[0]!;
    e = resolveBindingPoint(endT, arrow.endBinding!, toward);
  }
  if (s) pts[0] = s.point;
  if (e) {
    if (n === 1) pts.push(e.point);
    else pts[n - 1] = e.point;
  }
  if (arrow.pathStyle === 'elbow') {
    return toResult(elbowPath(pts[0]!, s?.normal ?? null, pts[pts.length - 1]!, e?.normal ?? null));
  }
  return toResult(pts);
}

export interface BoundLinearUpdateOptions {
  /** Obstacle provider for orthogonal connectors (defaults to `scene.queryBounds`). */
  obstacles?: (bounds: Bounds) => SceneElement[];
}

function sameGeometry(el: LinearElement, r: RouteResult): boolean {
  if (Math.abs(el.x - r.x) > 1e-6 || Math.abs(el.y - r.y) > 1e-6 || el.points.length !== r.points.length) return false;
  return el.points.every((p, i) => Math.abs(p[0] - r.points[i]![0]) < 1e-6 && Math.abs(p[1] - r.points[i]![1]) < 1e-6);
}

/**
 * Geometry patches for every arrow/connector attached to a changed element (or changed itself).
 * Bindings to deleted or missing targets are removed (the endpoint keeps its last position);
 * connectors are re-routed (orthogonal ones around nearby obstacles), arrows follow their targets.
 */
export function computeBoundLinearUpdates(
  scene: Scene,
  changedIds: Iterable<string>,
  options: BoundLinearUpdateOptions = {},
): Array<[string, ElementPatch]> {
  const changed = new Set(changedIds);
  const affected = new Set<string>();
  for (const id of changed) {
    const el = scene.getElement(id);
    if (!el) continue;
    if (isLinearElement(el) && !el.isDeleted && (el.startBinding || el.endBinding)) affected.add(id);
    for (const l of scene.getBoundLinears(id)) affected.add(l.id);
  }
  const getLive = (id: string) => scene.getLiveElement(id);
  const out: Array<[string, ElementPatch]> = [];
  for (const id of [...affected].sort()) {
    const el = scene.getLiveElement(id);
    if (!el || !isLinearElement(el)) continue;
    const patch: ElementPatch = {};
    const keep = (b: Binding | null) => (b && getLive(b.elementId) ? b : null);
    const startBinding = keep(el.startBinding);
    const endBinding = keep(el.endBinding);
    if (startBinding !== el.startBinding) patch.startBinding = null;
    if (endBinding !== el.endBinding) patch.endBinding = null;
    const unbound = patch.startBinding === null || patch.endBinding === null;
    const drives = changed.has(id) || [startBinding, endBinding].some((b) => b && changed.has(b.elementId));
    if ((startBinding || endBinding) && (drives || !unbound) && el.type !== 'line') {
      const next = { ...el, startBinding, endBinding } as ArrowElement | ConnectorElement;
      let route: RouteResult | null;
      if (next.type === 'connector') {
        const boxes: Bounds[] = [getElementBounds(el)];
        for (const b of [startBinding, endBinding]) {
          const t = b ? getLive(b.elementId) : undefined;
          if (t) boxes.push(getElementBounds(t));
        }
        const region = expandBounds(unionBounds(...boxes), 240);
        const obstacles = next.routing === 'orthogonal' ? (options.obstacles ? options.obstacles(region) : scene.queryBounds(region)) : [];
        route = computeConnectorRoute(next, getLive, obstacles);
      } else {
        route = computeArrowEndpoints(next, getLive);
      }
      if (route && !sameGeometry(el, route)) {
        patch.x = route.x;
        patch.y = route.y;
        patch.width = route.width;
        patch.height = route.height;
        patch.points = route.points;
        if (el.angle !== 0) patch.angle = 0;
      }
    }
    if (Object.keys(patch).length > 0) out.push([id, patch]);
  }
  return out;
}
