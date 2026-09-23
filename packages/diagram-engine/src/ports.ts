import {
  DEFAULT_PORTS,
  getElementCenter,
  getLinearPath,
  getLinearWorldPoints,
  getPolygonOutline,
  isBindableElement,
  isLinearElement,
  type Binding,
  type NodeElement,
  type Port,
  type PortSide,
  type SceneElement,
} from '@inkflow/elements';
import {
  convexHull,
  distanceToPolyline,
  ellipsePoints,
  ellipseRayIntersection,
  flattenPath,
  pointInPolygon,
  closestPointOnSegment,
  roundedRectPath,
  rotatePoint,
  type Point,
} from '@inkflow/geometry';
import { computeTableLayout } from './layouts/table';
import { getCornerRadius } from './shapes/path-builder';
import { getNodeGeometry, shapeRegistry } from './shapes/registry';
import type { BindingCandidate, ResolvedPort } from './types';

const SIDE_NORMALS: Record<PortSide, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const FLIP_X: Record<PortSide, PortSide> = {
  top: 'top',
  bottom: 'bottom',
  left: 'right',
  right: 'left',
};
const FLIP_Y: Record<PortSide, PortSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'left',
  right: 'right',
};

/** Side whose outward normal is closest to the given world direction. */
export function sideForDirection(dir: Point): PortSide {
  if (Math.abs(dir.x) >= Math.abs(dir.y)) return dir.x >= 0 ? 'right' : 'left';
  return dir.y >= 0 ? 'bottom' : 'top';
}

export function sideNormal(side: PortSide): Point {
  return SIDE_NORMALS[side];
}

const rotateVec = (v: Point, angle: number): Point =>
  angle === 0
    ? v
    : {
        x: v.x * Math.cos(angle) - v.y * Math.sin(angle),
        y: v.x * Math.sin(angle) + v.y * Math.cos(angle),
      };

/** Outline of an element in its unrotated frame (world units, flips applied). */
export function getLocalOutline(el: SceneElement): Point[] {
  const { x, y, width: w, height: h } = el;
  switch (el.type) {
    case 'node': {
      const g = getNodeGeometry(el);
      const subpaths = flattenPath(g.connectionOutline ?? g.outline, g.elliptical ? 16 : 8).filter(
        (s) => s.points.length > 1,
      );
      const pts =
        subpaths.length === 1 ? subpaths[0]!.points : convexHull(subpaths.flatMap((s) => s.points));
      return dedupeClosing(pts.map((p) => ({ x: p.x + x, y: p.y + y })));
    }
    case 'ellipse':
      return ellipsePoints({ x: x + w / 2, y: y + h / 2 }, w / 2, h / 2, 64);
    case 'rectangle': {
      if (el.roundness === 'round') {
        const sub = flattenPath(roundedRectPath(x, y, w, h, getCornerRadius(w, h)), 6)[0];
        if (sub) return dedupeClosing(sub.points);
      }
      return boxCorners(el);
    }
    case 'diamond':
    case 'triangle':
    case 'polygon':
    case 'star':
      return getPolygonOutline(el) ?? boxCorners(el);
    default:
      return boxCorners(el);
  }
}

function boxCorners(el: SceneElement): Point[] {
  const { x, y, width: w, height: h } = el;
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function dedupeClosing(pts: Point[]): Point[] {
  if (pts.length > 2) {
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) return pts.slice(0, -1);
  }
  return pts;
}

/**
 * World-space outline (rotation applied) used for highlights and connector attachment. Ellipses
 * are sampled with 64 points; linear elements return their drawn path; freedraw its samples.
 */
export function getOutlinePolygon(el: SceneElement): Point[] {
  if (isLinearElement(el)) return getLinearPath(el);
  if (el.type === 'freedraw') return getLinearWorldPoints(el);
  const local = getLocalOutline(el);
  if (el.angle === 0) return local;
  const c = getElementCenter(el);
  return local.map((p) => rotatePoint(p, c, el.angle));
}

/** Moves a box-side point inward along -normal onto the outline (for non-rectangular shapes). */
function projectOntoOutline(
  p: Point,
  normal: Point,
  outline: readonly Point[],
  reach: number,
): Point {
  if (outline.length < 3) return p;
  if (distanceToPolyline(p, outline, true) < 0.5) return p;
  const end = { x: p.x - normal.x * reach, y: p.y - normal.y * reach };
  let best: Point | null = null;
  let bestT = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    const hit = segmentHit(p, end, a, b);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      best = hit.point;
    }
  }
  return best ?? p;
}

function segmentHit(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
): { point: Point; t: number } | null {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = p4.x - p3.x;
  const sy = p4.y - p3.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const qx = p3.x - p1.x;
  const qy = p3.y - p1.y;
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { point: { x: p1.x + t * rx, y: p1.y + t * ry }, t };
}

function portsForNode(node: NodeElement): Port[] {
  const def = getNodeDefaults(node);
  if (!node.ports || node.ports.length === 0) return def;
  const custom = new Map(node.ports.map((p) => [p.id, p]));
  const merged = def.map((p) => custom.get(p.id) ?? p);
  for (const p of node.ports) if (!def.some((d) => d.id === p.id)) merged.push(p);
  return merged;
}

function getNodeDefaults(node: NodeElement): Port[] {
  const def = shapeRegistry.get(node.shape);
  return def?.ports ? def.ports(node.width, node.height) : DEFAULT_PORTS.map((p) => ({ ...p }));
}

interface LocalPort {
  id: string;
  side: PortSide;
  point: Point;
  project: boolean;
}

function boxPortPoint(el: SceneElement, side: PortSide, offset: number): Point {
  const { x, y, width: w, height: h } = el;
  switch (side) {
    case 'top':
      return { x: x + offset * w, y };
    case 'right':
      return { x: x + w, y: y + offset * h };
    case 'bottom':
      return { x: x + offset * w, y: y + h };
    case 'left':
      return { x, y: y + offset * h };
  }
}

function localPorts(el: SceneElement): LocalPort[] {
  const fromPorts = (ports: readonly Port[], project: boolean): LocalPort[] =>
    ports.map((p) => ({
      id: p.id,
      side: p.side,
      point: boxPortPoint(el, p.side, p.offset),
      project,
    }));
  switch (el.type) {
    case 'node':
      return fromPorts(portsForNode(el), true);
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
    case 'triangle':
    case 'polygon':
    case 'star':
      return fromPorts(DEFAULT_PORTS, true);
    case 'table': {
      const out = fromPorts(DEFAULT_PORTS, false);
      const layout = computeTableLayout(el);
      for (const row of layout.rows) {
        const cy = el.y + row.y + row.height / 2;
        out.push({
          id: `col:${row.columnId}:left`,
          side: 'left',
          point: { x: el.x, y: cy },
          project: false,
        });
        out.push({
          id: `col:${row.columnId}:right`,
          side: 'right',
          point: { x: el.x + el.width, y: cy },
          project: false,
        });
      }
      return out;
    }
    case 'uml-class':
    case 'image':
    case 'text':
    case 'frame':
      return fromPorts(DEFAULT_PORTS, false);
    default:
      return [];
  }
}

/**
 * Connection ports in world space. Port positions are defined on the unflipped box; flips mirror
 * them (a `left` port of a horizontally flipped node sits on its visual right side and reports
 * side `right`), points are projected onto non-rectangular outlines, then rotation is applied.
 */
export function getElementPorts(el: SceneElement): ResolvedPort[] {
  if (el.isDeleted) return [];
  const ports = localPorts(el);
  if (ports.length === 0) return [];
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const needsOutline = ports.some((p) => p.project);
  const outline = needsOutline ? getLocalOutline(el) : [];
  const reach = Math.max(el.width, el.height) + 1;
  const center = { x: cx, y: cy };
  return ports.map((p) => {
    let side = p.side;
    let pt = p.point;
    if (el.flipX) {
      side = FLIP_X[side];
      pt = { x: 2 * cx - pt.x, y: pt.y };
    }
    if (el.flipY) {
      side = FLIP_Y[side];
      pt = { x: pt.x, y: 2 * cy - pt.y };
    }
    const n = SIDE_NORMALS[side];
    if (p.project) pt = projectOntoOutline(pt, n, outline, reach);
    const world = el.angle === 0 ? pt : rotatePoint(pt, center, el.angle);
    return { id: p.id, side, point: world, normal: rotateVec(n, el.angle) };
  });
}

/** Unit direction of `v`, or +x for the zero vector. */
function unit(v: Point): Point {
  const len = Math.hypot(v.x, v.y);
  return len < 1e-9 ? { x: 1, y: 0 } : { x: v.x / len, y: v.y / len };
}

/** Farthest intersection of the ray from `origin` along `dir` with a closed polygon. */
export function rayPolygonExit(origin: Point, dir: Point, polygon: readonly Point[]): Point | null {
  let bestT = -Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const denom = dir.x * sy - dir.y * sx;
    if (Math.abs(denom) < 1e-12) continue;
    const qx = a.x - origin.x;
    const qy = a.y - origin.y;
    const t = (qx * sy - qy * sx) / denom;
    const u = (qx * dir.y - qy * dir.x) / denom;
    if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && t > bestT) bestT = t;
  }
  return bestT === -Infinity ? null : { x: origin.x + dir.x * bestT, y: origin.y + dir.y * bestT };
}

/** Floating attachment: outline point along the ray from the target centre toward `toward`. */
export function floatingAttachment(
  target: SceneElement,
  toward: Point,
  gap: number,
): { point: Point; normal: Point } {
  const c = getElementCenter(target);
  const dir = unit({ x: toward.x - c.x, y: toward.y - c.y });
  let hit: Point | null;
  if (target.type === 'ellipse' && target.width > 0 && target.height > 0) {
    const localToward = target.angle === 0 ? toward : rotatePoint(toward, c, -target.angle);
    const lt =
      Math.hypot(localToward.x - c.x, localToward.y - c.y) < 1e-9
        ? { x: c.x + 1, y: c.y }
        : localToward;
    const local = ellipseRayIntersection(c, target.width / 2, target.height / 2, lt);
    hit = target.angle === 0 ? local : rotatePoint(local, c, target.angle);
  } else {
    hit = rayPolygonExit(c, dir, getOutlinePolygon(target));
  }
  const base = hit ?? c;
  return { point: { x: base.x + dir.x * gap, y: base.y + dir.y * gap }, normal: dir };
}

/** Normal of the box side nearest to a local point (unrotated frame). */
function nearestSide(el: SceneElement, p: Point): PortSide {
  const d: [PortSide, number][] = [
    ['left', p.x - el.x],
    ['right', el.x + el.width - p.x],
    ['top', p.y - el.y],
    ['bottom', el.y + el.height - p.y],
  ];
  d.sort((a, b) => a[1] - b[1]);
  return d[0]![0];
}

/**
 * World point (and outward unit normal) an endpoint bound with `binding` attaches to:
 * - named port → the port point pushed out by `gap` along the port normal;
 * - anchor → the normalized point of the target's (flipped) box; anchors on the outline are pushed
 *   out by `gap` along the nearest side normal;
 * - floating → intersection of the ray from the target centre toward `toward` with the outline,
 *   pushed out by `gap` along the ray.
 */
export function resolveBindingPoint(
  target: SceneElement,
  binding: Binding,
  toward: Point,
): { point: Point; normal: Point } {
  const gap = binding.gap;
  if (binding.portId) {
    const port = getElementPorts(target).find((p) => p.id === binding.portId);
    if (port)
      return {
        point: { x: port.point.x + port.normal.x * gap, y: port.point.y + port.normal.y * gap },
        normal: port.normal,
      };
  }
  if (binding.anchor) {
    let [ax, ay] = binding.anchor;
    if (target.flipX) ax = 1 - ax;
    if (target.flipY) ay = 1 - ay;
    const local = { x: target.x + ax * target.width, y: target.y + ay * target.height };
    const side = nearestSide(target, local);
    const outline = getLocalOutline(target);
    const outside = outline.length >= 3 && !pointInPolygon(local, outline);
    const onOutline =
      outline.length < 3 || outside || distanceToPolyline(local, outline, true) <= 1.5;
    const n = SIDE_NORMALS[side];
    const pushed = onOutline ? { x: local.x + n.x * gap, y: local.y + n.y * gap } : local;
    const c = getElementCenter(target);
    return {
      point: target.angle === 0 ? pushed : rotatePoint(pushed, c, target.angle),
      normal: rotateVec(n, target.angle),
    };
  }
  return floatingAttachment(target, toward, gap);
}

export interface FindBindingOptions {
  excludeIds?: ReadonlySet<string>;
  /** Snap to a port within this distance (default: `tolerance`). */
  portSnapDistance?: number;
}

/** Elements connectors may attach to (visible, unlocked, bindable, not linear/freedraw/sequence). */
export function canBindTo(el: SceneElement): boolean {
  return (
    !el.isDeleted &&
    !el.hidden &&
    !el.locked &&
    isBindableElement(el) &&
    !isLinearElement(el) &&
    el.type !== 'freedraw'
  );
}

/**
 * Binding target under `point`. Candidates are in z-order (top-most LAST); the top-most bindable
 * element that contains the point or whose outline lies within `tolerance` wins (frames only by
 * their border). Snaps to the nearest port within `portSnapDistance`; otherwise returns an anchor
 * when the point is near the outline (attach exactly there) or a floating binding when it is well
 * inside the shape.
 */
export function findBindingCandidate(
  candidates: readonly SceneElement[],
  point: Point,
  tolerance: number,
  options: FindBindingOptions = {},
): BindingCandidate | null {
  const snap = options.portSnapDistance ?? tolerance;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const el = candidates[i]!;
    if (!canBindTo(el) || options.excludeIds?.has(el.id)) continue;
    const outline = getOutlinePolygon(el);
    if (outline.length < 3) continue;
    const dist = distanceToPolyline(point, outline, true);
    const inside = pointInPolygon(point, outline);
    if (el.type === 'frame' ? dist > tolerance : !inside && dist > tolerance) continue;

    let bestPort: ResolvedPort | null = null;
    let bestD = snap;
    for (const port of getElementPorts(el)) {
      const d = Math.hypot(port.point.x - point.x, port.point.y - point.y);
      if (d <= bestD) {
        bestD = d;
        bestPort = port;
      }
    }
    if (bestPort)
      return { element: el, portId: bestPort.id, anchor: null, point: { ...bestPort.point } };

    if (dist <= tolerance) {
      // Anchor at the closest outline point, expressed in the unrotated, unflipped box.
      let closest = point;
      let best = Infinity;
      for (let k = 0; k < outline.length; k++) {
        const c = closestPointOnSegment(
          point,
          outline[k]!,
          outline[(k + 1) % outline.length]!,
        ).point;
        const d = Math.hypot(c.x - point.x, c.y - point.y);
        if (d < best) {
          best = d;
          closest = c;
        }
      }
      const center = getElementCenter(el);
      const local = el.angle === 0 ? closest : rotatePoint(closest, center, -el.angle);
      let ax = el.width > 0 ? (local.x - el.x) / el.width : 0.5;
      let ay = el.height > 0 ? (local.y - el.y) / el.height : 0.5;
      if (el.flipX) ax = 1 - ax;
      if (el.flipY) ay = 1 - ay;
      const clamp = (v: number) => Math.max(0, Math.min(1, v));
      return { element: el, portId: null, anchor: [clamp(ax), clamp(ay)], point: closest };
    }
    const attach = floatingAttachment(el, point, 0);
    return { element: el, portId: null, anchor: null, point: attach.point };
  }
  return null;
}
