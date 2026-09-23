import { createElement, type SceneElement } from '@inkflow/elements';
import { describe, expect, it } from 'vitest';
import {
  alignElements,
  compareOrder,
  computeFrameMembership,
  computeZOrder,
  distributeElements,
  duplicateElements,
  expandSelectionToGroups,
  indicesAbove,
  parseDocument,
  serializeDocument,
  DEFAULT_DOCUMENT_APP_STATE,
} from '../src';

function rects(n: number): SceneElement[] {
  const keys = indicesAbove([], n);
  return keys.map((k, i) => createElement('rectangle', { id: `r${i}`, x: i * 100, y: i * 10, width: 50, height: 50, index: k }));
}

function applyIndices(els: SceneElement[], map: Map<string, string>) {
  return els.map((e) => (map.has(e.id) ? { ...e, index: map.get(e.id)! } : e)).sort(compareOrder).map((e) => e.id);
}

describe('z-order', () => {
  it('brings to front / sends to back', () => {
    const els = rects(4);
    expect(applyIndices(els, computeZOrder(els, new Set(['r0']), 'bringToFront'))).toEqual(['r1', 'r2', 'r3', 'r0']);
    expect(applyIndices(els, computeZOrder(els, new Set(['r3']), 'sendToBack'))).toEqual(['r3', 'r0', 'r1', 'r2']);
  });

  it('moves one step forward/backward', () => {
    const els = rects(4);
    expect(applyIndices(els, computeZOrder(els, new Set(['r1']), 'bringForward'))).toEqual(['r0', 'r2', 'r1', 'r3']);
    expect(applyIndices(els, computeZOrder(els, new Set(['r2']), 'sendBackward'))).toEqual(['r0', 'r2', 'r1', 'r3']);
    expect(applyIndices(els, computeZOrder(els, new Set(['r3']), 'bringForward')).length).toBe(4);
  });
});

describe('alignment & distribution', () => {
  it('aligns left and distributes horizontally', () => {
    const els = rects(3);
    const left = alignElements(els, 'left');
    for (const [, patch] of left) expect(patch.x).toBe(0);
    const spaced = [
      { ...els[0]!, x: 0 },
      { ...els[1]!, x: 10 },
      { ...els[2]!, x: 300 },
    ];
    const dist = new Map(distributeElements(spaced, 'horizontal'));
    expect(dist.get('r1')!.x).toBe(150);
  });
});

describe('groups', () => {
  it('expands selection to group members', () => {
    const els = rects(3).map((e, i) => (i < 2 ? { ...e, groupIds: ['inner', 'outer'] } : e));
    expect([...expandSelectionToGroups(['r0'], els, null)].sort()).toEqual(['r0', 'r1']);
    expect([...expandSelectionToGroups(['r0'], els, 'outer')].sort()).toEqual(['r0', 'r1']);
    expect([...expandSelectionToGroups(['r0'], els, 'inner')]).toEqual(['r0']);
  });
});

describe('frames', () => {
  it('assigns frame membership by center', () => {
    const frame = createElement('frame', { id: 'f', x: 0, y: 0, width: 300, height: 300 });
    const inside = createElement('rectangle', { id: 'in', x: 10, y: 10, width: 20, height: 20 });
    const outside = createElement('rectangle', { id: 'out', x: 1000, y: 10, width: 20, height: 20, frameId: 'f' });
    const patches = new Map(computeFrameMembership([inside, outside], [frame]));
    expect(patches.get('in')).toEqual({ frameId: 'f' });
    expect(patches.get('out')).toEqual({ frameId: null });
  });
});

describe('duplicateElements', () => {
  it('remaps ids, groups and bindings consistently', () => {
    const a = createElement('rectangle', { id: 'a', groupIds: ['g'] });
    const b = createElement('rectangle', { id: 'b', groupIds: ['g'] });
    const arrow = createElement('arrow', {
      id: 'c',
      groupIds: ['g'],
      startBinding: { elementId: 'a', portId: null, anchor: null, gap: 4 },
      endBinding: { elementId: 'zzz', portId: null, anchor: null, gap: 4 },
    });
    const { elements, idMap } = duplicateElements([a, b, arrow], { dx: 10, dy: 10 });
    const copyArrow = elements.find((e) => e.type === 'arrow')!;
    expect(copyArrow.type === 'arrow' && copyArrow.startBinding?.elementId).toBe(idMap.get('a'));
    expect(copyArrow.type === 'arrow' && copyArrow.endBinding).toBeNull();
    const groups = new Set(elements.map((e) => e.groupIds[0]));
    expect(groups.size).toBe(1);
    expect(groups.has('g')).toBe(false);
    expect(elements[0]!.x).toBe(10);
  });
});

describe('document serialization', () => {
  it('round-trips and drops invalid elements', () => {
    const els = rects(2);
    const doc = serializeDocument(els, DEFAULT_DOCUMENT_APP_STATE, {});
    const json = JSON.parse(JSON.stringify(doc));
    json.elements.push({ type: 'rectangle', id: 'bad', opacity: 9999 });
    json.elements.push({ type: 'hologram', id: 'weird' });
    const parsed = parseDocument(json);
    expect(parsed.document.elements.map((e) => e.id)).toEqual(['r0', 'r1']);
    expect(parsed.issues).toHaveLength(2);
  });

  it('migrates v1 documents', () => {
    const v1 = {
      version: 1,
      elements: [
        { type: 'rectangle', id: 'x', x: 0, y: 0, width: 10, height: 10, opacity: 0.5 },
        { type: 'ellipse', id: 'y', x: 0, y: 0, width: 10, height: 10 },
      ],
      appState: { gridSize: null },
    };
    const parsed = parseDocument(v1);
    expect(parsed.migratedFrom).toBe(1);
    expect(parsed.document.version).toBe(2);
    expect(parsed.document.elements.map((e) => e.id)).toEqual(['x', 'y']);
    expect(parsed.document.elements[0]!.opacity).toBe(50);
  });

  it('rejects documents from the future', () => {
    expect(() => parseDocument({ version: 99, elements: [] })).toThrow(/newer version/);
  });
});
