import { isLinearElement, isShapeElement, layoutText, type SceneElement } from '@inkflow/elements';
import { getBrushSettings } from './freedraw';
import { arrowheadLength } from './drawable/linear';
import { effectiveRoughness, isTransparentColor } from './drawable/style';

/** Maximum displacement introduced by the hand-drawn jitter (offsets + bowing). */
function jitterPadding(roughness: number, width: number, height: number): number {
  const r = effectiveRoughness(roughness, width, height);
  if (r <= 0) return 0;
  // Vertex offsets (≤ 2·r) plus bowing of long edges (≤ ~2.5·r) plus the second pass (+0.3).
  return r * 5 + 1;
}

/**
 * Extra padding (world units) around `getElementBounds(el)` that the rendered element may occupy:
 * half the stroke width, jitter of the hand-drawn look, arrowheads, text overhang, edge labels.
 * Used for viewport culling and export bounds.
 */
export function measureRenderPadding(el: SceneElement): number {
  const sw = Math.max(0, el.strokeWidth);
  const base = sw / 2 + 1;
  if (isShapeElement(el) || el.type === 'node' || el.type === 'table' || el.type === 'uml-class') {
    return base + jitterPadding(el.roughness, el.width, el.height);
  }
  if (isLinearElement(el)) {
    let pad = base + jitterPadding(el.roughness, Math.max(el.width, 20), Math.max(el.height, 20));
    const hasHead = el.startArrowhead !== 'none' || el.endArrowhead !== 'none';
    if (hasHead) pad += arrowheadLength(sw) * 0.75 + sw;
    if (el.label && el.label.text.trim().length > 0) {
      const layout = layoutText(el.label.text, el.label, null);
      pad = Math.max(pad, Math.max(layout.width / 2, layout.height / 2) + 8);
    }
    return pad;
  }
  switch (el.type) {
    case 'freedraw': {
      const brush = getBrushSettings(el);
      // getElementBounds already pads by 2 × strokeWidth.
      return Math.max(1, brush.size / 2 - sw * 2 + 1);
    }
    case 'text':
      return Math.max(2, el.fontSize * 0.25) + (isTransparentColor(el.backgroundColor) ? 0 : el.fontSize * 0.2);
    case 'image':
      return base;
    case 'frame':
      return base;
    case 'sequence':
      return base + jitterPadding(el.roughness, 40, 40) + 12;
    default:
      return base;
  }
}
