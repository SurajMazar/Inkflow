import { describe, expect, it } from 'vitest';
import { BoardsService } from '../src/boards/boards.service';
import { createAppContext } from '../src/bootstrap';
import { OperationsService } from '../src/operations/operations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createWorkspaceRecord } from '../src/workspaces/workspace-factory';
import { createOp, element } from './helpers';
import { testEnv } from './env';

describe('standalone application context', () => {
  it('exposes the services without an HTTP server (seed scripts)', async () => {
    const ctx = await createAppContext(testEnv());
    try {
      const prisma = ctx.get(PrismaService);
      const user = await prisma.user.create({ data: { email: `ctx-${Date.now()}@example.test`, name: 'Seeder', emailVerifiedAt: new Date() } });
      const ws = await createWorkspaceRecord(prisma, user.id, 'Seeded');
      const board = await ctx.get(BoardsService).create(user.id, { workspaceId: ws.id, title: 'Seeded board' });
      const result = await ctx.get(OperationsService).applyBatch(board.id, { userId: user.id }, 'seed', [createOp('seed', element('rectangle'))]);
      expect(result.results[0]!.status).toBe('applied');
      expect(await prisma.boardElement.count({ where: { boardId: board.id } })).toBe(1);
    } finally {
      await ctx.close();
    }
  });
});
