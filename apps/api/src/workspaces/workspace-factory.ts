import { randomBytes } from 'node:crypto';
import { Prisma, type Workspace } from '@inkflow/database';
import { slugify } from '../common/mappers';
import type { Db } from '../prisma/prisma.service';

function slugCandidate(name: string): string {
  return `${slugify(name)}-${randomBytes(3).toString('hex')}`;
}

/** Creates a workspace owned by `userId` (slug collisions are retried). */
export async function createWorkspaceRecord(db: Db, userId: string, name: string): Promise<Workspace> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.workspace.create({
        data: {
          name,
          slug: slugCandidate(name),
          createdById: userId,
          members: { create: { userId, role: 'OWNER' } },
        },
      });
    } catch (err) {
      const isSlugConflict =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt < 5;
      if (!isSlugConflict) throw err;
    }
  }
}

export function personalWorkspaceName(userName: string): string {
  const first = userName.trim().split(/\s+/)[0] || 'My';
  return `${first}'s workspace`.slice(0, 80);
}
