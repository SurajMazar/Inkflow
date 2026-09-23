import { clamp, type Bounds, type Point, type Rect } from '@inkflow/geometry';
import type { ViewportState } from '@inkflow/renderer';

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 30;
/** Discrete zoom steps used by zoom in/out buttons and shortcuts. */
export const ZOOM_STEPS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4, 5, 6, 8, 12, 16, 24, 30];

export function screenToWorld(viewport: ViewportState, p: Point): Point {
  return { x: p.x / viewport.zoom + viewport.x, y: p.y / viewport.zoom + viewport.y };
}

export function worldToScreen(viewport: ViewportState, p: Point): Point {
  return { x: (p.x - viewport.x) * viewport.zoom, y: (p.y - viewport.y) * viewport.zoom };
}

export function screenRectToWorld(viewport: ViewportState, r: Rect): Rect {
  const tl = screenToWorld(viewport, { x: r.x, y: r.y });
  return { x: tl.x, y: tl.y, width: r.width / viewport.zoom, height: r.height / viewport.zoom };
}

export function worldRectToScreen(viewport: ViewportState, r: Rect): Rect {
  const tl = worldToScreen(viewport, { x: r.x, y: r.y });
  return { x: tl.x, y: tl.y, width: r.width * viewport.zoom, height: r.height * viewport.zoom };
}

/** World bounds currently visible on screen. */
export function visibleWorldBounds(viewport: ViewportState, padding = 0): Bounds {
  return {
    minX: viewport.x - padding,
    minY: viewport.y - padding,
    maxX: viewport.x + viewport.width / viewport.zoom + padding,
    maxY: viewport.y + viewport.height / viewport.zoom + padding,
  };
}

export const clampZoom = (zoom: number) => clamp(zoom, MIN_ZOOM, MAX_ZOOM);

/** Zooms so that the world point under `screenPoint` stays fixed. */
export function zoomAtPoint(viewport: ViewportState, nextZoom: number, screenPoint: Point): ViewportState {
  const zoom = clampZoom(nextZoom);
  const world = screenToWorld(viewport, screenPoint);
  return {
    ...viewport,
    zoom,
    x: world.x - screenPoint.x / zoom,
    y: world.y - screenPoint.y / zoom,
  };
}

export function panBy(viewport: ViewportState, dxScreen: number, dyScreen: number): ViewportState {
  return { ...viewport, x: viewport.x - dxScreen / viewport.zoom, y: viewport.y - dyScreen / viewport.zoom };
}

export function viewportCenter(viewport: ViewportState): Point {
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

export function nextZoomStep(zoom: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((z) => z > zoom + 1e-6) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-6) ?? MIN_ZOOM;
}

/** Viewport that fits `bounds` inside the screen with `padding` screen pixels on each side. */
export function fitBounds(
  viewport: ViewportState,
  bounds: Bounds,
  options: { padding?: number; maxZoom?: number; minZoom?: number } = {},
): ViewportState {
  const padding = options.padding ?? 48;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const availW = Math.max(1, viewport.width - padding * 2);
  const availH = Math.max(1, viewport.height - padding * 2);
  const zoom = clamp(Math.min(availW / width, availH / height), options.minZoom ?? MIN_ZOOM, options.maxZoom ?? 1);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return {
    ...viewport,
    zoom,
    x: cx - viewport.width / 2 / zoom,
    y: cy - viewport.height / 2 / zoom,
  };
}

/** Viewport centered on a world point at the current zoom. */
export function centerOn(viewport: ViewportState, world: Point): ViewportState {
  return { ...viewport, x: world.x - viewport.width / 2 / viewport.zoom, y: world.y - viewport.height / 2 / viewport.zoom };
}

/** Normalizes wheel deltas across browsers/devices to pixels. */
export function normalizeWheel(e: { deltaX: number; deltaY: number; deltaMode: number }): { dx: number; dy: number } {
  const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  return { dx: e.deltaX * factor, dy: e.deltaY * factor };
}
