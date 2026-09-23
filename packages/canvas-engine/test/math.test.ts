import { createElement } from '@inkflow/elements';
import { describe, expect, it } from 'vitest';
import {
  fitBounds,
  flipElements,
  getSelectionFrame,
  panBy,
  resizeBox,
  resizeMultiple,
  rotateElements,
  rotationDelta,
  screenToWorld,
  screenRectToWorld,
  snapBoundsToGrid,
  snapBoundsToObjects,
  snapVectorAngle,
  worldRectToScreen,
  worldToScreen,
  zoomAtPoint,
  computeTransformHandles,
  cursorForHandle,
  parseCombo,
  formatShortcut,
  searchScene,
} from '../src';

const vp = { x: 100, y: 50, zoom: 2, width: 800, height: 600 };

describe('viewport', () => {
  it('converts between screen and world coordinates', () => {
    const w = screenToWorld(vp, { x: 200, y: 100 });
    expect(w).toEqual({ x: 200, y: 100 });
    expect(worldToScreen(vp, w)).toEqual({ x: 200, y: 100 });
    const r = screenRectToWorld(vp, { x: 0, y: 0, width: 800, height: 600 });
    expect(r).toEqual({ x: 100, y: 50, width: 400, height: 300 });
    expect(worldRectToScreen(vp, r)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('zooms around the cursor keeping the world point fixed', () => {
    const cursor = { x: 300, y: 200 };
    const before = screenToWorld(vp, cursor);
    const next = zoomAtPoint(vp, 4, cursor);
    const after = screenToWorld(next, cursor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(next.zoom).toBe(4);
  });

  it('clamps zoom and pans in screen pixels', () => {
    expect(zoomAtPoint(vp, 1000, { x: 0, y: 0 }).zoom).toBe(30);
    const panned = panBy(vp, 100, 0);
    expect(panned.x).toBe(50);
  });

  it('fits bounds into the viewport', () => {
    const next = fitBounds({ ...vp, zoom: 1 }, { minX: 0, minY: 0, maxX: 2000, maxY: 1000 }, { padding: 0 });
    expect(next.zoom).toBeCloseTo(0.4);
    const center = screenToWorld(next, { x: 400, y: 300 });
    expect(center.x).toBeCloseTo(1000);
    expect(center.y).toBeCloseTo(500);
  });
});

describe('resize', () => {
  const frame = { x: 0, y: 0, width: 100, height: 50, angle: 0 };

  it('resizes from corners keeping the opposite corner fixed', () => {
    const box = resizeBox(frame, 'se', { x: 150, y: 80 }, { keepAspect: false, fromCenter: false });
    expect(box).toMatchObject({ x: 0, y: 0, width: 150, height: 80, flippedX: false });
    const nw = resizeBox(frame, 'nw', { x: -20, y: -10 }, { keepAspect: false, fromCenter: false });
    expect(nw).toMatchObject({ x: -20, y: -10, width: 120, height: 60 });
  });

  it('keeps aspect ratio and resizes from center', () => {
    const box = resizeBox(frame, 'se', { x: 200, y: 60 }, { keepAspect: true, fromCenter: false });
    expect(box.width / box.height).toBeCloseTo(2);
    const c = resizeBox(frame, 'e', { x: 150, y: 25 }, { keepAspect: false, fromCenter: true });
    expect(c.x).toBeCloseTo(-50);
    expect(c.width).toBeCloseTo(200);
  });

  it('detects flips when dragging past the anchor', () => {
    const box = resizeBox(frame, 'e', { x: -40, y: 25 }, { keepAspect: false, fromCenter: false });
    expect(box.flippedX).toBe(true);
    expect(box.x).toBeCloseTo(-40);
    expect(box.width).toBeCloseTo(40);
  });

  it('keeps the anchor fixed for rotated boxes', () => {
    const rotated = { ...frame, angle: Math.PI / 2 };
    const c = { x: 50, y: 25 };
    const box = resizeBox(rotated, 'se', { x: 20, y: 150 }, { keepAspect: false, fromCenter: false });
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    // The top-left corner in world space (rotated around the new center) must stay where it was.
    const oldTl = rotateAround({ x: 0, y: 0 }, c, Math.PI / 2);
    const nc = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const newTl = rotateAround({ x: box.x, y: box.y }, nc, Math.PI / 2);
    expect(newTl.x).toBeCloseTo(oldTl.x);
    expect(newTl.y).toBeCloseTo(oldTl.y);
  });

  it('scales multiple elements relative to the selection', () => {
    const a = createElement('rectangle', { id: 'a', x: 0, y: 0, width: 50, height: 50 });
    const b = createElement('rectangle', { id: 'b', x: 50, y: 50, width: 50, height: 50 });
    const sel = getSelectionFrame([a, b])!;
    const box = resizeBox(sel, 'se', { x: 200, y: 200 }, { keepAspect: false, fromCenter: false });
    const patches = resizeMultiple([a, b], sel, box, false);
    expect(patches.get('b')).toMatchObject({ x: 100, y: 100, width: 100, height: 100 });
  });
});

function rotateAround(p: { x: number; y: number }, c: { x: number; y: number }, a: number) {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos };
}

describe('rotate & flip', () => {
  it('computes and snaps rotation deltas', () => {
    const center = { x: 0, y: 0 };
    const d = rotationDelta(center, { x: 10, y: 0 }, { x: 0, y: 10 }, 0, false);
    expect(d).toBeCloseTo(Math.PI / 2);
    const snapped = rotationDelta(center, { x: 10, y: 0 }, { x: 10, y: 2.5 }, 0, true);
    expect(snapped).toBeCloseTo(Math.PI / 12);
  });

  it('rotates elements around a common center', () => {
    const a = createElement('rectangle', { id: 'a', x: 90, y: -10, width: 20, height: 20 });
    const patches = rotateElements([a], { x: 0, y: 0 }, Math.PI);
    expect(patches.get('a')!.x).toBeCloseTo(-110);
    expect(patches.get('a')!.angle).toBeCloseTo(Math.PI);
  });

  it('flips shapes and mirrors linear points', () => {
    const r = createElement('triangle', { id: 't', x: 0, y: 0, width: 10, height: 10 });
    const line = createElement('line', { id: 'l', x: 0, y: 0, width: 10, height: 5, points: [[0, 0], [10, 5]] });
    const out = flipElements([r, line], 'horizontal', { x: 5, y: 5 });
    expect(out.get('t')!.flipX).toBe(true);
    expect(out.get('l')!.points).toEqual([[10, 0], [0, 5]]);
  });
});

describe('handles', () => {
  it('computes handles and cursors', () => {
    const handles = computeTransformHandles({ x: 0, y: 0, width: 200, height: 100, angle: 0 }, { zoom: 1, rotatable: true, resizable: true });
    expect(handles.map((h) => h.id).sort()).toEqual(['e', 'n', 'ne', 'nw', 'rotation', 's', 'se', 'sw', 'w']);
    expect(cursorForHandle('e', 0)).toBe('ew-resize');
    expect(cursorForHandle('e', Math.PI / 2)).toBe('ns-resize');
  });

  it('hides edge handles for tiny selections', () => {
    const handles = computeTransformHandles({ x: 0, y: 0, width: 10, height: 10, angle: 0 }, { zoom: 1, rotatable: false, resizable: true });
    expect(handles).toHaveLength(4);
  });
});

describe('snapping', () => {
  it('snaps edges and centers with guides', () => {
    const res = snapBoundsToObjects({ minX: 103, minY: 0, maxX: 153, maxY: 20 }, [{ minX: 0, minY: 100, maxX: 100, maxY: 200 }], 8);
    expect(res.dx).toBe(-3);
    expect(res.lines.length).toBeGreaterThan(0);
    const none = snapBoundsToObjects({ minX: 300, minY: 300, maxX: 320, maxY: 320 }, [{ minX: 0, minY: 0, maxX: 10, maxY: 10 }], 8);
    expect(none.dx).toBe(0);
    expect(none.dy).toBe(0);
  });

  it('snaps to grid and angles', () => {
    expect(snapBoundsToGrid({ minX: 13, minY: 27, maxX: 50, maxY: 50 }, 20)).toEqual({ dx: 7, dy: -7 });
    const p = snapVectorAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.y).toBeCloseTo(0);
  });
});

describe('shortcuts', () => {
  it('parses and formats combos', () => {
    expect(parseCombo('Shift+Mod+Z')).toMatchObject({ mod: true, shift: true, key: 'Z' });
    expect(parseCombo('Mod++')).toMatchObject({ mod: true, key: '+' });
    expect(formatShortcut('Shift+Mod+Z', 'mac')).toBe('⇧⌘Z');
    expect(formatShortcut('Shift+Mod+Z', 'other')).toBe('Ctrl+Shift+Z');
  });
});

describe('searchScene', () => {
  it('finds text, labels, frames and diagram content', () => {
    const els = [
      createElement('text', { id: 't', text: 'Hello payments world', y: 100 }),
      createElement('frame', { id: 'f', name: 'Payments frame', y: 0 }),
      createElement('table', { id: 'tb', name: 'orders', columns: [], y: 200 }),
      createElement('rectangle', { id: 'r', y: 30 }),
    ];
    const res = searchScene(els, 'payment');
    expect(res.map((m) => m.elementId)).toEqual(['f', 't']);
    expect(searchScene(els, 'ORDERS')[0]!.elementId).toBe('tb');
  });
});
