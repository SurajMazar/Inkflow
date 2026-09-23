import type { FrameElement, SceneElement } from '@inkflow/elements';
import { normalizeRect, rotatedRectBounds, type Rect } from '@inkflow/geometry';
import { FRAME_NAME_FONT_SIZE, FRAME_NAME_GAP, getRenderBounds } from '@inkflow/renderer';
import type { ExportScope } from './types';

/** World-space height of frame names in exports (drawn at 14 output pixels at scale 1). */
const FRAME_TITLE_SPACE = FRAME_NAME_FONT_SIZE * 1.4 + FRAME_NAME_GAP;

const visible = (el: SceneElement) => !el.isDeleted && !el.hidden;

export function findFrame(scope: ExportScope, frameId: string): FrameElement | null {
  const el = scope.getElement(frameId) ?? scope.elements.find((e) => e.id === frameId);
  return el && el.type === 'frame' && !el.isDeleted ? el : null;
}

/** Elements rendered for an export: a frame export keeps the frame and its children only. */
export function elementsForExport(scope: ExportScope, frameId?: string | null): SceneElement[] {
  const list = scope.elements.filter(visible);
  if (!frameId) return list;
  const frame = findFrame(scope, frameId);
  if (!frame) return list;
  const inScope = list.filter((e) => e.id === frameId || e.frameId === frameId);
  return inScope.some((e) => e.id === frameId) ? inScope : [frame, ...inScope];
}

/**
 * World rectangle of an export:
 * - `bounds` (viewport export): exactly that rectangle;
 * - `frameId` (frame export): the frame's (rotated) box;
 * - otherwise: the render bounds of all visible elements (incl. stroke, jitter, arrowheads and
 *   frame names) expanded by `padding`.
 */
export function getExportBounds(
  scope: ExportScope,
  options: { padding: number; frameId?: string | null; bounds?: Rect | null },
): Rect {
  if (options.bounds) return normalizeRect(options.bounds);
  if (options.frameId) {
    const frame = findFrame(scope, options.frameId);
    if (frame) {
      const b = rotatedRectBounds({ x: frame.x, y: frame.y, width: frame.width, height: frame.height }, frame.angle);
      return { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
    }
  }
  const pad = Math.max(0, options.padding);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of scope.elements) {
    if (!visible(el)) continue;
    const b = getRenderBounds(el);
    const top = el.type === 'frame' && el.name ? b.minY - FRAME_TITLE_SPACE : b.minY;
    if (b.minX < minX) minX = b.minX;
    if (top < minY) minY = top;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: Math.max(1, pad * 2), height: Math.max(1, pad * 2) };
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}
