import {
  getElementCenter,
  getLinearPath,
  getPolygonOutline,
  isLinearElement,
  getLinearWorldPoints,
  type SceneElement,
} from '@inkflow/elements';
import {
  boundsFromPoints,
  ellipsePoints,
  rotatePoint,
  rotatedRectCorners,
  type Point,
} from '@inkflow/geometry';

/** World-space outline polygon used for selection/hover chrome. */
export function elementOutline(el: SceneElement, padding = 0): Point[] {
  if (isLinearElement(el) || el.type === 'freedraw') {
    const pts = isLinearElement(el) ? getLinearPath(el) : getLinearWorldPoints(el);
    const b = boundsFromPoints(pts);
    return [
      { x: b.minX - padding, y: b.minY - padding },
      { x: b.maxX + padding, y: b.minY - padding },
      { x: b.maxX + padding, y: b.maxY + padding },
      { x: b.minX - padding, y: b.maxY + padding },
    ];
  }
  const c = getElementCenter(el);
  if (el.type === 'ellipse' && padding === 0) {
    return ellipsePoints(c, el.width / 2, el.height / 2, 40).map((p) =>
      rotatePoint(p, c, el.angle),
    );
  }
  const poly = padding === 0 ? getPolygonOutline(el) : null;
  if (poly) return poly.map((p) => rotatePoint(p, c, el.angle));
  return rotatedRectCorners(
    {
      x: el.x - padding,
      y: el.y - padding,
      width: el.width + padding * 2,
      height: el.height + padding * 2,
    },
    el.angle,
  );
}
