import { getNodeGeometry } from '@inkflow/diagram-engine';
import {
  FONT_FAMILIES,
  LABEL_PADDING,
  getLinearPath,
  isLinearElement,
  layoutText,
  type SceneElement,
  type TextStyle,
} from '@inkflow/elements';
import { pointAlongPolyline, rotatePoint, type Rect } from '@inkflow/geometry';
import type { ViewportState } from '@inkflow/renderer';
import type { TextEditKind } from './types';
import { worldToScreen } from './viewport';

export interface TextEditorLayout {
  /** Screen-space box (CSS px) of the editor before rotation. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Rotation around the box center (radians). */
  angle: number;
  text: string;
  fontFamily: string;
  /** Font size in screen pixels. */
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  textDecoration: string;
  textAlign: 'left' | 'center' | 'right';
  /** Line height multiplier. */
  lineHeight: number;
  letterSpacing: number;
  color: string;
  background: string;
  /** Auto-growing width (no wrapping). */
  autoWidth: boolean;
  /** Placeholder for empty labels. */
  placeholder: string;
}

const FRAME_NAME_FONT_PX = 14;

function styleFields(style: TextStyle, zoom: number) {
  return {
    fontFamily: FONT_FAMILIES[style.fontFamily].css,
    fontSize: style.fontSize * zoom,
    fontWeight: style.fontWeight === 'bold' ? '700' : '400',
    fontStyle: style.fontStyle,
    textDecoration: style.textDecoration === 'none' ? 'none' : style.textDecoration,
    textAlign: style.textAlign,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing * zoom,
  };
}

function labelBox(el: SceneElement): Rect {
  if (el.type === 'node') {
    const box = getNodeGeometry(el).labelBox;
    if (box) return { x: el.x + box.x, y: el.y + box.y, width: box.width, height: box.height };
  }
  const inset =
    el.type === 'diamond'
      ? Math.min(el.width, el.height) * 0.18
      : el.type === 'ellipse'
        ? Math.min(el.width, el.height) * 0.12
        : 0;
  return {
    x: el.x + LABEL_PADDING + inset,
    y: el.y + LABEL_PADDING + inset,
    width: Math.max(10, el.width - (LABEL_PADDING + inset) * 2),
    height: Math.max(10, el.height - (LABEL_PADDING + inset) * 2),
  };
}

/** Computes where and how to place the DOM text editor for an element being edited. */
export function computeTextEditorLayout(
  el: SceneElement,
  kind: TextEditKind,
  viewport: ViewportState,
): TextEditorLayout | null {
  const zoom = viewport.zoom;
  if (kind === 'text' && el.type === 'text') {
    const tl = worldToScreen(viewport, { x: el.x, y: el.y });
    return {
      left: tl.x,
      top: tl.y,
      width: el.width * zoom,
      height: el.height * zoom,
      angle: el.angle,
      text: el.text,
      ...styleFields(el, zoom),
      color: el.strokeColor,
      background: el.backgroundColor === 'transparent' ? 'transparent' : el.backgroundColor,
      autoWidth: el.autoResize,
      placeholder: '',
    };
  }
  if (kind === 'frame-name' && el.type === 'frame') {
    const tl = worldToScreen(viewport, { x: el.x, y: el.y });
    return {
      left: tl.x,
      top: tl.y - FRAME_NAME_FONT_PX * 1.6,
      width: Math.max(80, el.width * zoom),
      height: FRAME_NAME_FONT_PX * 1.5,
      angle: 0,
      text: el.name,
      fontFamily: FONT_FAMILIES.sans.css,
      fontSize: FRAME_NAME_FONT_PX,
      fontWeight: '500',
      fontStyle: 'normal',
      textDecoration: 'none',
      textAlign: 'left',
      lineHeight: 1.3,
      letterSpacing: 0,
      color: '#555555',
      background: 'transparent',
      autoWidth: true,
      placeholder: 'Frame name',
    };
  }
  if (kind === 'edge-label' && isLinearElement(el)) {
    const label = el.label;
    const style: TextStyle = label ?? {
      fontFamily: 'hand',
      fontSize: 16,
      fontWeight: 'normal',
      fontStyle: 'normal',
      textDecoration: 'none',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.25,
      letterSpacing: 0,
    };
    const at = pointAlongPolyline(getLinearPath(el), label?.position ?? 0.5).point;
    const layout = layoutText(label?.text || 'M', style, null);
    const w = Math.max(40, layout.width + 16) * zoom;
    const h = Math.max(layout.height, style.fontSize * style.lineHeight) * zoom;
    const center = worldToScreen(viewport, at);
    return {
      left: center.x - w / 2,
      top: center.y - h / 2,
      width: w,
      height: h,
      angle: 0,
      text: label?.text ?? '',
      ...styleFields(style, zoom),
      textAlign: 'center',
      color: label?.color ?? el.strokeColor,
      background: 'transparent',
      autoWidth: true,
      placeholder: 'Label',
    };
  }
  if (kind === 'label' && 'label' in el && !isLinearElement(el)) {
    const label = el.label;
    const style: TextStyle = label ?? {
      fontFamily: 'hand',
      fontSize: 20,
      fontWeight: 'normal',
      fontStyle: 'normal',
      textDecoration: 'none',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.25,
      letterSpacing: 0,
    };
    const box = labelBox(el);
    const layout = layoutText(label?.text || 'M', style, box.width);
    const contentH = Math.min(
      Math.max(layout.height, style.fontSize * style.lineHeight),
      Math.max(box.height, layout.height),
    );
    let top = box.y;
    if (style.verticalAlign === 'middle') top = box.y + (box.height - contentH) / 2;
    else if (style.verticalAlign === 'bottom') top = box.y + box.height - contentH;
    // Position relative to the element center so rotation matches the canvas.
    const c = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
    const boxCenter = rotatePoint({ x: box.x + box.width / 2, y: top + contentH / 2 }, c, el.angle);
    const sc = worldToScreen(viewport, boxCenter);
    const w = box.width * zoom;
    const h = contentH * zoom;
    return {
      left: sc.x - w / 2,
      top: sc.y - h / 2,
      width: w,
      height: h,
      angle: el.angle,
      text: label?.text ?? '',
      ...styleFields(style, zoom),
      color: label?.color ?? el.strokeColor,
      background: 'transparent',
      autoWidth: false,
      placeholder: '',
    };
  }
  return null;
}
