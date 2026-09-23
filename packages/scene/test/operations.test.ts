import { createElement, type SceneElement } from '@inkflow/elements';
import { describe, expect, it } from 'vitest';
import {
  Scene,
  Transaction,
  applyOperation,
  changesToOperations,
  indicesAbove,
  type Operation,
  type OperationMeta,
} from '../src';

let seq = 0;
const meta = (baseVersion: number | null): OperationMeta => ({
  opId: `op${++seq}`,
  clientId: 'client-1',
  clientSeq: seq,
  timestamp: 1000,
  baseVersion,
});

function makeScene() {
  const scene = new Scene();
  const keys = indicesAbove([], 3);
  scene.replaceAll([
    createElement('rectangle', { id: 'a', width: 10, height: 10, index: keys[0]! }),
    createElement('rectangle', { id: 'b', x: 50, width: 10, height: 10, index: keys[1]! }),
    createElement('text', { id: 't', text: 'hello', index: keys[2]! }),
  ]);
  return scene;
}

describe('changesToOperations', () => {
  it('derives semantic operation types', () => {
    const scene = makeScene();
    const tx = new Transaction(scene, 'mixed');
    tx.update('a', { x: 30, y: 40 });
    tx.update('b', { width: 50, height: 20 });
    tx.update('t', { text: 'changed', strokeColor: '#ff0000' });
    tx.create(createElement('ellipse', { id: 'e', index: indicesAbove(scene.getElements(), 1)[0]! }));
    const ops = changesToOperations(tx.commit()!.changes, meta);
    expect(ops.map((o) => o.type).sort()).toEqual(['CREATE_ELEMENT', 'MOVE_ELEMENT', 'RESIZE_ELEMENT', 'UPDATE_ELEMENT']);
  });

  it('emits GROUP_ELEMENTS / UNGROUP_ELEMENTS', () => {
    const scene = makeScene();
    let tx = new Transaction(scene, 'group');
    tx.update('a', { groupIds: ['g1'] });
    tx.update('b', { groupIds: ['g1'] });
    let ops = changesToOperations(tx.commit()!.changes, meta);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: 'GROUP_ELEMENTS', groupId: 'g1', elementIds: ['a', 'b'] });

    tx = new Transaction(scene, 'ungroup');
    tx.update('a', { groupIds: [] });
    tx.update('b', { groupIds: [] });
    ops = changesToOperations(tx.commit()!.changes, meta);
    expect(ops[0]).toMatchObject({ type: 'UNGROUP_ELEMENTS', groupId: 'g1' });
  });

  it('emits DELETE and ROTATE operations', () => {
    const scene = makeScene();
    const tx = new Transaction(scene, 'x');
    tx.delete(['a']);
    tx.update('b', { angle: 1 });
    const ops = changesToOperations(tx.commit()!.changes, meta);
    expect(ops.map((o) => o.type).sort()).toEqual(['DELETE_ELEMENT', 'ROTATE_ELEMENT']);
  });
});

describe('applyOperation', () => {
  const store = (els: SceneElement[]) => {
    const map = new Map(els.map((e) => [e.id, e]));
    return {
      get: (id: string) => map.get(id),
      apply(op: Operation) {
        const res = applyOperation((id) => map.get(id), op);
        for (const el of res.elements) map.set(el.id, el);
        return res;
      },
    };
  };

  it('merges concurrent property edits (per-property last writer wins)', () => {
    const base = createElement('rectangle', { id: 'r', width: 10, height: 10 });
    const s = store([base]);
    s.apply({ ...meta(base.version), type: 'MOVE_ELEMENT', elementId: 'r', x: 100, y: 100 });
    const res = s.apply({ ...meta(base.version), type: 'UPDATE_ELEMENT', elementId: 'r', patch: { strokeColor: '#00ff00' } });
    expect(res.conflicted).toBe(true);
    const r = s.get('r')!;
    expect(r.x).toBe(100);
    expect(r.strokeColor).toBe('#00ff00');
    expect(r.version).toBe(base.version + 2);
  });

  it('keeps deleted elements deleted on concurrent edits unless revived', () => {
    const base = createElement('rectangle', { id: 'r' });
    const s = store([base]);
    s.apply({ ...meta(1), type: 'DELETE_ELEMENT', elementId: 'r' });
    s.apply({ ...meta(1), type: 'MOVE_ELEMENT', elementId: 'r', x: 5, y: 5 });
    expect(s.get('r')!.isDeleted).toBe(true);
    s.apply({ ...meta(null), type: 'UPDATE_ELEMENT', elementId: 'r', patch: { isDeleted: false } });
    expect(s.get('r')!.isDeleted).toBe(false);
  });

  it('rejects invalid elements and protected keys', () => {
    const base = createElement('rectangle', { id: 'r' });
    const s = store([base]);
    const bad = s.apply({ ...meta(1), type: 'UPDATE_ELEMENT', elementId: 'r', patch: { opacity: 5000 } });
    expect(bad.rejected).toMatch(/Invalid element/);
    s.apply({ ...meta(1), type: 'UPDATE_ELEMENT', elementId: 'r', patch: { type: 'text' } as never });
    expect(s.get('r')!.type).toBe('rectangle');
  });

  it('is idempotent for groups', () => {
    const s = store([createElement('rectangle', { id: 'r' })]);
    const op: Operation = { ...meta(null), type: 'GROUP_ELEMENTS', groupId: 'g', elementIds: ['r'] };
    s.apply(op);
    s.apply(op);
    expect(s.get('r')!.groupIds).toEqual(['g']);
  });

  it('rejects CREATE_CONNECTION for non-connectors', () => {
    const s = store([]);
    const res = s.apply({ ...meta(null), type: 'CREATE_CONNECTION', element: createElement('rectangle', { id: 'x' }) });
    expect(res.rejected).toBeTruthy();
  });
});
