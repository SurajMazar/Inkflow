import {
  FONT_FAMILIES,
  getFontString,
  layoutText,
  measureLineWidth,
  type FontFamily,
  type TextAlign,
  type TextDecoration,
  type TextStyle,
  type VerticalAlign,
} from '@inkflow/elements';
import type { Rect } from '@inkflow/geometry';
import type { TextLayer, TextRun } from './types';

export interface TextBlockOptions {
  text: string;
  style: Pick<
    TextStyle,
    'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle' | 'lineHeight' | 'letterSpacing'
  >;
  color: string;
  align: TextAlign;
  verticalAlign: VerticalAlign;
  decoration: TextDecoration;
  /** Box the text is aligned in. */
  box: Rect;
  /** Wrap width (null = no wrapping). */
  wrapWidth: number | null;
}

/** Lays out text inside a box and returns a text layer (plus the laid-out block height). */
export function textBlock(o: TextBlockOptions): {
  layer: TextLayer;
  height: number;
  width: number;
} {
  const layout = layoutText(o.text, o.style, o.wrapWidth);
  const lh = layout.lineHeightPx;
  const blockHeight = layout.lines.length * lh;
  let top: number;
  switch (o.verticalAlign) {
    case 'middle':
      top = o.box.y + (o.box.height - blockHeight) / 2;
      break;
    case 'bottom':
      top = o.box.y + o.box.height - blockHeight;
      break;
    default:
      top = o.box.y;
  }
  const anchorX =
    o.align === 'center'
      ? o.box.x + o.box.width / 2
      : o.align === 'right'
        ? o.box.x + o.box.width
        : o.box.x;
  const runs: TextRun[] = layout.lines.map((line, i) => ({
    text: line.text,
    x: anchorX,
    y: top + (i + 0.5) * lh,
    width: line.width,
  }));
  return {
    layer: makeTextLayer(runs, o.style, o.color, o.align, o.decoration),
    height: blockHeight,
    width: layout.width,
  };
}

export function makeTextLayer(
  runs: TextRun[],
  style: Pick<TextStyle, 'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle' | 'letterSpacing'>,
  color: string,
  align: TextAlign,
  decoration: TextDecoration = 'none',
): TextLayer {
  return {
    kind: 'text',
    runs,
    font: getFontString(style),
    fontFamilyCss: FONT_FAMILIES[style.fontFamily].css,
    fontFamilyKey: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    color,
    align,
    decoration,
    letterSpacing: style.letterSpacing,
  };
}

/** Single line of text at an anchor point (middle baseline). */
export function textLine(
  text: string,
  x: number,
  y: number,
  opts: {
    fontFamily: FontFamily;
    fontSize: number;
    color: string;
    align?: TextAlign;
    bold?: boolean;
    italic?: boolean;
    decoration?: TextDecoration;
    alpha?: number;
  },
): TextLayer {
  const style = {
    fontFamily: opts.fontFamily,
    fontSize: opts.fontSize,
    fontWeight: opts.bold ? ('bold' as const) : ('normal' as const),
    fontStyle: opts.italic ? ('italic' as const) : ('normal' as const),
    letterSpacing: 0,
  };
  const width = measureLineWidth(text, getFontString(style), 0);
  const layer = makeTextLayer(
    [{ text, x, y, width }],
    style,
    opts.color,
    opts.align ?? 'left',
    opts.decoration ?? 'none',
  );
  if (opts.alpha !== undefined) layer.alpha = opts.alpha;
  return layer;
}

/** Truncates a single line with an ellipsis so that it fits `maxWidth`. */
export function truncateText(text: string, font: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (measureLineWidth(text, font, 0) <= maxWidth) return text;
  const chars = [...text];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureLineWidth(chars.slice(0, mid).join('') + '…', font, 0) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '' : chars.slice(0, lo).join('') + '…';
}
