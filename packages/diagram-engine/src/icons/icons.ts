import type { IconDefinition } from '../types';

/*
 * Geometry helpers. Every icon below is composed from these primitives (or hand-written path
 * data) in a 24×24 box, drawn to read well with 2px round strokes. All output uses absolute
 * commands only and always separates arc flags with spaces.
 */

/** Formats a coordinate with at most two decimals (no trailing zeros, no "-0"). */
function n(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return (Object.is(rounded, -0) ? 0 : rounded).toString();
}

/** "x y" pair. */
function p(x: number, y: number): string {
  return `${n(x)} ${n(y)}`;
}

/** Point on a circle; angles in degrees, 0° = +x, increasing clockwise (SVG y-down). */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function pp(pt: [number, number]): string {
  return p(pt[0], pt[1]);
}

/** Full circle as two half arcs. */
function circle(cx: number, cy: number, r: number): string {
  const rs = `${n(r)} ${n(r)}`;
  return `M${p(cx - r, cy)}A${rs} 0 1 0 ${p(cx + r, cy)}A${rs} 0 1 0 ${p(cx - r, cy)}Z`;
}

/** Full ellipse as two half arcs. */
function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  const rs = `${n(rx)} ${n(ry)}`;
  return `M${p(cx - rx, cy)}A${rs} 0 1 0 ${p(cx + rx, cy)}A${rs} 0 1 0 ${p(cx - rx, cy)}Z`;
}

/** Rectangle with optional circular corner radius. */
function rect(x: number, y: number, w: number, h: number, r = 0): string {
  if (r <= 0) return `M${p(x, y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`;
  const a = `A${n(r)} ${n(r)} 0 0 1 `;
  return (
    `M${p(x + r, y)}H${n(x + w - r)}${a}${p(x + w, y + r)}V${n(y + h - r)}` +
    `${a}${p(x + w - r, y + h)}H${n(x + r)}${a}${p(x, y + h - r)}V${n(y + r)}${a}${p(x + r, y)}Z`
  );
}

/** Straight line segment. */
function line(x1: number, y1: number, x2: number, y2: number): string {
  return `M${p(x1, y1)}L${p(x2, y2)}`;
}

/** Open (or closed) polyline through the given points. */
function poly(points: [number, number][], closed = false): string {
  const body = points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pp(pt)}`).join('');
  return closed ? `${body}Z` : body;
}

/** Regular polygon; first vertex at `startDeg`. */
function regularPolygon(cx: number, cy: number, r: number, sides: number, startDeg: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < sides; i++) pts.push(polar(cx, cy, r, startDeg + (i * 360) / sides));
  return poly(pts, true);
}

/** Star polygon alternating outer/inner radii, first tip pointing up. */
function starPath(cx: number, cy: number, rOuter: number, rInner: number, tips: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < tips * 2; i++) {
    pts.push(polar(cx, cy, i % 2 === 0 ? rOuter : rInner, -90 + (i * 180) / tips));
  }
  return poly(pts, true);
}

/** Cog outline with flat-topped teeth joined by arcs on the root circle. */
function cog(cx: number, cy: number, rOuter: number, rInner: number, teeth: number): string {
  const step = 360 / teeth;
  const tipHalf = step * 0.2;
  const rootHalf = step * 0.28;
  const ao = `A${n(rOuter)} ${n(rOuter)} 0 0 1 `;
  const ai = `A${n(rInner)} ${n(rInner)} 0 0 1 `;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = -90 + i * step;
    d += `${i === 0 ? 'M' : 'L'}${pp(polar(cx, cy, rInner, a - rootHalf))}`;
    d += `L${pp(polar(cx, cy, rOuter, a - tipHalf))}`;
    d += `${ao}${pp(polar(cx, cy, rOuter, a + tipHalf))}`;
    d += `L${pp(polar(cx, cy, rInner, a + rootHalf))}`;
    d += `${ai}${pp(polar(cx, cy, rInner, a + step - rootHalf))}`;
  }
  return `${d}Z`;
}

/** Stadium (pill) shape centred on (cx, cy), long axis rotated by `deg`. */
function pill(cx: number, cy: number, halfLen: number, r: number, deg: number): string {
  const rad = (deg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  // Normal pointing to the left of the long axis (screen space).
  const nx = uy;
  const ny = -ux;
  const c1x = cx - ux * halfLen;
  const c1y = cy - uy * halfLen;
  const c2x = cx + ux * halfLen;
  const c2y = cy + uy * halfLen;
  const a = `A${n(r)} ${n(r)} 0 0 1 `;
  return (
    `M${p(c1x + nx * r, c1y + ny * r)}L${p(c2x + nx * r, c2y + ny * r)}` +
    `${a}${p(c2x - nx * r, c2y - ny * r)}L${p(c1x - nx * r, c1y - ny * r)}` +
    `${a}${p(c1x + nx * r, c1y + ny * r)}Z`
  );
}

/** Spokes radiating from (cx, cy) between two radii. */
function spokes(cx: number, cy: number, r1: number, r2: number, count: number, startDeg: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const deg = startDeg + (i * 360) / count;
    out.push(`M${pp(polar(cx, cy, r1, deg))}L${pp(polar(cx, cy, r2, deg))}`);
  }
  return out;
}

/** Shared document outline (page with folded top-right corner). */
const PAGE = 'M14 2H6.5A2 2 0 0 0 4.5 4V20A2 2 0 0 0 6.5 22H17.5A2 2 0 0 0 19.5 20V7.5Z';
const PAGE_FOLD = 'M14 2V6.5A1 1 0 0 0 15 7.5H19.5';

/** Built-in icons: original Lucide-style drawings in a 24×24 box, 2px round strokes. */
export const BUILTIN_ICONS: IconDefinition[] = [
  // ─── Infrastructure ────────────────────────────────────────────────────────────────
  {
    key: 'server',
    label: 'Server',
    category: 'infrastructure',
    keywords: ['server', 'host', 'machine', 'rack', 'backend'],
    paths: [rect(3, 3, 18, 7, 2), rect(3, 14, 18, 7, 2), line(11, 6.5, 17, 6.5), line(11, 17.5, 17, 17.5)],
    fills: [circle(7, 6.5, 1.1), circle(7, 17.5, 1.1)],
  },
  {
    key: 'cloud',
    label: 'Cloud',
    category: 'infrastructure',
    keywords: ['cloud', 'hosting', 'aws', 'azure', 'gcp'],
    paths: ['M7 19H17.5A4.5 4.5 0 0 0 17.5 10A5.5 5.5 0 0 0 6.6 11.02A4 4 0 0 0 7 19Z'],
  },
  {
    key: 'box',
    label: 'Box',
    category: 'infrastructure',
    keywords: ['box', 'carton', 'storage', 'archive', 'container'],
    paths: [rect(2, 3, 20, 5, 1), 'M4 8V19A2 2 0 0 0 6 21H18A2 2 0 0 0 20 19V8', line(9.5, 12, 14.5, 12)],
  },
  {
    key: 'container',
    label: 'Container',
    category: 'infrastructure',
    keywords: ['container', 'docker', 'image', 'shipping', 'oci'],
    paths: [
      rect(2, 6, 20, 12, 1.5),
      line(6, 9, 6, 15),
      line(10, 9, 10, 15),
      line(14, 9, 14, 15),
      line(18, 9, 18, 15),
    ],
  },
  {
    key: 'kubernetes',
    label: 'Kubernetes',
    category: 'infrastructure',
    keywords: ['kubernetes', 'k8s', 'cluster', 'orchestration', 'helm'],
    paths: [circle(12, 12, 7.5), circle(12, 12, 2.5), ...spokes(12, 12, 2.5, 10, 7, -90)],
  },
  {
    key: 'function',
    label: 'Function',
    category: 'infrastructure',
    keywords: ['function', 'lambda', 'serverless', 'faas', 'compute'],
    paths: [
      'M6 4H7.5C8.5 4 9.3 4.6 9.7 5.5L16.3 19.5C16.7 20.4 17.5 21 18.5 21H19',
      line(12.67, 11.8, 6, 21),
    ],
  },
  {
    key: 'load-balancer',
    label: 'Load balancer',
    category: 'infrastructure',
    keywords: ['load balancer', 'lb', 'traffic', 'distribute', 'proxy'],
    paths: [
      circle(12, 5, 2.5),
      circle(4.5, 19, 2.5),
      circle(12, 19, 2.5),
      circle(19.5, 19, 2.5),
      line(12, 7.5, 12, 16.5),
      line(10.82, 7.2, 5.68, 16.8),
      line(13.18, 7.2, 18.32, 16.8),
    ],
  },
  {
    key: 'microservice',
    label: 'Microservice',
    category: 'infrastructure',
    keywords: ['microservice', 'service', 'hexagon', 'module', 'component'],
    paths: [regularPolygon(12, 12, 10, 6, -90), regularPolygon(12, 12, 4, 6, -90)],
  },
  {
    key: 'worker',
    label: 'Worker',
    category: 'infrastructure',
    keywords: ['worker', 'job', 'process', 'daemon', 'background'],
    paths: [circle(8, 7.5, 3.5), 'M2 20A6.5 6.5 0 0 1 15 20', circle(17.5, 8.5, 2), ...spokes(17.5, 8.5, 2, 4.5, 6, -90)],
  },
  {
    key: 'cpu',
    label: 'CPU',
    category: 'infrastructure',
    keywords: ['cpu', 'processor', 'chip', 'compute', 'core'],
    paths: [
      rect(6, 6, 12, 12, 1.5),
      rect(9.5, 9.5, 5, 5, 0.5),
      line(10, 3, 10, 6),
      line(14, 3, 14, 6),
      line(10, 18, 10, 21),
      line(14, 18, 14, 21),
      line(3, 10, 6, 10),
      line(3, 14, 6, 14),
      line(18, 10, 21, 10),
      line(18, 14, 21, 14),
    ],
  },
  {
    key: 'worker-pool',
    label: 'Worker pool',
    category: 'infrastructure',
    keywords: ['workers', 'pool', 'replicas', 'scale', 'instances'],
    paths: [rect(2, 9, 8, 8, 1.5), rect(8, 5, 8, 8, 1.5), rect(14, 9, 8, 8, 1.5)],
  },

  // ─── Data ──────────────────────────────────────────────────────────────────────────
  {
    key: 'database',
    label: 'Database',
    category: 'data',
    keywords: ['database', 'db', 'sql', 'storage', 'postgres'],
    paths: [ellipse(12, 5, 8, 3), 'M4 5V18.5A8 3 0 0 0 20 18.5V5', 'M4 11.75A8 3 0 0 0 20 11.75'],
  },
  {
    key: 'queue',
    label: 'Queue',
    category: 'data',
    keywords: ['queue', 'messages', 'kafka', 'sqs', 'broker'],
    paths: [line(2, 6, 22, 6), line(2, 18, 22, 18), rect(4, 9, 4, 6, 1), rect(10, 9, 4, 6, 1), rect(16, 9, 4, 6, 1)],
  },
  {
    key: 'cache',
    label: 'Cache',
    category: 'data',
    keywords: ['cache', 'memory', 'redis', 'ram', 'fast'],
    paths: [
      rect(2, 6, 20, 10, 2),
      line(6, 16, 6, 19),
      line(10, 16, 10, 19),
      line(14, 16, 14, 19),
      line(18, 16, 18, 19),
      poly([
        [13, 8.5],
        [10.5, 11.5],
        [13.5, 11.5],
        [11, 14.5],
      ]),
    ],
  },
  {
    key: 'bucket',
    label: 'Bucket',
    category: 'data',
    keywords: ['bucket', 's3', 'object storage', 'blob', 'pail'],
    paths: [ellipse(12, 6, 9, 3), 'M3 6L5 19A7 2.5 0 0 0 19 19L21 6'],
  },
  {
    key: 'hard-drive',
    label: 'Hard drive',
    category: 'data',
    keywords: ['hard drive', 'disk', 'hdd', 'storage', 'volume'],
    paths: [rect(4, 2, 16, 20, 2), circle(12, 10, 5), line(16.5, 18.5, 13, 11.5)],
    fills: [circle(12, 10, 1), circle(16.5, 18.5, 1)],
  },
  {
    key: 'layers',
    label: 'Layers',
    category: 'data',
    keywords: ['layers', 'stack', 'tiers', 'levels', 'overlay'],
    paths: [
      poly(
        [
          [12, 3],
          [21, 8],
          [12, 13],
          [3, 8],
        ],
        true,
      ),
      poly([
        [3, 12.5],
        [12, 17.5],
        [21, 12.5],
      ]),
      poly([
        [3, 17],
        [12, 22],
        [21, 17],
      ]),
    ],
  },
  {
    key: 'package',
    label: 'Package',
    category: 'data',
    keywords: ['package', 'parcel', 'module', 'npm', 'bundle'],
    paths: [
      'M12 2.5L20.5 7.25V16.75L12 21.5L3.5 16.75V7.25Z',
      'M3.5 7.25L12 12L20.5 7.25',
      line(12, 12, 12, 21.5),
      'M7.75 4.88L16.25 9.63V14.38',
    ],
  },

  // ─── Network ───────────────────────────────────────────────────────────────────────
  {
    key: 'api',
    label: 'API',
    category: 'network',
    keywords: ['api', 'endpoint', 'rest', 'integration', 'plug'],
    paths: [line(9, 3, 9, 8), line(15, 3, 15, 8), 'M6 8H18V11A6 6 0 0 1 6 11Z', line(12, 17, 12, 21)],
  },
  {
    key: 'globe',
    label: 'Globe',
    category: 'network',
    keywords: ['globe', 'internet', 'web', 'world', 'public'],
    paths: [circle(12, 12, 10), ellipse(12, 12, 4, 10), line(2.84, 8, 21.16, 8), line(2.84, 16, 21.16, 16)],
  },
  {
    key: 'cdn',
    label: 'CDN',
    category: 'network',
    keywords: ['cdn', 'edge', 'distribution', 'cache', 'cloudfront'],
    paths: [
      circle(12, 12, 3),
      circle(5, 5, 2),
      circle(19, 5, 2),
      circle(5, 19, 2),
      circle(19, 19, 2),
      line(9.88, 9.88, 6.41, 6.41),
      line(14.12, 9.88, 17.59, 6.41),
      line(9.88, 14.12, 6.41, 17.59),
      line(14.12, 14.12, 17.59, 17.59),
    ],
  },
  {
    key: 'router',
    label: 'Router',
    category: 'network',
    keywords: ['router', 'gateway', 'modem', 'switch', 'lan'],
    paths: [rect(2, 13, 20, 7, 2), line(6, 13, 6, 6), line(18, 13, 18, 6), line(14, 16.5, 18, 16.5)],
    fills: [circle(6, 16.5, 1), circle(9.5, 16.5, 1)],
  },
  {
    key: 'network',
    label: 'Network',
    category: 'network',
    keywords: ['network', 'topology', 'lan', 'hierarchy', 'nodes'],
    paths: [
      rect(9, 2, 6, 5, 1),
      rect(2, 17, 6, 5, 1),
      rect(9, 17, 6, 5, 1),
      rect(16, 17, 6, 5, 1),
      line(12, 7, 12, 17),
      'M5 17V12H19V17',
    ],
  },
  {
    key: 'wifi',
    label: 'Wi-Fi',
    category: 'network',
    keywords: ['wifi', 'wireless', 'signal', 'hotspot', 'connectivity'],
    paths: [
      'M8.82 16.82A4.5 4.5 0 0 1 15.18 16.82',
      'M5.64 13.64A9 9 0 0 1 18.36 13.64',
      'M2.45 10.45A13.5 13.5 0 0 1 21.55 10.45',
    ],
    fills: [circle(12, 20, 1.3)],
  },
  {
    key: 'link',
    label: 'Link',
    category: 'network',
    keywords: ['link', 'chain', 'url', 'connect', 'hyperlink'],
    paths: [pill(9, 15, 2.5, 3.5, -45), pill(15, 9, 2.5, 3.5, -45)],
  },

  // ─── Security ──────────────────────────────────────────────────────────────────────
  {
    key: 'lock',
    label: 'Lock',
    category: 'security',
    keywords: ['lock', 'secure', 'private', 'encrypted', 'locked'],
    paths: [rect(5, 11, 14, 10, 2), 'M8 11V7A4 4 0 0 1 16 7V11', line(12, 15, 12, 17)],
  },
  {
    key: 'unlock',
    label: 'Unlock',
    category: 'security',
    keywords: ['unlock', 'open', 'unlocked', 'public', 'access'],
    paths: [rect(5, 11, 14, 10, 2), 'M8 11V7A4 4 0 0 1 15.7 5.5', line(12, 15, 12, 17)],
  },
  {
    key: 'firewall',
    label: 'Firewall',
    category: 'security',
    keywords: ['firewall', 'wall', 'bricks', 'waf', 'block'],
    paths: [
      rect(3, 4, 18, 16, 1),
      line(3, 8, 21, 8),
      line(3, 12, 21, 12),
      line(3, 16, 21, 16),
      line(12, 4, 12, 8),
      line(7.5, 8, 7.5, 12),
      line(16.5, 8, 16.5, 12),
      line(12, 12, 12, 16),
      line(7.5, 16, 7.5, 20),
      line(16.5, 16, 16.5, 20),
    ],
  },
  {
    key: 'shield',
    label: 'Shield',
    category: 'security',
    keywords: ['shield', 'security', 'protection', 'defense', 'safe'],
    paths: ['M12 2L20 5V11C20 16 16.5 19.8 12 22C7.5 19.8 4 16 4 11V5Z'],
  },
  {
    key: 'key',
    label: 'Key',
    category: 'security',
    keywords: ['key', 'secret', 'credential', 'auth', 'password'],
    paths: [circle(7.5, 15.5, 4.5), line(10.68, 12.32, 20, 3), line(17, 6, 19, 8), line(14.5, 8.5, 16.5, 10.5)],
  },

  // ─── People ────────────────────────────────────────────────────────────────────────
  {
    key: 'user',
    label: 'User',
    category: 'people',
    keywords: ['user', 'person', 'account', 'profile', 'actor'],
    paths: [circle(12, 8, 4), 'M4 21V20A5 5 0 0 1 9 15H15A5 5 0 0 1 20 20V21'],
  },
  {
    key: 'users',
    label: 'Users',
    category: 'people',
    keywords: ['users', 'people', 'team', 'group', 'members'],
    paths: [
      circle(9, 8, 4),
      'M2 21V20A5 5 0 0 1 7 15H11A5 5 0 0 1 16 20V21',
      'M14.5 4.29A4 4 0 0 1 14.5 11.71',
      'M18 15.2C20.3 15.8 22 17.8 22 20.2V21',
    ],
  },

  // ─── Devices ───────────────────────────────────────────────────────────────────────
  {
    key: 'mobile',
    label: 'Mobile',
    category: 'devices',
    keywords: ['mobile', 'phone', 'smartphone', 'ios', 'android'],
    paths: [rect(6, 2, 12, 20, 2.5), line(10.5, 18.5, 13.5, 18.5)],
  },
  {
    key: 'laptop',
    label: 'Laptop',
    category: 'devices',
    keywords: ['laptop', 'notebook', 'computer', 'client', 'macbook'],
    paths: [rect(5, 4, 14, 11, 1.5), 'M2 18.5L4 15H20L22 18.5V19A1 1 0 0 1 21 20H3A1 1 0 0 1 2 19Z'],
  },
  {
    key: 'monitor',
    label: 'Monitor',
    category: 'devices',
    keywords: ['monitor', 'screen', 'display', 'desktop', 'browser'],
    paths: [rect(2, 3, 20, 13.5, 2.5), 'M9 16.5L8 21H16L15 16.5'],
  },
  {
    key: 'printer',
    label: 'Printer',
    category: 'devices',
    keywords: ['printer', 'print', 'paper', 'output', 'office'],
    paths: ['M7 8V3H17V8', rect(2, 8, 20, 9, 2), line(5, 14, 19, 14), 'M6 14V21H18V14'],
    fills: [circle(18, 11, 1)],
  },

  // ─── Files ─────────────────────────────────────────────────────────────────────────
  {
    key: 'file',
    label: 'File',
    category: 'files',
    keywords: ['file', 'document', 'page', 'blank', 'doc'],
    paths: [PAGE, PAGE_FOLD],
  },
  {
    key: 'file-text',
    label: 'Text file',
    category: 'files',
    keywords: ['file', 'text', 'document', 'notes', 'readme'],
    paths: [PAGE, PAGE_FOLD, line(8, 9, 10, 9), line(8, 13, 16, 13), line(8, 17, 16, 17)],
  },
  {
    key: 'folder',
    label: 'Folder',
    category: 'files',
    keywords: ['folder', 'directory', 'files', 'collection', 'group'],
    paths: ['M3 6V18A2 2 0 0 0 5 20H19A2 2 0 0 0 21 18V9A2 2 0 0 0 19 7H12L10 4H5A2 2 0 0 0 3 6Z'],
  },
  {
    key: 'upload',
    label: 'Upload',
    category: 'files',
    keywords: ['upload', 'send', 'import', 'push', 'arrow up'],
    paths: [line(12, 17, 12, 4), 'M6.5 9.5L12 4L17.5 9.5', line(5, 21, 19, 21)],
  },
  {
    key: 'download',
    label: 'Download',
    category: 'files',
    keywords: ['download', 'save', 'export', 'pull', 'arrow down'],
    paths: [line(12, 3, 12, 16), 'M6.5 10.5L12 16L17.5 10.5', line(5, 21, 19, 21)],
  },
  {
    key: 'trash',
    label: 'Trash',
    category: 'files',
    keywords: ['trash', 'delete', 'remove', 'bin', 'garbage'],
    paths: [
      line(3, 6, 21, 6),
      'M9 6V4A1 1 0 0 1 10 3H14A1 1 0 0 1 15 4V6',
      'M5 6L6 20A1.5 1.5 0 0 0 7.5 21.5H16.5A1.5 1.5 0 0 0 18 20L19 6',
      line(10, 10.5, 10, 17),
      line(14, 10.5, 14, 17),
    ],
  },

  // ─── Communication ─────────────────────────────────────────────────────────────────
  {
    key: 'bell',
    label: 'Bell',
    category: 'communication',
    keywords: ['bell', 'notification', 'alert', 'alarm', 'reminder'],
    paths: ['M4 18H20L18 15.5V10A6 6 0 0 0 6 10V15.5Z', 'M10 20A2 2 0 0 0 14 20', line(12, 2, 12, 4)],
  },
  {
    key: 'mail',
    label: 'Mail',
    category: 'communication',
    keywords: ['mail', 'email', 'envelope', 'smtp', 'inbox'],
    paths: [rect(2, 5, 20, 14, 2), 'M2.5 6.5L12 13L21.5 6.5'],
  },
  {
    key: 'message',
    label: 'Message',
    category: 'communication',
    keywords: ['message', 'chat', 'comment', 'bubble', 'conversation'],
    paths: [
      'M5 4H19A2 2 0 0 1 21 6V15A2 2 0 0 1 19 17H10L5.5 20.5V17H5A2 2 0 0 1 3 15V6A2 2 0 0 1 5 4Z',
    ],
  },

  // ─── Commerce ──────────────────────────────────────────────────────────────────────
  {
    key: 'credit-card',
    label: 'Credit card',
    category: 'commerce',
    keywords: ['credit card', 'payment', 'card', 'billing', 'stripe'],
    paths: [rect(2, 4.5, 20, 15, 2.5), line(2, 9.5, 22, 9.5), line(6, 15, 11, 15), line(14, 15, 16, 15)],
  },
  {
    key: 'cart',
    label: 'Cart',
    category: 'commerce',
    keywords: ['cart', 'shopping', 'checkout', 'basket', 'store'],
    paths: ['M2 3H5L7.5 15H18.5L21 7H6', circle(9, 19.5, 1.5), circle(17, 19.5, 1.5)],
  },
  {
    key: 'tag',
    label: 'Tag',
    category: 'commerce',
    keywords: ['tag', 'label', 'price', 'category', 'badge'],
    paths: ['M3 3H11L21 13L13 21L3 11Z', circle(7.5, 7.5, 1.5)],
  },
  {
    key: 'dollar',
    label: 'Dollar',
    category: 'commerce',
    keywords: ['dollar', 'money', 'price', 'cost', 'billing'],
    paths: [
      circle(12, 12, 10),
      'M15 8.5H10.75A1.75 1.75 0 0 0 10.75 12H13.25A1.75 1.75 0 0 1 13.25 15.5H9',
      line(12, 6, 12, 8.5),
      line(12, 15.5, 12, 18),
    ],
  },

  // ─── Development ───────────────────────────────────────────────────────────────────
  {
    key: 'gear',
    label: 'Gear',
    category: 'development',
    keywords: ['gear', 'cog', 'config', 'engine', 'mechanism'],
    paths: [cog(12, 12, 9.5, 7, 8), circle(12, 12, 3)],
  },
  {
    key: 'git-branch',
    label: 'Git branch',
    category: 'development',
    keywords: ['git', 'branch', 'version control', 'merge', 'fork'],
    paths: [
      circle(7, 5, 2.5),
      circle(7, 19, 2.5),
      circle(17, 9, 2.5),
      line(7, 7.5, 7, 16.5),
      'M17 11.5C17 15 12.5 16 7 16',
    ],
  },
  {
    key: 'code',
    label: 'Code',
    category: 'development',
    keywords: ['code', 'source', 'html', 'develop', 'brackets'],
    paths: ['M8 7L3 12L8 17', 'M16 7L21 12L16 17', line(14, 4, 10, 20)],
  },
  {
    key: 'terminal',
    label: 'Terminal',
    category: 'development',
    keywords: ['terminal', 'console', 'shell', 'cli', 'bash'],
    paths: [rect(2, 4, 20, 16, 2), 'M6 9L10 12L6 15', line(12, 15, 17, 15)],
  },
  {
    key: 'lightning',
    label: 'Lightning',
    category: 'development',
    keywords: ['lightning', 'bolt', 'fast', 'event', 'trigger'],
    paths: ['M13.5 2L4.5 13.5H11.5L10.5 22L19.5 10.5H12.5Z'],
  },
  {
    key: 'refresh',
    label: 'Refresh',
    category: 'development',
    keywords: ['refresh', 'sync', 'reload', 'retry', 'cycle'],
    paths: [
      'M4 12A8 8 0 0 1 18.93 8',
      'M19.63 4.06L18.93 8L15.17 6.63',
      'M20 12A8 8 0 0 1 5.07 16',
      'M4.37 19.94L5.07 16L8.83 17.37',
    ],
  },

  // ─── Status ────────────────────────────────────────────────────────────────────────
  {
    key: 'check',
    label: 'Check',
    category: 'status',
    keywords: ['check', 'done', 'success', 'ok', 'complete'],
    paths: ['M4 12.5L9.5 18L20 6.5'],
  },
  {
    key: 'x',
    label: 'Close',
    category: 'status',
    keywords: ['x', 'close', 'cancel', 'error', 'fail'],
    paths: [line(5, 5, 19, 19), line(19, 5, 5, 19)],
  },
  {
    key: 'warning',
    label: 'Warning',
    category: 'status',
    keywords: ['warning', 'alert', 'caution', 'danger', 'triangle'],
    paths: ['M12 3.5L21.5 20H2.5Z', line(12, 9.5, 12, 14)],
    fills: [circle(12, 17, 1.1)],
  },
  {
    key: 'info',
    label: 'Info',
    category: 'status',
    keywords: ['info', 'information', 'help', 'about', 'details'],
    paths: [circle(12, 12, 9.5), 'M10.5 11H12V16.5', line(10.5, 16.5, 13.5, 16.5)],
    fills: [circle(12, 7.75, 1.2)],
  },
  {
    key: 'clock',
    label: 'Clock',
    category: 'status',
    keywords: ['clock', 'time', 'schedule', 'cron', 'latency'],
    paths: [circle(12, 12, 10), 'M12 7V12H16.5'],
  },
  {
    key: 'heart',
    label: 'Heart',
    category: 'status',
    keywords: ['heart', 'like', 'favorite', 'health', 'love'],
    paths: ['M12 20L4.79 12.65A4.5 4.5 0 0 1 12 7.44A4.5 4.5 0 0 1 19.21 12.65Z'],
  },
  {
    key: 'star',
    label: 'Star',
    category: 'status',
    keywords: ['star', 'favorite', 'rating', 'bookmark', 'featured'],
    paths: [starPath(12, 12.4, 10, 4.3, 5)],
  },

  // ─── UI ────────────────────────────────────────────────────────────────────────────
  {
    key: 'settings',
    label: 'Settings',
    category: 'ui',
    keywords: ['settings', 'sliders', 'preferences', 'options', 'controls'],
    paths: [
      line(3, 6, 13, 6),
      line(17, 6, 21, 6),
      circle(15, 6, 2),
      line(3, 12, 7, 12),
      line(11, 12, 21, 12),
      circle(9, 12, 2),
      line(3, 18, 15, 18),
      line(19, 18, 21, 18),
      circle(17, 18, 2),
    ],
  },
  {
    key: 'search',
    label: 'Search',
    category: 'ui',
    keywords: ['search', 'find', 'lookup', 'magnifier', 'query'],
    paths: [circle(10.5, 10.5, 7), line(15.45, 15.45, 21, 21)],
  },
  {
    key: 'calendar',
    label: 'Calendar',
    category: 'ui',
    keywords: ['calendar', 'date', 'schedule', 'event', 'day'],
    paths: [rect(3, 4.5, 18, 16.5, 2.5), line(7.5, 2.5, 7.5, 6.5), line(16.5, 2.5, 16.5, 6.5), line(3, 9.5, 21, 9.5)],
    fills: [circle(8, 14, 1), circle(12, 14, 1), circle(16, 14, 1)],
  },
  {
    key: 'home',
    label: 'Home',
    category: 'ui',
    keywords: ['home', 'house', 'start', 'main', 'dashboard'],
    paths: ['M3 10.5L12 3L21 10.5', 'M5 8.9V19A2 2 0 0 0 7 21H17A2 2 0 0 0 19 19V8.9', 'M10 21V15H14V21'],
  },
  {
    key: 'eye',
    label: 'Eye',
    category: 'ui',
    keywords: ['eye', 'view', 'visible', 'watch', 'preview'],
    paths: ['M2 12C4.5 7 8 5 12 5S19.5 7 22 12C19.5 17 16 19 12 19S4.5 17 2 12Z', circle(12, 12, 3.5)],
  },
  {
    key: 'plus',
    label: 'Plus',
    category: 'ui',
    keywords: ['plus', 'add', 'new', 'create', 'more'],
    paths: [line(12, 4.5, 12, 19.5), line(4.5, 12, 19.5, 12)],
  },
  {
    key: 'minus',
    label: 'Minus',
    category: 'ui',
    keywords: ['minus', 'remove', 'subtract', 'less', 'collapse'],
    paths: [line(4.5, 12, 19.5, 12)],
  },
  {
    key: 'arrow-right',
    label: 'Arrow right',
    category: 'ui',
    keywords: ['arrow', 'right', 'next', 'forward', 'flow'],
    paths: [line(4, 12, 20, 12), 'M14 6L20 12L14 18'],
  },
  {
    key: 'filter',
    label: 'Filter',
    category: 'ui',
    keywords: ['filter', 'funnel', 'sort', 'refine', 'narrow'],
    paths: ['M3 4H21L14 12.5V19L10 21V12.5Z'],
  },
  {
    key: 'edit',
    label: 'Edit',
    category: 'ui',
    keywords: ['edit', 'pencil', 'write', 'modify', 'change'],
    paths: ['M16 3.5L20.5 8L8 20.5L3 21L3.5 16Z', line(13.5, 6, 18, 10.5)],
  },
  {
    key: 'play',
    label: 'Play',
    category: 'ui',
    keywords: ['play', 'start', 'run', 'execute', 'media'],
    paths: ['M7 4.5V19.5L19.5 12Z'],
  },
  {
    key: 'pause',
    label: 'Pause',
    category: 'ui',
    keywords: ['pause', 'stop', 'hold', 'suspend', 'media'],
    paths: [rect(5.5, 4, 4.5, 16, 1.5), rect(14, 4, 4.5, 16, 1.5)],
  },

  // ─── Charts ────────────────────────────────────────────────────────────────────────
  {
    key: 'chart',
    label: 'Bar chart',
    category: 'charts',
    keywords: ['chart', 'bar', 'graph', 'metrics', 'analytics'],
    paths: ['M3 3V21H21', rect(6.5, 11, 3, 7, 0.5), rect(11.5, 6, 3, 12, 0.5), rect(16.5, 9, 3, 9, 0.5)],
  },
  {
    key: 'pie-chart',
    label: 'Pie chart',
    category: 'charts',
    keywords: ['pie', 'chart', 'share', 'distribution', 'percentage'],
    paths: [circle(12, 12, 9), 'M12 3V12H21', line(12, 12, 5.64, 18.36)],
  },

  // ─── Misc ──────────────────────────────────────────────────────────────────────────
  {
    key: 'map-pin',
    label: 'Map pin',
    category: 'misc',
    keywords: ['map', 'pin', 'location', 'region', 'place'],
    paths: ['M12 22C12 22 19 15.5 19 9.5A7 7 0 0 0 5 9.5C5 15.5 12 22 12 22Z', circle(12, 9.5, 2.5)],
  },
];
