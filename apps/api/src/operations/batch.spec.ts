import { describe, expect, it } from 'vitest';
import { createElement, type SceneElement } from '@inkflow/elements';
import type { Operation } from '@inkflow/scene';
import { batchTargets, candidateFileIds, checkResultingElements, parseOps, planBatch } from './batch';

let n = 0;
function op(body: Record<string, unknown>, clientId = 'c1'): Operation {
  n++;
  return { opId: `op-${n}`, clientId, clientSeq: n, timestamp: 1, baseVersion: null, ...body } as Operation;
}
const rect = (id: string, props: Record<string, unknown> = {}) =>
  createElement('rectangle', { id, x: 0, y: 0, width: 10, height: 10, ...props }) as SceneElement;
const noFiles = { boardOf: () => null };

function plan(ops: unknown[], current: SceneElement[] = [], extra: Partial<Parameters<typeof planBatch>[0]> = {}) {
  return planBatch({
    boardId: 'board-1',
    startSeq: 10,
    liveCount: current.filter((e) => !e.isDeleted).length,
    current: new Map(current.map((e) => [e.id, e])),
    ops: parseOps(ops, 'c1'),
    duplicates: new Map(),
    files: noFiles,
    now: 1000,
    ...extra,
  });
}

describe('operation batches', () => {
  it('validates structure and the connection client id', () => {
    const parsed = parseOps([op({ type: 'DELETE_ELEMENT', elementId: 'a' }), { type: 'NOPE' }, op({ type: 'DELETE_ELEMENT', elementId: 'a' }, 'c2')], 'c1');
    expect(parsed.map((p) => p.invalid === null)).toEqual([true, false, false]);
    expect(parsed[2]!.invalid).toContain('clientId');
  });

  it('assigns consecutive seqs to applied ops and lets later ops see earlier results', () => {
    const result = plan([
      op({ type: 'CREATE_ELEMENT', element: rect('a') }),
      op({ type: 'MOVE_ELEMENT', elementId: 'a', x: 5, y: 6 }),
      op({ type: 'MOVE_ELEMENT', elementId: 'missing', x: 1, y: 1 }),
      op({ type: 'UPDATE_ELEMENT', elementId: 'a', patch: { strokeColor: '#f00' } }),
    ]);
    expect(result.results.map((r) => [r.status, r.seq])).toEqual([
      ['applied', 11],
      ['applied', 12],
      ['rejected', null],
      ['applied', 13],
    ]);
    expect(result.lastSeq).toBe(13);
    expect(result.finalStates.get('a')).toMatchObject({ x: 5, y: 6, strokeColor: '#f00', version: 4, updated: 1000 });
    expect(result.liveDelta).toBe(1);
  });

  it('reports duplicates from the log and within the batch', () => {
    const repeated = op({ type: 'CREATE_ELEMENT', element: rect('b') });
    const known = op({ type: 'DELETE_ELEMENT', elementId: 'b' });
    const result = plan([known, repeated, repeated], [], { duplicates: new Map([[known.opId, 7]]) });
    expect(result.results.map((r) => [r.status, r.seq])).toEqual([
      ['duplicate', 7],
      ['applied', 11],
      ['duplicate', 11],
    ]);
  });

  it('tracks live element counts through deletes and revivals', () => {
    const existing = [rect('x'), rect('y', { isDeleted: true })];
    const result = plan(
      [op({ type: 'DELETE_ELEMENT', elementId: 'x' }), op({ type: 'UPDATE_ELEMENT', elementId: 'y', patch: { isDeleted: false } })],
      existing,
    );
    expect(result.liveDelta).toBe(0);
    expect(result.finalStates.get('x')!.isDeleted).toBe(true);
    expect(result.finalStates.get('y')!.isDeleted).toBe(false);
  });

  it('rejects images pointing at files of other boards but accepts unknown files', () => {
    const fileId = '3f2b8c1e-1d2a-4b5c-8d9e-0a1b2c3d4e5f';
    const img = createElement('image', { id: 'img', fileId, width: 1, height: 1 }) as SceneElement;
    const state = new Map<string, SceneElement>();
    expect(checkResultingElements([img], state, 'board-1', { boardOf: () => 'board-2' })).toContain('another board');
    expect(checkResultingElements([img], state, 'board-1', { boardOf: () => 'board-1' })).toBeNull();
    expect(checkResultingElements([img], state, 'board-1', noFiles)).toBeNull();
    // Unchanged file ids are not re-checked (e.g. moving an imported image).
    state.set('img', img);
    expect(checkResultingElements([{ ...img, x: 5 }], state, 'board-1', { boardOf: () => 'board-2' })).toBeNull();
    expect(candidateFileIds([op({ type: 'CREATE_ELEMENT', element: img })])).toEqual([fileId]);
  });

  it('rejects elements containing NUL characters', () => {
    const result = plan([op({ type: 'CREATE_ELEMENT', element: createElement('text', { id: 't', text: 'a\u0000b', width: 5, height: 5 }) })]);
    expect(result.results[0]).toMatchObject({ status: 'rejected' });
  });

  it('lists the element ids a batch touches', () => {
    expect(
      batchTargets([
        op({ type: 'CREATE_ELEMENT', element: rect('a') }),
        op({ type: 'GROUP_ELEMENTS', elementIds: ['a', 'b'], groupId: 'g' }),
      ]),
    ).toEqual(['a', 'b']);
  });
});
