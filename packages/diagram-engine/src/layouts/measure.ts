import { getFontString, measureLineWidth, type FontFamily } from '@inkflow/elements';

export interface MeasureFont {
  fontFamily: FontFamily;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
}

/** Advance width of one line using the host text measurer (heuristic fallback outside the DOM). */
export function textWidth(text: string, font: MeasureFont): number {
  return measureLineWidth(
    text,
    getFontString({
      fontFamily: font.fontFamily,
      fontSize: font.fontSize,
      fontWeight: font.bold ? 'bold' : 'normal',
      fontStyle: font.italic ? 'italic' : 'normal',
    }),
    0,
  );
}

export function maxTextWidth(lines: readonly string[], font: MeasureFont): number {
  let max = 0;
  for (const line of lines) max = Math.max(max, textWidth(line, font));
  return max;
}
