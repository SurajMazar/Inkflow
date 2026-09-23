import {
  parseSvgPath,
  pathBounds,
  regularPolygonPoints,
  starPoints,
  transformPath,
  type Path,
  type Point,
} from '@inkflow/geometry';
import type { NodeElement, Port } from '@inkflow/elements';
import type { NodeShapeDefinition, ShapeGeometry } from '../types';
import {
  box,
  circlePath,
  getCornerRadius,
  joinPaths,
  linePath,
  path,
  polygon,
  polyline,
  rectPath,
  roundRect,
} from './path-builder';

const PAD = 8;
const PI = Math.PI;

const fullLabel = (w: number, h: number, pad = PAD) => box(pad, pad, w - pad * 2, h - pad * 2);

/** Scales a path so its bounds exactly fill [0, w] × [0, h]. */
function fitPath(p: Path, w: number, h: number): Path {
  const b = pathBounds(p);
  const bw = b.maxX - b.minX || 1;
  const bh = b.maxY - b.minY || 1;
  const sx = w / bw;
  const sy = h / bh;
  return transformPath(p, sx, sy, -b.minX * sx, -b.minY * sy);
}

function fitPoints(points: Point[], w: number, h: number): Path {
  return fitPath(polygon(points.map((p) => [p.x, p.y] as [number, number])), w, h);
}

function arrowHead(tip: Point, from: Point, size: number): Path {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const a = { x: tip.x - ux * size - uy * size * 0.6, y: tip.y - uy * size + ux * size * 0.6 };
  const b = { x: tip.x - ux * size + uy * size * 0.6, y: tip.y - uy * size - ux * size * 0.6 };
  return linePath(a, tip, b);
}

/**
 * Bumpy cloud: circular arcs between anchor points on an inner ellipse, each bulging outward by a
 * sagitta proportional to its chord (flatter along the bottom), then scaled to fill the box.
 */
function cloudOutline(w: number, h: number): Path {
  // Anchor angles (degrees, screen space, clockwise) and bump sagitta ratios.
  const anchors: [number, number][] = [
    [165, 0.5],
    [212, 0.55],
    [256, 0.6],
    [300, 0.58],
    [345, 0.52],
    [30, 0.34],
    [75, 0.3],
    [118, 0.3],
  ];
  const cx = 0;
  const cy = 0;
  const rx = 1;
  const ry = 0.62;
  const pts = anchors.map(([deg]) => {
    const a = (deg * PI) / 180;
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
  });
  const b = path();
  for (let i = 0; i < pts.length; i++) {
    const A = pts[i]!;
    const B = pts[(i + 1) % pts.length]!;
    const sag = anchors[(i + 1) % anchors.length]![1];
    const mx = (A.x + B.x) / 2;
    const my = (A.y + B.y) / 2;
    const half = Math.hypot(B.x - A.x, B.y - A.y) / 2;
    let nx = -(B.y - A.y) / (half * 2);
    let ny = (B.x - A.x) / (half * 2);
    if (nx * (mx - cx) + ny * (my - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const s = sag * half;
    const r = (half * half + s * s) / (2 * s);
    const ccx = mx + nx * (s - r);
    const ccy = my + ny * (s - r);
    const a0 = Math.atan2(A.y - ccy, A.x - ccx);
    const a1raw = Math.atan2(B.y - ccy, B.x - ccx);
    const aO = Math.atan2(my + ny * s - ccy, mx + nx * s - ccx);
    const norm = (a: number) => ((a % (2 * PI)) + 2 * PI) % (2 * PI);
    let delta = norm(a1raw - a0);
    if (norm(aO - a0) > delta) delta -= 2 * PI;
    if (i === 0) b.moveTo(A.x, A.y);
    b.arc(ccx, ccy, r, r, a0, a0 + delta);
  }
  b.close();
  return fitPath(b.build(), w, h);
}

function cylinder(w: number, h: number, rims: number): ShapeGeometry {
  const ry = Math.min(h * 0.15, w * 0.25);
  const cx = w / 2;
  const rx = w / 2;
  const outline = path()
    .arc(cx, ry, rx, ry, PI, 2 * PI)
    .lineTo(w, h - ry)
    .arc(cx, h - ry, rx, ry, 0, PI)
    .close()
    .build();
  const details: Path[] = [path().arc(cx, ry, rx, ry, 0, PI).build()];
  for (let i = 1; i <= rims; i++) {
    const y = ry + ((h - 2 * ry) * i) / (rims + 1);
    details.push(path().arc(cx, y, rx, ry, 0, PI).build());
  }
  const top = 2 * ry + 4;
  return { outline, details, labelBox: box(PAD, top, w - PAD * 2, h - ry - top) };
}

/** Rounded box with a symbol drawn in a square area on the left and the label on the right. */
function symbolCard(
  w: number,
  h: number,
  symbol: (x: number, y: number, s: number) => { details: Path[]; fills?: Path[] },
) {
  const s = Math.max(0, Math.min(h - PAD * 2, w * 0.36));
  const sx = PAD;
  const sy = (h - s) / 2;
  const drawn = symbol(sx, sy, s);
  const labelX = sx + s + 6;
  return {
    outline: roundRect(0, 0, w, h, Math.min(8, getCornerRadius(w, h))),
    details: drawn.details,
    fills: drawn.fills,
    labelBox: box(labelX, PAD, w - labelX - PAD, h - PAD * 2),
  } satisfies ShapeGeometry;
}

function sidePorts(): Port[] {
  return [
    { id: 'top', side: 'top', offset: 0.5 },
    { id: 'right', side: 'right', offset: 0.5 },
    { id: 'bottom', side: 'bottom', offset: 0.5 },
    { id: 'left', side: 'left', offset: 0.5 },
  ];
}

type Def = NodeShapeDefinition;

const basic: Def[] = [
  {
    key: 'rectangle',
    label: 'Rectangle',
    category: 'basic',
    keywords: ['box', 'square', 'rect', 'process'],
    defaultSize: { width: 160, height: 80 },
    defaultStyle: { roundness: 'sharp' },
    geometry: (w, h, el) => ({
      outline:
        el?.roundness === 'round'
          ? roundRect(0, 0, w, h, getCornerRadius(w, h))
          : rectPath(0, 0, w, h),
      labelBox: fullLabel(w, h),
    }),
  },
  {
    key: 'rounded-rectangle',
    label: 'Rounded rectangle',
    category: 'basic',
    keywords: ['box', 'rounded', 'card', 'rect'],
    defaultSize: { width: 160, height: 80 },
    defaultStyle: { roundness: 'round' },
    geometry: (w, h, el) => {
      const r = el?.roundness === 'sharp' ? Math.min(6, w / 2, h / 2) : getCornerRadius(w, h);
      return { outline: roundRect(0, 0, w, h, r), labelBox: fullLabel(w, h) };
    },
  },
  {
    key: 'circle',
    label: 'Circle',
    category: 'basic',
    keywords: ['round', 'dot', 'node'],
    defaultSize: { width: 100, height: 100 },
    elliptical: true,
    geometry: (w, h) => {
      const r = Math.min(w, h) / 2;
      const k = r * Math.SQRT1_2;
      return {
        outline: circlePath(w / 2, h / 2, r),
        labelBox: box(w / 2 - k, h / 2 - k, k * 2, k * 2),
        elliptical: true,
      };
    },
  },
  {
    key: 'ellipse',
    label: 'Ellipse',
    category: 'basic',
    keywords: ['oval', 'round'],
    defaultSize: { width: 160, height: 100 },
    elliptical: true,
    geometry: (w, h) => ({
      outline: path()
        .arc(w / 2, h / 2, w / 2, h / 2, 0, 2 * PI)
        .close()
        .build(),
      labelBox: box(w * 0.1464, h * 0.1464, w * 0.7071, h * 0.7071),
      elliptical: true,
    }),
  },
  {
    key: 'diamond',
    label: 'Diamond',
    category: 'basic',
    keywords: ['rhombus', 'decision', 'choice'],
    defaultSize: { width: 140, height: 100 },
    geometry: (w, h) => ({
      outline: polygon([
        [w / 2, 0],
        [w, h / 2],
        [w / 2, h],
        [0, h / 2],
      ]),
      labelBox: box(w / 4, h / 4, w / 2, h / 2),
    }),
  },
  {
    key: 'triangle',
    label: 'Triangle',
    category: 'basic',
    keywords: ['arrow', 'delta', 'merge'],
    defaultSize: { width: 120, height: 100 },
    geometry: (w, h) => ({
      outline: polygon([
        [w / 2, 0],
        [w, h],
        [0, h],
      ]),
      labelBox: box(w / 4 + 4, h / 2, w / 2 - 8, h / 2 - 6),
    }),
  },
  {
    key: 'parallelogram',
    label: 'Parallelogram',
    category: 'flowchart',
    keywords: ['input', 'output', 'data', 'io', 'skew'],
    defaultSize: { width: 170, height: 80 },
    geometry: (w, h) => {
      const s = Math.min(w * 0.2, h * 0.6);
      return {
        outline: polygon([
          [s, 0],
          [w, 0],
          [w - s, h],
          [0, h],
        ]),
        labelBox: box(s / 2 + 4, 4, w - s - 8, h - 8),
      };
    },
  },
  {
    key: 'trapezoid',
    label: 'Trapezoid',
    category: 'basic',
    keywords: ['trapezium', 'manual operation'],
    defaultSize: { width: 160, height: 80 },
    geometry: (w, h) => {
      const s = Math.min(w * 0.2, h * 0.6);
      return {
        outline: polygon([
          [s, 0],
          [w - s, 0],
          [w, h],
          [0, h],
        ]),
        labelBox: box(s * 0.75 + 4, 4, w - s * 1.5 - 8, h - 8),
      };
    },
  },
  {
    key: 'hexagon',
    label: 'Hexagon',
    category: 'basic',
    keywords: ['preparation', 'microservice', 'polygon'],
    defaultSize: { width: 160, height: 90 },
    geometry: (w, h) => {
      const s = Math.min(w * 0.25, h * 0.5);
      return {
        outline: polygon([
          [s, 0],
          [w - s, 0],
          [w, h / 2],
          [w - s, h],
          [s, h],
          [0, h / 2],
        ]),
        labelBox: box(s / 2 + 4, 4, w - s - 8, h - 8),
      };
    },
  },
  {
    key: 'pentagon',
    label: 'Pentagon',
    category: 'basic',
    keywords: ['polygon', 'five'],
    defaultSize: { width: 110, height: 105 },
    geometry: (w, h) => ({
      outline: fitPoints(regularPolygonPoints(0, 0, w, h, 5), w, h),
      labelBox: box(w * 0.2, h * 0.25, w * 0.6, h * 0.55),
    }),
  },
  {
    key: 'octagon',
    label: 'Octagon',
    category: 'basic',
    keywords: ['polygon', 'stop', 'eight'],
    defaultSize: { width: 110, height: 110 },
    geometry: (w, h) => {
      const pts = regularPolygonPoints(0, 0, w, h, 8).map((p, i, arr) => {
        // Rotate by half a step so edges are axis aligned.
        const next = arr[(i + 1) % arr.length]!;
        return { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
      });
      return { outline: fitPoints(pts, w, h), labelBox: box(w * 0.15, h * 0.15, w * 0.7, h * 0.7) };
    },
  },
  {
    key: 'star',
    label: 'Star',
    category: 'basic',
    keywords: ['favorite', 'rating', 'highlight'],
    defaultSize: { width: 110, height: 105 },
    geometry: (w, h) => ({
      outline: fitPoints(starPoints(0, 0, w, h, 5, 0.45), w, h),
      labelBox: box(w * 0.3, h * 0.35, w * 0.4, h * 0.35),
    }),
  },
  {
    key: 'callout',
    label: 'Callout',
    category: 'basic',
    keywords: ['speech', 'bubble', 'comment', 'balloon'],
    defaultSize: { width: 170, height: 100 },
    geometry: (w, h) => {
      const bh = h * 0.78;
      const r = Math.min(getCornerRadius(w, bh), 12);
      const outline = path()
        .moveTo(r, 0)
        .lineTo(w - r, 0)
        .arc(w - r, r, r, r, -PI / 2, 0)
        .lineTo(w, bh - r)
        .arc(w - r, bh - r, r, r, 0, PI / 2)
        .lineTo(w * 0.38, bh)
        .lineTo(w * 0.16, h)
        .lineTo(w * 0.22, bh)
        .lineTo(r, bh)
        .arc(r, bh - r, r, r, PI / 2, PI)
        .lineTo(0, r)
        .arc(r, r, r, r, PI, 1.5 * PI)
        .close()
        .build();
      return { outline, labelBox: box(PAD, PAD, w - PAD * 2, bh - PAD * 2) };
    },
  },
];

const flowchart: Def[] = [
  {
    key: 'process',
    label: 'Process',
    category: 'flowchart',
    keywords: ['step', 'action', 'task', 'box'],
    defaultSize: { width: 160, height: 80 },
    defaultStyle: { roundness: 'sharp' },
    geometry: (w, h) => ({ outline: rectPath(0, 0, w, h), labelBox: fullLabel(w, h) }),
  },
  {
    key: 'predefined-process',
    label: 'Predefined process',
    category: 'flowchart',
    keywords: ['subroutine', 'function', 'call'],
    defaultSize: { width: 170, height: 80 },
    geometry: (w, h) => {
      const d = Math.min(w * 0.1, 16);
      return {
        outline: rectPath(0, 0, w, h),
        details: [
          linePath({ x: d, y: 0 }, { x: d, y: h }),
          linePath({ x: w - d, y: 0 }, { x: w - d, y: h }),
        ],
        labelBox: box(d + 6, 6, w - d * 2 - 12, h - 12),
      };
    },
  },
  {
    key: 'terminator',
    label: 'Terminator',
    category: 'flowchart',
    keywords: ['start', 'end', 'pill', 'stadium', 'begin', 'stop'],
    defaultSize: { width: 150, height: 60 },
    defaultStyle: { backgroundColor: '#ebfbee', strokeColor: '#2f9e44' },
    geometry: (w, h) => {
      const r = Math.min(w, h) / 2;
      return { outline: roundRect(0, 0, w, h, r), labelBox: box(r * 0.5, 4, w - r, h - 8) };
    },
  },
  {
    key: 'decision',
    label: 'Decision',
    category: 'flowchart',
    keywords: ['if', 'condition', 'branch', 'diamond', 'question'],
    defaultSize: { width: 150, height: 100 },
    defaultStyle: { backgroundColor: '#fff9db', strokeColor: '#f08c00' },
    geometry: (w, h) => ({
      outline: polygon([
        [w / 2, 0],
        [w, h / 2],
        [w / 2, h],
        [0, h / 2],
      ]),
      labelBox: box(w / 4, h / 4, w / 2, h / 2),
    }),
  },
  {
    key: 'document',
    label: 'Document',
    category: 'flowchart',
    keywords: ['file', 'report', 'paper', 'page'],
    defaultSize: { width: 150, height: 90 },
    geometry: (w, h) => {
      const a = Math.min(h * 0.1, 14);
      const up = h - a - (4 / 3) * a;
      const down = h - a + (4 / 3) * a;
      const outline = path()
        .moveTo(0, 0)
        .lineTo(w, 0)
        .lineTo(w, h - a)
        .curveTo((w * 5) / 6, up, (w * 4) / 6, up, w / 2, h - a)
        .curveTo(w / 3, down, w / 6, down, 0, h - a)
        .close()
        .build();
      return { outline, labelBox: box(PAD, PAD, w - PAD * 2, h - 2 * a - PAD - 4) };
    },
  },
  {
    key: 'multi-document',
    label: 'Multiple documents',
    category: 'flowchart',
    keywords: ['documents', 'files', 'reports', 'stack'],
    defaultSize: { width: 160, height: 100 },
    geometry: (w, h) => {
      const o = Math.min(8, w * 0.05, h * 0.08);
      const fw = w - 2 * o;
      const a = Math.min((h - 2 * o) * 0.1, 12);
      const up = h - a - (4 / 3) * a;
      const down = h - a + (4 / 3) * a;
      const outline = path()
        .moveTo(2 * o, 0)
        .lineTo(w, 0)
        .lineTo(w, h - 2 * o - a)
        .lineTo(w - o, h - 2 * o - a)
        .lineTo(w - o, h - o - a)
        .lineTo(fw, h - o - a)
        .lineTo(fw, h - a)
        .curveTo((fw * 5) / 6, up, (fw * 4) / 6, up, fw / 2, h - a)
        .curveTo(fw / 3, down, fw / 6, down, 0, h - a)
        .lineTo(0, 2 * o)
        .lineTo(o, 2 * o)
        .lineTo(o, o)
        .lineTo(2 * o, o)
        .close()
        .build();
      return {
        outline,
        details: [
          linePath({ x: 0, y: 2 * o }, { x: fw, y: 2 * o }, { x: fw, y: h - o - a }),
          linePath({ x: o, y: o }, { x: w - o, y: o }, { x: w - o, y: h - 2 * o - a }),
        ],
        labelBox: box(PAD, 2 * o + 6, fw - PAD * 2, h - 2 * o - 2 * a - 12),
      };
    },
  },
  {
    key: 'delay',
    label: 'Delay',
    category: 'flowchart',
    keywords: ['wait', 'hold', 'd-shape'],
    defaultSize: { width: 140, height: 80 },
    geometry: (w, h) => {
      const rx = Math.min(h / 2, w / 2);
      const outline = path()
        .moveTo(0, 0)
        .lineTo(w - rx, 0)
        .arc(w - rx, h / 2, rx, h / 2, -PI / 2, PI / 2)
        .lineTo(0, h)
        .close()
        .build();
      return { outline, labelBox: box(PAD, PAD, w - rx * 0.3 - PAD * 2, h - PAD * 2) };
    },
  },
  {
    key: 'manual-input',
    label: 'Manual input',
    category: 'flowchart',
    keywords: ['keyboard', 'entry', 'form'],
    defaultSize: { width: 150, height: 80 },
    geometry: (w, h) => {
      const s = Math.min(h * 0.3, 24);
      return {
        outline: polygon([
          [0, s],
          [w, 0],
          [w, h],
          [0, h],
        ]),
        labelBox: box(PAD, s + 4, w - PAD * 2, h - s - 8),
      };
    },
  },
  {
    key: 'manual-operation',
    label: 'Manual operation',
    category: 'flowchart',
    keywords: ['manual', 'trapezoid', 'human'],
    defaultSize: { width: 160, height: 80 },
    geometry: (w, h) => {
      const s = Math.min(w * 0.2, h * 0.6);
      return {
        outline: polygon([
          [0, 0],
          [w, 0],
          [w - s, h],
          [s, h],
        ]),
        labelBox: box(s * 0.75 + 4, 4, w - s * 1.5 - 8, h - 8),
      };
    },
  },
  {
    key: 'off-page-connector',
    label: 'Off-page connector',
    category: 'flowchart',
    keywords: ['reference', 'continue', 'page', 'jump'],
    defaultSize: { width: 80, height: 90 },
    geometry: (w, h) => ({
      outline: polygon([
        [0, 0],
        [w, 0],
        [w, h * 0.62],
        [w / 2, h],
        [0, h * 0.62],
      ]),
      labelBox: box(6, 6, w - 12, h * 0.62 - 6),
    }),
  },
  {
    key: 'preparation',
    label: 'Preparation',
    category: 'flowchart',
    keywords: ['setup', 'initialize', 'hexagon', 'loop'],
    defaultSize: { width: 160, height: 80 },
    geometry: (w, h) => {
      const s = Math.min(w * 0.18, h * 0.5);
      return {
        outline: polygon([
          [s, 0],
          [w - s, 0],
          [w, h / 2],
          [w - s, h],
          [s, h],
          [0, h / 2],
        ]),
        labelBox: box(s / 2 + 4, 4, w - s - 8, h - 8),
      };
    },
  },
  {
    key: 'internal-storage',
    label: 'Internal storage',
    category: 'flowchart',
    keywords: ['memory', 'ram', 'storage'],
    defaultSize: { width: 140, height: 90 },
    geometry: (w, h) => {
      const d = Math.min(16, w * 0.12, h * 0.18);
      return {
        outline: rectPath(0, 0, w, h),
        details: [
          linePath({ x: d, y: 0 }, { x: d, y: h }),
          linePath({ x: 0, y: d }, { x: w, y: d }),
        ],
        labelBox: box(d + 4, d + 4, w - d - 8, h - d - 8),
      };
    },
  },
  {
    key: 'flag',
    label: 'Flag (asymmetric)',
    category: 'flowchart',
    keywords: ['asymmetric', 'flag', 'banner', 'signal'],
    defaultSize: { width: 160, height: 70 },
    geometry: (w, h) => {
      const s = Math.min(w * 0.18, h * 0.5);
      return {
        outline: polygon([
          [0, 0],
          [w, 0],
          [w, h],
          [0, h],
          [s, h / 2],
        ]),
        labelBox: box(s + 4, 4, w - s - 12, h - 8),
      };
    },
  },
  {
    key: 'data-store',
    label: 'Data store',
    category: 'flowchart',
    keywords: ['dfd', 'store', 'file', 'repository', 'gane-sarson'],
    defaultSize: { width: 180, height: 56 },
    defaultStyle: { roundness: 'sharp', backgroundColor: '#f8f9fa', strokeColor: '#495057' },
    geometry: (w, h) => {
      const d = Math.min(36, w * 0.2);
      return {
        outline: rectPath(0, 0, w, h),
        details: [linePath({ x: d, y: 0 }, { x: d, y: h })],
        labelBox: box(d + 6, 4, w - d - 12, h - 8),
        iconBox: box(4, 4, d - 8, h - 8),
      };
    },
  },
  {
    key: 'card',
    label: 'Card',
    category: 'flowchart',
    keywords: ['punched card', 'record'],
    defaultSize: { width: 140, height: 90 },
    geometry: (w, h) => {
      const c = Math.min(w * 0.2, h * 0.3);
      return {
        outline: polygon([
          [c, 0],
          [w, 0],
          [w, h],
          [0, h],
          [0, c],
        ]),
        labelBox: box(PAD, c / 2 + 4, w - PAD * 2, h - c / 2 - 12),
      };
    },
  },
  {
    key: 'loop-limit',
    label: 'Loop limit',
    category: 'flowchart',
    keywords: ['loop', 'repeat', 'for', 'while'],
    defaultSize: { width: 150, height: 80 },
    geometry: (w, h) => {
      const c = Math.min(w * 0.15, h * 0.35);
      return {
        outline: polygon([
          [c, 0],
          [w - c, 0],
          [w, c],
          [w, h],
          [0, h],
          [0, c],
        ]),
        labelBox: box(PAD, c / 2 + 4, w - PAD * 2, h - c / 2 - 12),
      };
    },
  },
];

const infrastructure: Def[] = [
  {
    key: 'database',
    label: 'Database',
    category: 'infrastructure',
    keywords: ['db', 'cylinder', 'sql', 'storage', 'postgres', 'mysql', 'data'],
    defaultSize: { width: 120, height: 110 },
    defaultStyle: { backgroundColor: '#e7f5ff', strokeColor: '#1971c2' },
    geometry: (w, h) => cylinder(w, h, 0),
  },
  {
    key: 'cache',
    label: 'Cache',
    category: 'infrastructure',
    keywords: ['redis', 'memcached', 'memory', 'fast', 'stacked'],
    defaultSize: { width: 120, height: 110 },
    defaultStyle: { backgroundColor: '#fff4e6', strokeColor: '#e8590c' },
    geometry: (w, h) => cylinder(w, h, 2),
  },
  {
    key: 'server',
    label: 'Server',
    category: 'infrastructure',
    keywords: ['host', 'machine', 'rack', 'backend', 'vm', 'compute'],
    defaultSize: { width: 110, height: 120 },
    defaultStyle: { backgroundColor: '#f8f9fa', strokeColor: '#343a40' },
    geometry: (w, h) => {
      const rackH = h * 0.64;
      const units = h >= 90 ? 3 : 2;
      const unit = rackH / units;
      const details: Path[] = [linePath({ x: 0, y: rackH }, { x: w, y: rackH })];
      const fills: Path[] = [];
      for (let i = 0; i < units; i++) {
        const top = i * unit;
        if (i > 0) details.push(linePath({ x: 0, y: top }, { x: w, y: top }));
        const cy = top + unit / 2;
        const slotEnd = Math.max(PAD + 4, w * 0.5);
        details.push(linePath({ x: PAD, y: cy - 3 }, { x: slotEnd, y: cy - 3 }));
        details.push(linePath({ x: PAD, y: cy + 3 }, { x: slotEnd, y: cy + 3 }));
        const r = Math.min(3, unit * 0.12, w * 0.04);
        fills.push(circlePath(w - PAD - r, cy, r));
        fills.push(circlePath(w - PAD - r * 4, cy, r));
      }
      return {
        outline: roundRect(0, 0, w, h, Math.min(6, w * 0.08)),
        details,
        fills,
        labelBox: box(6, rackH + 4, w - 12, h - rackH - 8),
      };
    },
  },
  {
    key: 'queue',
    label: 'Queue',
    category: 'infrastructure',
    keywords: ['message queue', 'kafka', 'rabbitmq', 'sqs', 'broker', 'topic', 'stream'],
    defaultSize: { width: 180, height: 70 },
    defaultStyle: { backgroundColor: '#f3f0ff', strokeColor: '#6741d9' },
    geometry: (w, h) => {
      const rx = Math.min(w * 0.12, h * 0.3);
      const outline = path()
        .moveTo(rx, 0)
        .lineTo(w - rx, 0)
        .arc(w - rx, h / 2, rx, h / 2, -PI / 2, PI / 2)
        .lineTo(rx, h)
        .arc(rx, h / 2, rx, h / 2, PI / 2, 1.5 * PI)
        .close()
        .build();
      return {
        outline,
        details: [
          path()
            .arc(w - rx, h / 2, rx, h / 2, -PI / 2, -1.5 * PI)
            .build(),
        ],
        labelBox: box(rx + 2, 4, w - rx * 3 - 4, h - 8),
      };
    },
  },
  {
    key: 'container',
    label: 'Container',
    category: 'infrastructure',
    keywords: ['group', 'box', 'header', 'boundary', 'docker', 'module'],
    defaultSize: { width: 260, height: 180 },
    defaultStyle: { backgroundColor: '#f8f9fa', strokeColor: '#495057' },
    geometry: (w, h) => {
      const hh = Math.min(32, h * 0.3);
      return {
        outline: roundRect(0, 0, w, h, Math.min(6, getCornerRadius(w, h))),
        details: [linePath({ x: 0, y: hh }, { x: w, y: hh })],
        labelBox: box(PAD, 2, w - PAD * 2, hh - 4),
      };
    },
  },
  {
    key: 'browser',
    label: 'Web browser',
    category: 'infrastructure',
    keywords: ['web', 'client', 'frontend', 'website', 'spa', 'window'],
    defaultSize: { width: 180, height: 120 },
    defaultStyle: { backgroundColor: '#ffffff', strokeColor: '#1971c2' },
    geometry: (w, h) => {
      const tb = Math.min(24, h * 0.25);
      const r = Math.min(3, tb * 0.15);
      const details: Path[] = [linePath({ x: 0, y: tb }, { x: w, y: tb })];
      const dots = w >= 40 ? 3 : 0;
      const fills: Path[] = [];
      for (let i = 0; i < dots; i++) fills.push(circlePath(10 + i * 8, tb / 2, r));
      if (w > 70)
        details.push(roundRect(10 + dots * 8, tb * 0.22, w - 18 - dots * 8, tb * 0.56, tb * 0.28));
      return {
        outline: roundRect(0, 0, w, h, Math.min(6, getCornerRadius(w, h))),
        details,
        fills,
        labelBox: box(PAD, tb + 6, w - PAD * 2, h - tb - 12),
      };
    },
  },
  {
    key: 'mobile',
    label: 'Mobile device',
    category: 'infrastructure',
    keywords: ['phone', 'app', 'ios', 'android', 'client', 'smartphone'],
    defaultSize: { width: 80, height: 140 },
    defaultStyle: { backgroundColor: '#ffffff', strokeColor: '#343a40' },
    geometry: (w, h) => {
      const sx = w * 0.08;
      const sy = h * 0.1;
      const sw = w * 0.84;
      const sh = h * 0.78;
      return {
        outline: roundRect(0, 0, w, h, Math.min(w * 0.15, 14)),
        details: [
          rectPath(sx, sy, sw, sh),
          linePath({ x: w * 0.4, y: h * 0.05 }, { x: w * 0.6, y: h * 0.05 }),
          circlePath(w / 2, h * 0.94, Math.min(w * 0.06, h * 0.03)),
        ],
        labelBox: box(sx + 4, sy + 4, sw - 8, sh - 8),
      };
    },
  },
  {
    key: 'lock',
    label: 'Lock',
    category: 'infrastructure',
    keywords: ['security', 'auth', 'padlock', 'secure', 'encryption', 'iam'],
    defaultSize: { width: 100, height: 120 },
    defaultStyle: { backgroundColor: '#fff9db', strokeColor: '#e67700' },
    geometry: (w, h) => {
      const bodyTop = h * 0.4;
      const sr = Math.min(w * 0.28, bodyTop * 0.9);
      const cy = sr + 1;
      const shackle = path()
        .moveTo(w / 2 - sr, bodyTop)
        .lineTo(w / 2 - sr, cy)
        .arc(w / 2, cy, sr, sr - 1, PI, 2 * PI)
        .lineTo(w / 2 + sr, bodyTop)
        .build();
      return {
        outline: roundRect(0, bodyTop, w, h - bodyTop, Math.min(8, w * 0.1)),
        details: [shackle],
        connectionOutline: rectPath(0, 0, w, h),
        labelBox: box(6, bodyTop + 6, w - 12, h - bodyTop - 12),
      };
    },
  },
];

const network: Def[] = [
  {
    key: 'load-balancer',
    label: 'Load balancer',
    category: 'network',
    keywords: ['lb', 'elb', 'alb', 'nginx', 'haproxy', 'traffic', 'proxy'],
    defaultSize: { width: 180, height: 70 },
    defaultStyle: { backgroundColor: '#e3fafc', strokeColor: '#0c8599' },
    geometry: (w, h) =>
      symbolCard(w, h, (x, y, s) => {
        const mid = { x: x + s * 0.42, y: y + s / 2 };
        const start = { x: x + s * 0.05, y: y + s / 2 };
        const ends = [
          { x: x + s * 0.92, y: y + s * 0.14 },
          { x: x + s * 0.92, y: y + s / 2 },
          { x: x + s * 0.92, y: y + s * 0.86 },
        ];
        const details: Path[] = [linePath(start, mid)];
        for (const e of ends) {
          details.push(linePath(mid, e));
          details.push(arrowHead(e, mid, s * 0.13));
        }
        return { details, fills: [circlePath(mid.x, mid.y, Math.max(1, s * 0.07))] };
      }),
  },
  {
    key: 'firewall',
    label: 'Firewall',
    category: 'network',
    keywords: ['security', 'waf', 'wall', 'bricks', 'network policy'],
    defaultSize: { width: 140, height: 100 },
    defaultStyle: { backgroundColor: '#fff5f5', strokeColor: '#e03131' },
    geometry: (w, h) => {
      const wallH = h * 0.62;
      const rows = 4;
      const rh = wallH / rows;
      const brick = Math.max(12, Math.min(w / 3, rh * 2.4));
      const details: Path[] = [];
      for (let r = 1; r <= rows; r++)
        details.push(linePath({ x: 0, y: r * rh }, { x: w, y: r * rh }));
      for (let r = 0; r < rows; r++) {
        const offset = r % 2 === 0 ? brick : brick / 2;
        for (let x = offset; x < w - 2; x += brick)
          details.push(linePath({ x, y: r * rh }, { x, y: (r + 1) * rh }));
      }
      return {
        outline: rectPath(0, 0, w, h),
        details,
        labelBox: box(6, wallH + 4, w - 12, h - wallH - 8),
      };
    },
  },
  {
    key: 'router',
    label: 'Router',
    category: 'network',
    keywords: ['network', 'gateway', 'switch', 'routing', 'nat'],
    defaultSize: { width: 110, height: 110 },
    defaultStyle: { backgroundColor: '#ebfbee', strokeColor: '#2f9e44' },
    elliptical: true,
    geometry: (w, h) => {
      const c = Math.min(w, h) * 0.4;
      const center = { x: w / 2, y: h * 0.4 };
      const details: Path[] = [];
      const dirs: [number, number, boolean][] = [
        [1, -1, true],
        [-1, 1, true],
        [1, 1, false],
        [-1, -1, false],
      ];
      for (const [dx, dy, outward] of dirs) {
        const inner = { x: center.x + dx * c * 0.12, y: center.y + dy * c * 0.12 };
        const outer = { x: center.x + dx * c * 0.45, y: center.y + dy * c * 0.45 };
        details.push(linePath(inner, outer));
        details.push(
          outward ? arrowHead(outer, inner, c * 0.14) : arrowHead(inner, outer, c * 0.14),
        );
      }
      return {
        outline: path()
          .arc(w / 2, h / 2, w / 2, h / 2, 0, 2 * PI)
          .close()
          .build(),
        details,
        labelBox: box(w * 0.2, h * 0.64, w * 0.6, h * 0.2),
        elliptical: true,
      };
    },
  },
];

const cloud: Def[] = [
  {
    key: 'cloud',
    label: 'Cloud',
    category: 'cloud',
    keywords: ['internet', 'aws', 'gcp', 'azure', 'saas', 'external'],
    defaultSize: { width: 180, height: 110 },
    defaultStyle: { backgroundColor: '#e7f5ff', strokeColor: '#1971c2' },
    geometry: (w, h) => ({
      outline: cloudOutline(w, h),
      labelBox: box(w * 0.18, h * 0.3, w * 0.64, h * 0.5),
    }),
  },
  {
    key: 'api-gateway',
    label: 'API gateway',
    category: 'cloud',
    keywords: ['api', 'gateway', 'rest', 'graphql', 'endpoint', 'kong', 'ingress'],
    defaultSize: { width: 180, height: 70 },
    defaultStyle: { backgroundColor: '#f3f0ff', strokeColor: '#7048e8' },
    geometry: (w, h) => {
      const s = Math.min(h * 0.3, w * 0.12);
      const cw = Math.min(h * 0.18, w * 0.06);
      const lx = s * 1.2 + cw;
      const rx = w - s * 1.2 - cw;
      return {
        outline: polygon([
          [s, 0],
          [w - s, 0],
          [w, h / 2],
          [w - s, h],
          [s, h],
          [0, h / 2],
        ]),
        details: [
          linePath({ x: lx, y: h * 0.34 }, { x: lx - cw, y: h / 2 }, { x: lx, y: h * 0.66 }),
          linePath({ x: rx, y: h * 0.34 }, { x: rx + cw, y: h / 2 }, { x: rx, y: h * 0.66 }),
        ],
        labelBox: box(lx + 4, 4, rx - lx - 8, h - 8),
      };
    },
  },
  {
    key: 'function',
    label: 'Function',
    category: 'cloud',
    keywords: ['lambda', 'serverless', 'faas', 'cloud function', 'handler'],
    defaultSize: { width: 170, height: 70 },
    defaultStyle: { backgroundColor: '#fff4e6', strokeColor: '#e8590c' },
    geometry: (w, h) =>
      symbolCard(w, h, (x, y, s) => ({
        details: [
          polyline([
            [x + s * 0.2, y + s * 0.1],
            [x + s * 0.36, y + s * 0.1],
            [x + s * 0.82, y + s * 0.9],
          ]),
          linePath({ x: x + s * 0.53, y: y + s * 0.42 }, { x: x + s * 0.2, y: y + s * 0.9 }),
        ],
      })),
  },
  {
    key: 'storage-bucket',
    label: 'Storage bucket',
    category: 'cloud',
    keywords: ['s3', 'blob', 'object storage', 'gcs', 'files', 'bucket'],
    defaultSize: { width: 120, height: 110 },
    defaultStyle: { backgroundColor: '#ebfbee', strokeColor: '#2b8a3e' },
    geometry: (w, h) => {
      const ry = Math.min(h * 0.12, w * 0.2);
      const inset = w * 0.12;
      const rx2 = w / 2 - inset;
      const ry2 = ry * 0.6;
      const outline = path()
        .arc(w / 2, ry, w / 2, ry, PI, 2 * PI)
        .lineTo(w / 2 + rx2, h - ry2)
        .arc(w / 2, h - ry2, rx2, ry2, 0, PI)
        .close()
        .build();
      return {
        outline,
        details: [
          path()
            .arc(w / 2, ry, w / 2, ry, 0, PI)
            .build(),
        ],
        labelBox: box(inset + 4, ry * 2 + 6, w - inset * 2 - 8, h - ry * 2 - ry2 - 12),
      };
    },
  },
  {
    key: 'cdn',
    label: 'CDN',
    category: 'cloud',
    keywords: ['content delivery', 'edge', 'cloudfront', 'akamai', 'cache', 'globe'],
    defaultSize: { width: 170, height: 70 },
    defaultStyle: { backgroundColor: '#e6fcf5', strokeColor: '#099268' },
    geometry: (w, h) =>
      symbolCard(w, h, (x, y, s) => {
        const cx = x + s / 2;
        const cy = y + s / 2;
        const r = s * 0.46;
        return {
          details: [
            circlePath(cx, cy, r),
            path()
              .arc(cx, cy, r * 0.42, r, 0, 2 * PI)
              .close()
              .build(),
            linePath({ x: cx - r, y: cy }, { x: cx + r, y: cy }),
            linePath({ x: cx - r * 0.86, y: cy - r * 0.5 }, { x: cx + r * 0.86, y: cy - r * 0.5 }),
            linePath({ x: cx - r * 0.86, y: cy + r * 0.5 }, { x: cx + r * 0.86, y: cy + r * 0.5 }),
          ],
        };
      }),
  },
];

const uml: Def[] = [
  {
    key: 'actor',
    label: 'Actor',
    category: 'uml',
    keywords: ['stick figure', 'user', 'person', 'role', 'use case'],
    defaultSize: { width: 80, height: 120 },
    defaultStyle: { backgroundColor: '#ffffff' },
    geometry: (w, h) => {
      const fh = h * 0.74;
      const cx = w / 2;
      const r = Math.min(fh * 0.13, w * 0.2);
      const headY = r + 1;
      const hip = fh * 0.64;
      const shoulder = 2 * r + 2 + (hip - 2 * r) * 0.28;
      const fw = Math.min(w * 0.8, fh * 0.6);
      return {
        outline: circlePath(cx, headY, r),
        details: [
          linePath({ x: cx, y: headY + r }, { x: cx, y: hip }),
          linePath({ x: cx - fw / 2, y: shoulder }, { x: cx + fw / 2, y: shoulder }),
          linePath({ x: cx - fw * 0.38, y: fh }, { x: cx, y: hip }, { x: cx + fw * 0.38, y: fh }),
        ],
        connectionOutline: rectPath(0, 0, w, h),
        labelBox: box(0, fh + 2, w, h - fh - 2),
      };
    },
  },
  {
    key: 'component',
    label: 'Component',
    category: 'uml',
    keywords: ['module', 'service', 'package', 'library', 'uml component'],
    defaultSize: { width: 170, height: 90 },
    defaultStyle: { backgroundColor: '#f8f0fc', strokeColor: '#9c36b5' },
    geometry: (w, h) => {
      const o = Math.min(12, w * 0.08);
      const th = Math.min(h * 0.16, 14);
      const t1 = h * 0.22;
      const t2 = t1 + th + Math.max(6, h * 0.12);
      const outline = path()
        .moveTo(o, 0)
        .lineTo(w, 0)
        .lineTo(w, h)
        .lineTo(o, h)
        .lineTo(o, t2 + th)
        .lineTo(0, t2 + th)
        .lineTo(0, t2)
        .lineTo(o, t2)
        .lineTo(o, t1 + th)
        .lineTo(0, t1 + th)
        .lineTo(0, t1)
        .lineTo(o, t1)
        .close()
        .build();
      return {
        outline,
        details: [
          linePath(
            { x: o, y: t1 },
            { x: 2 * o, y: t1 },
            { x: 2 * o, y: t1 + th },
            { x: o, y: t1 + th },
          ),
          linePath(
            { x: o, y: t2 },
            { x: 2 * o, y: t2 },
            { x: 2 * o, y: t2 + th },
            { x: o, y: t2 + th },
          ),
        ],
        labelBox: box(2 * o + PAD, PAD, w - 2 * o - PAD * 2, h - PAD * 2),
      };
    },
  },
  {
    key: 'package',
    label: 'Package',
    category: 'uml',
    keywords: ['folder', 'namespace', 'module', 'uml package'],
    defaultSize: { width: 180, height: 120 },
    defaultStyle: { backgroundColor: '#fff9db', strokeColor: '#e67700' },
    geometry: (w, h) => {
      // UML places the package name in the tab, leaving the body for contained elements.
      const th = Math.min(26, h * 0.22);
      const tw = Math.min(Math.max(w * 0.4, 70), w);
      return {
        outline: polygon([
          [0, 0],
          [tw, 0],
          [tw, th],
          [w, th],
          [w, h],
          [0, h],
        ]),
        details: [linePath({ x: 0, y: th }, { x: tw, y: th })],
        labelBox: box(6, 2, tw - 12, th - 4),
      };
    },
  },
  {
    key: 'note',
    label: 'Note',
    category: 'uml',
    keywords: ['comment', 'annotation', 'folded corner', 'memo'],
    defaultSize: { width: 160, height: 90 },
    defaultStyle: { backgroundColor: '#fff9db', strokeColor: '#868e96' },
    geometry: (w, h) => {
      const f = Math.min(16, w * 0.25, h * 0.25);
      return {
        outline: polygon([
          [0, 0],
          [w - f, 0],
          [w, f],
          [w, h],
          [0, h],
        ]),
        details: [linePath({ x: w - f, y: 0 }, { x: w - f, y: f }, { x: w, y: f })],
        labelBox: box(PAD, PAD, w - f - PAD, h - PAD * 2),
      };
    },
  },
  {
    key: 'state',
    label: 'State',
    category: 'uml',
    keywords: ['status', 'stage', 'state machine', 'rounded'],
    defaultSize: { width: 150, height: 70 },
    defaultStyle: { backgroundColor: '#e7f5ff', strokeColor: '#1971c2' },
    geometry: (w, h) => ({
      outline: roundRect(0, 0, w, h, Math.min(16, h / 3, w / 3)),
      labelBox: fullLabel(w, h),
    }),
  },
  {
    key: 'initial-state',
    label: 'Initial state',
    category: 'uml',
    keywords: ['start', 'begin', 'entry', 'filled circle'],
    defaultSize: { width: 30, height: 30 },
    defaultStyle: { backgroundColor: '#1e1e1e', strokeColor: '#1e1e1e' },
    elliptical: true,
    geometry: (w, h) => ({
      outline: circlePath(w / 2, h / 2, Math.min(w, h) / 2),
      labelBox: box(0, 0, w, h),
      elliptical: true,
    }),
  },
  {
    key: 'final-state',
    label: 'Final state',
    category: 'uml',
    keywords: ['end', 'stop', 'exit', 'bullseye'],
    defaultSize: { width: 34, height: 34 },
    defaultStyle: { backgroundColor: '#ffffff', strokeColor: '#1e1e1e' },
    elliptical: true,
    geometry: (w, h) => {
      const r = Math.min(w, h) / 2;
      return {
        outline: circlePath(w / 2, h / 2, r),
        fills: [circlePath(w / 2, h / 2, r * 0.58)],
        labelBox: box(0, 0, w, h),
        elliptical: true,
      };
    },
  },
  {
    key: 'fork-join',
    label: 'Fork / join',
    category: 'uml',
    keywords: ['fork', 'join', 'bar', 'synchronization', 'parallel'],
    defaultSize: { width: 160, height: 10 },
    defaultStyle: { backgroundColor: '#1e1e1e', strokeColor: '#1e1e1e', roundness: 'sharp' },
    geometry: (w, h) => ({ outline: rectPath(0, 0, w, h), labelBox: box(0, 0, w, h) }),
    ports: () => [
      { id: 'top', side: 'top', offset: 0.5 },
      { id: 'top-1', side: 'top', offset: 0.2 },
      { id: 'top-3', side: 'top', offset: 0.8 },
      { id: 'right', side: 'right', offset: 0.5 },
      { id: 'bottom', side: 'bottom', offset: 0.5 },
      { id: 'bottom-1', side: 'bottom', offset: 0.2 },
      { id: 'bottom-3', side: 'bottom', offset: 0.8 },
      { id: 'left', side: 'left', offset: 0.5 },
    ],
  },
  {
    key: 'use-case',
    label: 'Use case',
    category: 'uml',
    keywords: ['ellipse', 'scenario', 'feature', 'oval'],
    defaultSize: { width: 170, height: 80 },
    defaultStyle: { backgroundColor: '#ffffff' },
    elliptical: true,
    geometry: (w, h) => ({
      outline: path()
        .arc(w / 2, h / 2, w / 2, h / 2, 0, 2 * PI)
        .close()
        .build(),
      labelBox: box(w * 0.1464, h * 0.1464, w * 0.7071, h * 0.7071),
      elliptical: true,
    }),
  },
  {
    key: 'system-boundary',
    label: 'System boundary',
    category: 'uml',
    keywords: ['system', 'boundary', 'subject', 'use case', 'scope'],
    defaultSize: { width: 320, height: 380 },
    defaultStyle: { backgroundColor: 'transparent', roundness: 'sharp' },
    geometry: (w, h) => ({
      outline: rectPath(0, 0, w, h),
      labelBox: box(PAD, 6, w - PAD * 2, Math.min(28, h * 0.15)),
    }),
  },
  {
    key: 'swimlane',
    label: 'Swimlane',
    category: 'uml',
    keywords: ['lane', 'pool', 'column', 'responsibility', 'activity'],
    defaultSize: { width: 280, height: 420 },
    defaultStyle: { backgroundColor: 'transparent', roundness: 'sharp' },
    geometry: (w, h) => {
      const hh = Math.min(36, h * 0.2);
      return {
        outline: rectPath(0, 0, w, h),
        details: [linePath({ x: 0, y: hh }, { x: w, y: hh })],
        labelBox: box(PAD, 2, w - PAD * 2, hh - 4),
      };
    },
  },
];

const people: Def[] = [
  {
    key: 'user',
    label: 'User',
    category: 'people',
    keywords: ['person', 'customer', 'account', 'profile', 'human', 'silhouette'],
    defaultSize: { width: 90, height: 110 },
    defaultStyle: { backgroundColor: '#e7f5ff', strokeColor: '#1971c2' },
    geometry: (w, h) => {
      const fh = h * 0.72;
      const cx = w / 2;
      const r = Math.min(fh * 0.22, w * 0.2);
      const headY = fh * 0.28;
      const bh = fh * 0.42;
      const bw = Math.min(w * 0.85, fh * 0.8);
      const rr = Math.min(bw * 0.4, bh);
      const top = fh - bh;
      const bust = path()
        .moveTo(cx - bw / 2, fh)
        .lineTo(cx - bw / 2, top + rr)
        .arc(cx - bw / 2 + rr, top + rr, rr, rr, PI, 1.5 * PI)
        .lineTo(cx + bw / 2 - rr, top)
        .arc(cx + bw / 2 - rr, top + rr, rr, rr, 1.5 * PI, 2 * PI)
        .lineTo(cx + bw / 2, fh)
        .close()
        .build();
      return {
        outline: joinPaths(circlePath(cx, Math.max(r, headY), r), bust),
        connectionOutline: rectPath(0, 0, w, h),
        labelBox: box(0, fh + 2, w, h - fh - 2),
      };
    },
  },
  {
    key: 'org-card',
    label: 'Org chart card',
    category: 'people',
    keywords: ['org chart', 'employee', 'team member', 'manager', 'hierarchy', 'person card'],
    defaultSize: { width: 200, height: 70 },
    defaultStyle: { backgroundColor: '#ffffff', strokeColor: '#1971c2' },
    geometry: (w, h) => {
      const ar = Math.min(h * 0.3, 22, w * 0.15);
      const acx = PAD + ar;
      const tx = acx + ar + PAD;
      const tw = w - tx - PAD;
      return {
        outline: roundRect(0, 0, w, h, Math.min(8, getCornerRadius(w, h))),
        details: [circlePath(acx, h / 2, ar)],
        fills: [
          circlePath(acx, h / 2 - ar * 0.25, ar * 0.32),
          path()
            .arc(acx, h / 2 + ar * 0.62, ar * 0.55, ar * 0.32, PI, 2 * PI)
            .close()
            .build(),
        ],
        labelBox: box(tx, 6, tw, h / 2 - 6),
        subtitleBox: box(tx, h / 2, tw, h / 2 - 6),
        iconBox: box(acx - ar, h / 2 - ar, ar * 2, ar * 2),
      };
    },
  },
];

const misc: Def[] = [
  {
    key: 'sticky',
    label: 'Sticky note',
    category: 'misc',
    keywords: ['post-it', 'note', 'idea', 'kanban', 'card', 'retro'],
    defaultSize: { width: 160, height: 140 },
    defaultStyle: { backgroundColor: '#ffec99', strokeColor: '#e6a700', roundness: 'sharp' },
    geometry: (w, h) => {
      const c = Math.min(18, w * 0.15, h * 0.15);
      return {
        outline: polygon([
          [0, 0],
          [w, 0],
          [w, h - c],
          [w - c, h],
          [0, h],
        ]),
        details: [
          path()
            .moveTo(w, h - c)
            .quadTo(w - c * 0.95, h - c * 0.95, w - c, h)
            .build(),
        ],
        labelBox: box(10, 10, w - 20, h - c - 12),
      };
    },
  },
  {
    key: 'mind-map-topic',
    label: 'Mind map topic',
    category: 'misc',
    keywords: ['topic', 'idea', 'branch', 'brainstorm', 'bubble'],
    defaultSize: { width: 150, height: 50 },
    defaultStyle: { backgroundColor: '#f3f0ff', strokeColor: '#7048e8', roundness: 'round' },
    geometry: (w, h) => {
      const r = Math.min(h / 2, 22);
      return { outline: roundRect(0, 0, w, h, r), labelBox: box(r * 0.6, 4, w - r * 1.2, h - 8) };
    },
  },
  {
    key: 'custom',
    label: 'Custom shape',
    category: 'misc',
    keywords: ['svg', 'path', 'freeform', 'custom'],
    defaultSize: { width: 120, height: 120 },
    geometry: (w, h, el) => customGeometry(w, h, el),
  },
];

/** Custom shapes: `node.customPath` in a 0–100 box scaled to the node size. */
export function customGeometry(w: number, h: number, el?: NodeElement): ShapeGeometry {
  const fallback = { outline: rectPath(0, 0, w, h), labelBox: fullLabel(w, h) };
  const d = el?.customPath;
  if (!d) return fallback;
  let parsed: Path;
  try {
    parsed = parseSvgPath(d);
  } catch {
    return fallback;
  }
  if (parsed.length === 0 || parsed[0]!.type !== 'M') return fallback;
  const outline = transformPath(parsed, w / 100, h / 100);
  if (outline[outline.length - 1]!.type !== 'Z') outline.push({ type: 'Z' });
  return { outline, labelBox: box(w * 0.15, h * 0.15, w * 0.7, h * 0.7) };
}

/**
 * Shapes that group other nodes. They are drawn beneath their contents and connectors may cross
 * them freely (they are never routing obstacles).
 */
export const CONTAINER_SHAPE_KEYS: ReadonlySet<string> = new Set([
  'container',
  'swimlane',
  'system-boundary',
  'package',
]);

export const BUILTIN_SHAPES: NodeShapeDefinition[] = [
  ...basic,
  ...flowchart,
  ...infrastructure,
  ...network,
  ...cloud,
  ...uml,
  ...people,
  ...misc,
].map((def) => (def.ports ? def : { ...def, ports: sidePorts }));
