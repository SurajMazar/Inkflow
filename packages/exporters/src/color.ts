import { applyInvertHueRotate } from '@inkflow/renderer';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  yellow: [255, 255, 0],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  pink: [255, 192, 203],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
};

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Parses CSS hex / rgb[a]() / hsl[a]() / a few named colors. Returns null for transparent/unknown. */
export function parseColor(input: string): Rgba | null {
  const c = input.trim().toLowerCase();
  if (!c || c === 'transparent' || c === 'none') return null;
  let m = /^#([0-9a-f]{3,8})$/.exec(c);
  if (m) {
    const h = m[1]!;
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = [...h].map((x) => parseInt(x + x, 16));
      return { r: r!, g: g!, b: b!, a: h.length === 4 ? a! / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }
  m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(c);
  if (m) {
    const ch = (v: string) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: clamp255(ch(m[1]!)), g: clamp255(ch(m[2]!)), b: clamp255(ch(m[3]!)), a: Math.max(0, Math.min(1, alpha)) };
  }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(c);
  if (m) {
    const h = (parseFloat(m[1]!) % 360) / 360;
    const s = parseFloat(m[2]!) / 100;
    const l = parseFloat(m[3]!) / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t: number) => {
      let x = t;
      if (x < 0) x += 1;
      if (x > 1) x -= 1;
      if (x < 1 / 6) return p + (q - p) * 6 * x;
      if (x < 1 / 2) return q;
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
      return p;
    };
    const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: clamp255(hue(h + 1 / 3) * 255), g: clamp255(hue(h) * 255), b: clamp255(hue(h - 1 / 3) * 255), a: alpha };
  }
  const named = NAMED[c];
  return named ? { r: named[0], g: named[1], b: named[2], a: 1 } : null;
}

/** The dark-mode transform (invert 93% + hue-rotate 180°) applied to a single color. */
export function darkModeColor(color: Rgba): Rgba {
  const px = new Uint8ClampedArray([color.r, color.g, color.b, 255]);
  applyInvertHueRotate(px, 0.93);
  return { r: px[0]!, g: px[1]!, b: px[2]!, a: color.a };
}
