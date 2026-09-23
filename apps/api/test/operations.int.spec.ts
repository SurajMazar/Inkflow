import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpResult, ServerChange } from '@inkflow/collaboration';
import { generateNKeysBetween } from '@inkflow/scene';
import type { BoardDetailDto } from '@inkflow/shared';
import { createBoard, createOp, element, moveOp, op, signUp, startApp, type TestApp } from './helpers';

let t: TestApp;

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t?.close();
});

interface BatchResponse {
  results: OpResult[];
  changes: ServerChange[];
  seq: number;
}

describe('operations (HTTP fallback)', () => {
  it('persists operations in PostgreSQL with consecutive seqs and idempotent retries', async () => {
    const owner = await signUp(t.url, 'Op Owner');
    const board = await createBoard(owner);
    const clientId = 'client-http-1';
    const [k1, k2] = generateNKeysBetween(null, null, 2);
    const rect = element('rectangle', { id: 'r1', index: k2! });
    const text = element('text', { id: 't1', index: k1!, text: 'Hello database' });
    const ops = [createOp(clientId, rect), createOp(clientId, text), moveOp(clientId, 'r1', 300, 400)];
    const res = await owner.post<BatchResponse>(`/api/boards/${board.id}/operations`, { clientId, batchId: 'batch-1', ops });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r) => [r.status, r.seq])).toEqual([
      ['applied', 1],
      ['applied', 2],
      ['applied', 3],
    ]);
    expect(res.body.seq).toBe(3);
    expect(res.body.changes.map((c) => c.seq)).toEqual([1, 2, 3]);
    const moved = res.body.changes[2]!.elements[0]!;
    expect(moved).toMatchObject({ id: 'r1', x: 300, y: 400, version: 3 });

    // Stored in board_elements / board_operations.
    const rows = await t.prisma.boardElement.findMany({ where: { boardId: board.id }, orderBy: { elementId: 'asc' } });
    expect(rows.map((r) => [r.elementId, r.version, r.isDeleted])).toEqual([
      ['r1', 3, false],
      ['t1', 2, false],
    ]);
    expect(rows.find((r) => r.elementId === 't1')!.searchText).toBe('Hello database');
    expect((rows.find((r) => r.elementId === 'r1')!.data as { x: number }).x).toBe(300);
    const log = await t.prisma.boardOperation.findMany({ where: { boardId: board.id }, orderBy: { seq: 'asc' } });
    expect(log.map((l) => [Number(l.seq), l.type, l.elementIds])).toEqual([
      [1, 'CREATE_ELEMENT', ['r1']],
      [2, 'CREATE_ELEMENT', ['t1']],
      [3, 'MOVE_ELEMENT', ['r1']],
    ]);
    const boardRow = await t.prisma.board.findUniqueOrThrow({ where: { id: board.id } });
    expect(Number(boardRow.seq)).toBe(3);
    expect(boardRow.elementCount).toBe(2);
    expect(boardRow.opsSinceVersion).toBe(3);

    // Reload returns them in z-order.
    const detail = await owner.get<BoardDetailDto>(`/api/boards/${board.id}`);
    expect(detail.body.seq).toBe(3);
    expect(detail.body.document.elements.map((e) => (e as { id: string }).id)).toEqual(['t1', 'r1']);

    // Retrying the same ops is a no-op reported as duplicate.
    const retry = await owner.post<BatchResponse>(`/api/boards/${board.id}/operations`, { clientId, batchId: 'batch-1', ops });
    expect(retry.body.results.map((r) => [r.status, r.seq])).toEqual([
      ['duplicate', 1],
      ['duplicate', 2],
      ['duplicate', 3],
    ]);
    expect(retry.body.changes).toEqual([]);
    expect(retry.body.seq).toBe(3);
  });

  it('rejects invalid operations without aborting the batch', async () => {
    const owner = await signUp(t.url, 'Op Validator');
    const board = await createBoard(owner);
    const clientId = 'client-http-2';
    const good = element('ellipse', { id: 'e1' });
    const invalidElement = { ...element('rectangle', { id: 'bad' }), width: -5 };
    const ops = [
      createOp(clientId, invalidElement as never),
      op(clientId, { type: 'MOVE_ELEMENT', elementId: 'missing', x: 1, y: 1 }),
      { type: 'NOPE', opId: 'x' },
      op('someone-else', { type: 'DELETE_ELEMENT', elementId: 'e1' }),
      createOp(clientId, good),
      op(clientId, { type: 'UPDATE_ELEMENT', elementId: 'e1', patch: { strokeColor: '#ff0000', id: 'hijack', version: 999 } }),
      op(clientId, { type: 'DELETE_ELEMENT', elementId: 'e1' }),
    ];
    const res = await owner.post<BatchResponse>(`/api/boards/${board.id}/operations`, { clientId, batchId: 'b2', ops });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'applied', 'applied', 'applied']);
    expect(res.body.results.map((r) => r.seq)).toEqual([null, null, null, null, 1, 2, 3]);
    const updated = res.body.changes[1]!.elements[0]!;
    expect(updated).toMatchObject({ id: 'e1', strokeColor: '#ff0000', version: 3 });
    const row = await t.prisma.boardElement.findUniqueOrThrow({ where: { boardId_elementId: { boardId: board.id, elementId: 'e1' } } });
    expect(row.isDeleted).toBe(true);
    expect((await t.prisma.board.findUniqueOrThrow({ where: { id: board.id } })).elementCount).toBe(0);
    const detail = await owner.get<BoardDetailDto>(`/api/boards/${board.id}`);
    expect(detail.body.document.elements).toEqual([]);

    // Structurally invalid body.
    expect((await owner.post(`/api/boards/${board.id}/operations`, { clientId, batchId: 'b3', ops: [] })).status).toBe(400);
  });

  it('merges concurrent edits per property and serves changes since a seq', async () => {
    const owner = await signUp(t.url, 'Op Merger');
    const board = await createBoard(owner);
    const el = element('rectangle', { id: 'shared' });
    await owner.post(`/api/boards/${board.id}/operations`, { clientId: 'a', batchId: '1', ops: [createOp('a', el)] });
    // Both clients edit from base version 1: different properties both survive.
    await owner.post(`/api/boards/${board.id}/operations`, {
      clientId: 'a',
      batchId: '2',
      ops: [op('a', { type: 'UPDATE_ELEMENT', elementId: 'shared', patch: { strokeColor: '#111111' } }, 1)],
    });
    const second = await owner.post<BatchResponse>(`/api/boards/${board.id}/operations`, {
      clientId: 'b',
      batchId: '3',
      ops: [op('b', { type: 'UPDATE_ELEMENT', elementId: 'shared', patch: { backgroundColor: '#222222' } }, 1)],
    });
    expect(second.body.changes[0]!.elements[0]).toMatchObject({ strokeColor: '#111111', backgroundColor: '#222222', version: 4 });

    const since = await owner.get<{ seq: number; changes: ServerChange[] | null }>(`/api/boards/${board.id}/changes`, { query: { since: 1 } });
    expect(since.body.seq).toBe(3);
    expect(since.body.changes).toHaveLength(1);
    expect(since.body.changes![0]).toMatchObject({ seq: 3, clientId: 'b' });
    const none = await owner.get<{ changes: ServerChange[] }>(`/api/boards/${board.id}/changes`, { query: { since: 3 } });
    expect(none.body.changes).toEqual([]);
    // Compacted history → null (reload).
    await t.prisma.boardOperation.deleteMany({ where: { boardId: board.id, seq: { lte: 2 } } });
    const gap = await owner.get<{ changes: ServerChange[] | null }>(`/api/boards/${board.id}/changes`, { query: { since: 0 } });
    expect(gap.body.changes).toBeNull();
  });
});
