import { createElement } from '@inkflow/elements';
import { describe, expect, it } from 'vitest';
import { History, Scene, Transaction, applyPatch, indicesAbove } from '../src';

function setup() {
  const scene = new Scene();
  const [i1, i2] = indicesAbove([], 2);
  const a = createElement('rectangle', { id: 'a', x: 0, y: 0, width: 100, height: 50, index: i1! });
  const b = createElement('ellipse', { id: 'b', x: 200, y: 0, width: 80, height: 80, index: i2! });
  scene.replaceAll([a, b]);
  return { scene, history: new History() };
}

function undo(scene: Scene, history: History) {
  const entry = history.undo()!;
  const tx = new Transaction(scene, 'undo', 'history');
  for (const d of entry.deltas) tx.update(d.id, d.before);
  tx.commit();
}

function redo(scene: Scene, history: History) {
  const entry = history.redo()!;
  const tx = new Transaction(scene, 'redo', 'history');
  for (const d of entry.deltas) tx.update(d.id, d.after);
  tx.commit();
}

describe('Scene', () => {
  it('orders elements and maintains spatial queries', () => {
    const { scene } = setup();
    expect(scene.getElements().map((e) => e.id)).toEqual(['a', 'b']);
    expect(scene.queryPoint(210, 10, 1).map((e) => e.id)).toEqual(['b']);
    expect(scene.queryBounds({ minX: -10, minY: -10, maxX: 1000, maxY: 1000 })).toHaveLength(2);
  });

  it('tracks bound connectors', () => {
    const { scene } = setup();
    const c = createElement('connector', {
      id: 'c',
      index: indicesAbove(scene.getElements(), 1)[0]!,
      startBinding: { elementId: 'a', portId: 'right', anchor: null, gap: 4 },
      endBinding: { elementId: 'b', portId: null, anchor: null, gap: 4 },
      points: [
        [0, 0],
        [100, 0],
      ],
    });
    scene.upsert([c], 'local');
    expect(scene.getBoundLinears('a').map((e) => e.id)).toEqual(['c']);
    expect(scene.getBoundLinears('b').map((e) => e.id)).toEqual(['c']);
  });
});

describe('Transaction + History', () => {
  it('collapses a drag into a single entry and undoes it', () => {
    const { scene, history } = setup();
    const tx = new Transaction(scene, 'move');
    for (let i = 1; i <= 20; i++) tx.update('a', { x: i * 5, y: i * 2 });
    const committed = tx.commit()!;
    expect(committed.deltas).toHaveLength(1);
    expect(committed.deltas[0]!.before).toEqual({ x: 0, y: 0 });
    expect(committed.deltas[0]!.after).toEqual({ x: 100, y: 40 });
    history.record({ label: 'move', deltas: committed.deltas, selectionBefore: [], selectionAfter: [] });

    undo(scene, history);
    expect(scene.getElement('a')!.x).toBe(0);
    redo(scene, history);
    expect(scene.getElement('a')!.x).toBe(100);
  });

  it('undo of a creation tombstones the element; redo revives it', () => {
    const { scene, history } = setup();
    const tx = new Transaction(scene, 'create');
    tx.create(createElement('diamond', { id: 'd', index: indicesAbove(scene.getElements(), 1)[0]! }));
    const committed = tx.commit()!;
    history.record({ label: 'create', deltas: committed.deltas, selectionBefore: [], selectionAfter: ['d'] });
    expect(scene.getElements()).toHaveLength(3);
    undo(scene, history);
    expect(scene.getElements()).toHaveLength(2);
    expect(scene.getElement('d')!.isDeleted).toBe(true);
    redo(scene, history);
    expect(scene.getLiveElement('d')).toBeDefined();
  });

  it('undo preserves concurrent edits to other properties', () => {
    const { scene, history } = setup();
    const tx = new Transaction(scene, 'color');
    tx.update('a', { strokeColor: '#ff0000' });
    history.record({ label: 'color', deltas: tx.commit()!.deltas, selectionBefore: [], selectionAfter: [] });
    // A collaborator moves the element afterwards.
    scene.upsert([applyPatch(scene.getElement('a')!, { x: 500 })], 'remote');
    undo(scene, history);
    const a = scene.getElement('a')!;
    expect(a.strokeColor).toBe('#1e1e1e');
    expect(a.x).toBe(500);
  });

  it('rollback restores the initial state', () => {
    const { scene } = setup();
    const tx = new Transaction(scene, 'x');
    tx.update('a', { width: 999 });
    tx.create(createElement('text', { id: 't', text: 'hi', index: indicesAbove(scene.getElements(), 1)[0]! }));
    tx.rollback();
    expect(scene.getElement('a')!.width).toBe(100);
    expect(scene.getElement('t')).toBeUndefined();
  });

  it('returns null for no-op transactions', () => {
    const { scene } = setup();
    const tx = new Transaction(scene, 'noop');
    tx.update('a', { x: 0 });
    expect(tx.commit()).toBeNull();
  });
});
