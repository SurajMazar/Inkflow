import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BoardDetailDto,
  BoardVersionDetailDto,
  BoardVersionDto,
  VersionComparisonDto,
} from '@inkflow/shared';
import { VersionsService } from '../src/versions/versions.service';
import {
  createBoard,
  createOp,
  element,
  eventually,
  moveOp,
  op,
  signUp,
  startApp,
  type TestApp,
} from './helpers';

let t: TestApp;

beforeAll(async () => {
  t = await startApp({ AUTO_VERSION_EVERY_OPS: '10', AUTO_VERSION_EVERY_MINUTES: '60' });
});
afterAll(async () => {
  await t?.close();
});

describe('versions', () => {
  it('creates manual versions, restores them with a backup and compares', async () => {
    const owner = await signUp(t.url, 'Versioner');
    const board = await createBoard(owner);
    const c = 'v-client';
    await owner.post(`/api/boards/${board.id}/operations`, {
      clientId: c,
      batchId: '1',
      ops: [
        createOp(c, element('rectangle', { id: 'a' })),
        createOp(c, element('ellipse', { id: 'b' })),
      ],
    });
    const v1 = await owner.post<BoardVersionDto>(`/api/boards/${board.id}/versions`, {
      label: 'Two shapes',
    });
    expect(v1.status).toBe(201);
    expect(v1.body).toMatchObject({
      number: 1,
      label: 'Two shapes',
      kind: 'MANUAL',
      elementCount: 2,
      seq: 2,
    });
    expect(v1.body.createdBy?.id).toBe(owner.user!.id);

    // Change the board: move a, delete b, add c.
    await owner.post(`/api/boards/${board.id}/operations`, {
      clientId: c,
      batchId: '2',
      ops: [
        moveOp(c, 'a', 500, 500),
        op(c, { type: 'DELETE_ELEMENT', elementId: 'b' }),
        createOp(c, element('diamond', { id: 'c' })),
      ],
    });

    const cmp = await owner.get<VersionComparisonDto>(
      `/api/boards/${board.id}/versions/${v1.body.id}/compare`,
      { query: { to: 'current' } },
    );
    expect(cmp.body).toMatchObject({
      fromVersionId: v1.body.id,
      toVersionId: 'current',
      added: ['c'],
      removed: ['b'],
      modified: ['a'],
      unchangedCount: 0,
    });

    const detail = await owner.get<BoardVersionDetailDto>(
      `/api/boards/${board.id}/versions/${v1.body.id}`,
    );
    expect(detail.body.document.elements.map((e) => (e as { id: string }).id).sort()).toEqual([
      'a',
      'b',
    ]);

    const backup = await owner.post<BoardVersionDto>(
      `/api/boards/${board.id}/versions/${v1.body.id}/restore`,
    );
    expect(backup.status).toBe(200);
    expect(backup.body).toMatchObject({ number: 2, kind: 'RESTORE_BACKUP', elementCount: 2 });

    const restored = await owner.get<BoardDetailDto>(`/api/boards/${board.id}`);
    const els = restored.body.document.elements as { id: string; x: number; version: number }[];
    expect(els.map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(els.find((e) => e.id === 'a')!.x).toBe(10);
    expect(restored.body.seq).toBe(6);
    const rowC = await t.prisma.boardElement.findUniqueOrThrow({
      where: { boardId_elementId: { boardId: board.id, elementId: 'c' } },
    });
    expect(rowC.isDeleted).toBe(true);

    const cmpVersions = await owner.get<VersionComparisonDto>(
      `/api/boards/${board.id}/versions/${v1.body.id}/compare`,
      {
        query: { to: backup.body.id },
      },
    );
    expect(cmpVersions.body).toMatchObject({ added: ['c'], removed: ['b'], modified: ['a'] });

    const list = await owner.get<BoardVersionDto[]>(`/api/boards/${board.id}/versions`);
    expect(list.body.map((v) => v.number)).toEqual([2, 1]);

    // Viewers cannot create or restore versions.
    const viewer = await signUp(t.url, 'Version Viewer');
    await owner.post(`/api/boards/${board.id}/shares`, {
      email: viewer.user!.email,
      role: 'VIEWER',
    });
    expect((await viewer.get(`/api/boards/${board.id}/versions`)).status).toBe(200);
    expect((await viewer.post(`/api/boards/${board.id}/versions`, {})).status).toBe(403);
    expect(
      (await viewer.post(`/api/boards/${board.id}/versions/${v1.body.id}/restore`)).status,
    ).toBe(403);
    expect(
      (await owner.get(`/api/boards/${board.id}/versions/00000000-0000-4000-8000-000000000000`))
        .status,
    ).toBe(404);
  });

  it('creates automatic versions after enough operations', async () => {
    const owner = await signUp(t.url, 'Auto Versioner');
    const board = await createBoard(owner);
    const c = 'auto-client';
    const ops = Array.from({ length: 12 }, (_, i) =>
      createOp(c, element('rectangle', { id: `r${i}` })),
    );
    await owner.post(`/api/boards/${board.id}/operations`, { clientId: c, batchId: '1', ops });
    await t.app.get(VersionsService).drain();
    const versions = await eventually(async () => {
      const res = await owner.get<BoardVersionDto[]>(`/api/boards/${board.id}/versions`);
      return res.body.length > 0 ? res.body : null;
    });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      number: 1,
      kind: 'AUTO',
      elementCount: 12,
      seq: 12,
      createdBy: null,
    });
    const row = await t.prisma.board.findUniqueOrThrow({ where: { id: board.id } });
    expect(row.opsSinceVersion).toBe(0);

    // Concurrent triggers never produce duplicate numbers.
    await owner.post(`/api/boards/${board.id}/operations`, {
      clientId: c,
      batchId: '2',
      ops: Array.from({ length: 11 }, (_, i) => moveOp(c, `r${i}`, i, i)),
    });
    const service = t.app.get(VersionsService);
    await Promise.all([
      service.createAutoVersionIfDue(board.id),
      service.createAutoVersionIfDue(board.id),
      service.drain(),
    ]);
    const numbers = (await t.prisma.boardVersion.findMany({ where: { boardId: board.id } }))
      .map((v) => v.number)
      .sort();
    expect(numbers).toEqual([1, 2]);
  });
});
