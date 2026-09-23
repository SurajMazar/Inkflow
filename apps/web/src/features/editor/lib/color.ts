export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

export interface Hsva {
  h: number;
  s: number;
  v: number;
  a: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^#?([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let hex = m[1]!;
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = parseInt(hex.slice(0, 6), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1;
    return { r: clamp(+m[1]!, 0, 255), g: clamp(+m[2]!, 0, 255), b: clamp(+m[3]!, 0, 255), a: clamp(a, 0, 1) };
  }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1;
    return { ...hslToRgb(+m[1]!, +m[2]! / 100, +m[3]! / 100), a: clamp(a, 0, 1) };
  }
  return null;
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

export function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function rgbToHsv({ r, g, b, a }: Rgba): Hsva {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a };
}

export function hsvToRgb({ h, s, v, a }: Hsva): Rgba {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return { r: Math.round((rgb[0] + m) * 255), g: Math.round((rgb[1] + m) * 255), b: Math.round((rgb[2] + m) * 255), a };
}

const hex2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

/** `#rrggbb`, or `#rrggbbaa` when not fully opaque; `transparent` when alpha is 0. */
export function toHex({ r, g, b, a }: Rgba): string {
  if (a <= 0) return 'transparent';
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return a >= 1 ? base : `${base}${hex2(a * 255)}`;
}

export function isValidColor(input: string): boolean {
  return parseColor(input) !== null;
}

/** Relative luminance-based contrast color for swatch check marks. */
export function contrastColor(color: string): string {
  const c = parseColor(color);
  if (!c || c.a < 0.4) return '#1e1e1e';
  const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  return lum > 0.6 ? '#1e1e1e' : '#ffffff';
}
