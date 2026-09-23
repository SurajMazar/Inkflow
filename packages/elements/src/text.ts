import { FONT_FAMILIES } from './constants';
import type { FontFamily, FontStyle, FontWeight, TextElement, TextStyle } from './types';

export interface FontSpec {
  fontFamily: FontFamily;
  fontSize: number;
  fontWeight?: FontWeight;
  fontStyle?: FontStyle;
}

/** Measures the advance width of a single line of text. Installed by the host environment. */
export type TextWidthMeasurer = (text: string, font: string, letterSpacing: number) => number;

/** Average glyph width ratios per family, used when no DOM measurer is available (server, tests). */
const HEURISTIC_WIDTH: Record<FontFamily, number> = { hand: 0.52, sans: 0.55, serif: 0.52, mono: 0.6 };

const heuristicMeasurer: TextWidthMeasurer = (text, font, letterSpacing) => {
  const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(font);
  const size = sizeMatch ? Number(sizeMatch[1]) : 16;
  const family = (Object.keys(FONT_FAMILIES) as FontFamily[]).find((f) => font.includes(FONT_FAMILIES[f].css)) ?? 'sans';
  const bold = /\bbold\b/.test(font) ? 1.06 : 1;
  return text.length * size * HEURISTIC_WIDTH[family] * bold + Math.max(0, text.length - 1) * letterSpacing;
};

let activeMeasurer: TextWidthMeasurer = heuristicMeasurer;
const widthCache = new Map<string, number>();
const MAX_CACHE = 20_000;

export function setTextWidthMeasurer(measurer: TextWidthMeasurer | null): void {
  activeMeasurer = measurer ?? heuristicMeasurer;
  widthCache.clear();
}

/** Clears cached measurements (call after web fonts finish loading). */
export function clearTextMeasureCache(): void {
  widthCache.clear();
}

export function getFontString(spec: FontSpec): string {
  const style = spec.fontStyle === 'italic' ? 'italic ' : '';
  const weight = spec.fontWeight === 'bold' ? 'bold ' : '';
  return `${style}${weight}${spec.fontSize}px ${FONT_FAMILIES[spec.fontFamily].css}`;
}

export function measureLineWidth(line: string, font: string, letterSpacing = 0): number {
  if (line.length === 0) return 0;
  const key = `${font}|${letterSpacing}|${line}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  const width = activeMeasurer(line, font, letterSpacing);
  if (widthCache.size > MAX_CACHE) widthCache.clear();
  widthCache.set(key, width);
  return width;
}

export interface TextLine {
  text: string;
  width: number;
}

export interface TextLayout {
  lines: TextLine[];
  width: number;
  height: number;
  lineHeightPx: number;
}

function breakLongWord(word: string, font: string, letterSpacing: number, maxWidth: number): string[] {
  const parts: string[] = [];
  let current = '';
  for (const ch of word) {
    const candidate = current + ch;
    if (current && measureLineWidth(candidate, font, letterSpacing) > maxWidth) {
      parts.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Wraps text into lines no wider than `maxWidth` (null = no wrapping). */
export function wrapText(text: string, font: string, letterSpacing: number, maxWidth: number | null): string[] {
  const paragraphs = text.split(/\r?\n/);
  if (maxWidth === null || maxWidth <= 0) return paragraphs;
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    const tokens = paragraph.split(/(\s+)/).filter((t) => t.length > 0);
    let line = '';
    for (const token of tokens) {
      const candidate = line + token;
      if (measureLineWidth(candidate.trimEnd(), font, letterSpacing) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (/^\s+$/.test(token)) {
        lines.push(line.trimEnd());
        line = '';
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      if (measureLineWidth(token, font, letterSpacing) > maxWidth) {
        const pieces = breakLongWord(token, font, letterSpacing, maxWidth);
        lines.push(...pieces.slice(0, -1));
        line = pieces[pieces.length - 1] ?? '';
      } else {
        line = token;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function layoutText(
  text: string,
  style: Pick<TextStyle, 'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle' | 'lineHeight' | 'letterSpacing'>,
  maxWidth: number | null,
): TextLayout {
  const font = getFontString(style);
  const rawLines = wrapText(text, font, style.letterSpacing, maxWidth);
  const lines = rawLines.map((t) => ({ text: t, width: measureLineWidth(t, font, style.letterSpacing) }));
  const lineHeightPx = style.fontSize * style.lineHeight;
  const width = lines.reduce((m, l) => Math.max(m, l.width), 0);
  return { lines, width, height: Math.max(1, lines.length) * lineHeightPx, lineHeightPx };
}

/** Minimum width of a text box: wide enough for one average character. */
export function minTextWidth(style: Pick<TextStyle, 'fontSize'>): number {
  return Math.ceil(style.fontSize * 0.6);
}

/** Computes width/height for a text element given its content and sizing mode. */
export function measureTextElement(el: Pick<TextElement, keyof TextStyle | 'text' | 'autoResize' | 'width'>): {
  width: number;
  height: number;
} {
  const layout = layoutText(el.text, el, el.autoResize ? null : Math.max(el.width, minTextWidth(el)));
  const width = el.autoResize ? Math.max(layout.width, minTextWidth(el)) : Math.max(el.width, minTextWidth(el));
  return { width: Math.ceil(width), height: Math.ceil(layout.height) };
}
