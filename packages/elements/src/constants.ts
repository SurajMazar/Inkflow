import type { Arrowhead, FillStyle, FontFamily, StrokeStyle, TextStyle } from './types';

export const FONT_FAMILIES: Record<FontFamily, { label: string; css: string }> = {
  hand: { label: 'Hand-drawn', css: '"Kalam", "Segoe Print", "Comic Sans MS", cursive' },
  sans: {
    label: 'Normal',
    css: '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  serif: { label: 'Serif', css: '"Lora", Georgia, "Times New Roman", serif' },
  mono: { label: 'Code', css: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace' },
};

export const FONT_SIZES = { S: 16, M: 20, L: 28, XL: 36 } as const;
export const STROKE_WIDTHS = { thin: 1, bold: 2, extraBold: 4 } as const;
export const ROUGHNESS = { architect: 0, artist: 1, cartoonist: 2 } as const;

export const STROKE_STYLES: readonly StrokeStyle[] = ['solid', 'dashed', 'dotted'];
export const FILL_STYLES: readonly FillStyle[] = ['hachure', 'cross-hatch', 'zigzag', 'solid'];

export const ARROWHEADS: readonly Arrowhead[] = [
  'none',
  'arrow',
  'triangle',
  'triangle-outline',
  'dot',
  'circle-outline',
  'bar',
  'diamond',
  'diamond-outline',
  'er-one',
  'er-many',
  'er-one-only',
  'er-zero-one',
  'er-one-many',
  'er-zero-many',
];

/** Palette shown in the style panel (Open Color derived). */
export const COLOR_PALETTE = {
  transparent: 'transparent',
  black: '#1e1e1e',
  white: '#ffffff',
  gray: ['#f8f9fa', '#e9ecef', '#ced4da', '#868e96', '#343a40'],
  red: ['#fff5f5', '#ffc9c9', '#ff8787', '#fa5252', '#e03131'],
  pink: ['#fff0f6', '#fcc2d7', '#f783ac', '#e64980', '#c2255c'],
  grape: ['#f8f0fc', '#eebefa', '#da77f2', '#be4bdb', '#9c36b5'],
  violet: ['#f3f0ff', '#d0bfff', '#9775fa', '#7950f2', '#6741d9'],
  blue: ['#e7f5ff', '#a5d8ff', '#4dabf7', '#228be6', '#1971c2'],
  cyan: ['#e3fafc', '#99e9f2', '#3bc9db', '#15aabf', '#0c8599'],
  teal: ['#e6fcf5', '#96f2d7', '#38d9a9', '#12b886', '#099268'],
  green: ['#ebfbee', '#b2f2bb', '#69db7c', '#40c057', '#2f9e44'],
  yellow: ['#fff9db', '#ffec99', '#ffd43b', '#fab005', '#f08c00'],
  orange: ['#fff4e6', '#ffd8a8', '#ffa94d', '#fd7e14', '#e8590c'],
} as const;

export const QUICK_STROKE_COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00'] as const;
export const QUICK_BACKGROUND_COLORS = [
  'transparent',
  '#ffc9c9',
  '#b2f2bb',
  '#a5d8ff',
  '#ffec99',
] as const;

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'hand',
  fontSize: FONT_SIZES.M,
  fontWeight: 'normal',
  fontStyle: 'normal',
  textDecoration: 'none',
  textAlign: 'left',
  verticalAlign: 'top',
  lineHeight: 1.25,
  letterSpacing: 0,
};

export const DEFAULT_ELEMENT_STYLE = {
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  strokeWidth: STROKE_WIDTHS.bold,
  strokeStyle: 'solid' as StrokeStyle,
  fillStyle: 'solid' as FillStyle,
  opacity: 100,
  roughness: ROUGHNESS.artist,
} as const;

export const MIN_ELEMENT_SIZE = 1;
export const MIN_FONT_SIZE = 4;
export const MAX_FONT_SIZE = 400;
export const MAX_TEXT_LENGTH = 100_000;
export const MAX_POINTS = 50_000;
/** Default gap between a bound arrow endpoint and its target outline. */
export const DEFAULT_BINDING_GAP = 4;
/** Default horizontal/vertical padding between a shape outline and its label. */
export const LABEL_PADDING = 8;
