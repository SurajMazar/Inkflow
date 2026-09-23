import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileDto } from '@inkflow/shared';
import { JobsService } from '../src/jobs/jobs.service';
import { StorageService } from '../src/storage/storage.service';
import { createBoard, createOp, element, moveOp, PNG_1X1, signUp, startApp, type TestApp } from './helpers';

let t: TestApp;

beforeAll(async () => {
  t = await startApp({ TRASH_RETENTION_DAYS: '30' });
});
afterAll(async () => {
  await t?.close();
});

describe('background jobs', () => {
  it('purges boards that stayed in the trash past the retention period, with their objects', async () => {
    const owner = await signUp(t.url, 'Janitor');
    const old = await createBoard(owner, { title: 'Old trash' });
    const recent = await createBoard(owner, { title: 'Recent trash' });
    // A unique image so its object is not shared with other tests.
    const unique = Buffer.concat([PNG_1X1, Buffer.from(`-${old.id}`)]);
    const file = await owner.upload<FileDto>('/api/files', { buffer: unique, filename: 'u.png', contentType: 'image/png' }, { boardId: old.id });
    expect(file.status).toBe(201);
    const key = (await t.prisma.file.findUniqueOrThrow({ where: { id: file.body.id } })).storageKey;
    const storage = t.app.get(StorageService);
    expect(await storage.exists(key)).toBe(true);

    await owner.delete(`/api/boards/${old.id}`);
    await owner.delete(`/api/boards/${recent.id}`);
    await t.prisma.board.update({ where: { id: old.id }, data: { deletedAt: new Date(Date.now() - 31 * 86_400_000) } });

    const purged = await t.app.get(JobsService).purgeTrash();
    expect(purged).toBe(1);
    expect(await t.prisma.board.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await t.prisma.board.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(await t.prisma.file.findUnique({ where: { id: file.body.id } })).toBeNull();
    expect(await storage.exists(key)).toBe(false);
  });

  it('compacts old operations but keeps the latest ones of every board', async () => {
    const owner = await signUp(t.url, 'Compactor');
    const board = await createBoard(owner);
    const c = 'compact-client';
    const ops = [createOp(c, element('rectangle', { id: 'x' })), ...Array.from({ length: 9 }, (_, i) => moveOp(c, 'x', i, i))];
    await owner.post(`/api/boards/${board.id}/operations`, { clientId: c, batchId: '1', ops });
    await t.prisma.boardOperation.updateMany({ where: { boardId: board.id }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    const removed = await t.app.get(JobsService).compactOperations(new Date(), 3);
    expect(removed).toBeGreaterThanOrEqual(7);
    const remaining = await t.prisma.boardOperation.findMany({ where: { boardId: board.id }, orderBy: { seq: 'asc' } });
    expect(remaining.map((r) => Number(r.seq))).toEqual([8, 9, 10]);
  });

  it('runs a job only when the advisory lock is free', async () => {
    const jobs = t.app.get(JobsService);
    const results = await Promise.all([
      jobs.withLock(424242, async () => {
        await new Promise((r) => setTimeout(r, 300));
        return 'first';
      }),
      new Promise((r) => setTimeout(r, 50)).then(() => jobs.withLock(424242, async () => 'second')),
    ]);
    expect(results).toEqual(['first', null]);
  });
});
