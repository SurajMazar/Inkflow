import type { Board, BoardRole, Prisma } from '@inkflow/database';
import type { BoardSummaryDto } from '@inkflow/shared';
import { computeEffectiveRole } from '../access/effective-role';
import { iso, NIL_UUID, publicUserSelect, toPublicUser, type PublicUserRow } from '../common/mappers';

/** Relations needed to render a `BoardSummaryDto` for a given viewer. */
export function summaryInclude(userId: string | null) {
  const uid = userId ?? NIL_UUID;
  return {
    owner: { select: publicUserSelect },
    members: { where: { userId: uid }, select: { role: true } },
    favorites: { where: { userId: uid }, select: { userId: true } },
    views: { where: { userId: uid }, select: { lastViewedAt: true } },
    workspace: { select: { members: { where: { userId: uid }, select: { role: true } } } },
  } satisfies Prisma.BoardInclude;
}

export type BoardWithSummary = Board & {
  owner: PublicUserRow;
  members: { role: BoardRole }[];
  favorites: { userId: string }[];
  views: { lastViewedAt: Date }[];
  workspace: { members: { role: 'OWNER' | 'ADMIN' | 'MEMBER' }[] };
};

export function thumbnailUrl(board: Pick<Board, 'id' | 'thumbnailKey'>): string | null {
  if (!board.thumbnailKey) return null;
  const version = board.thumbnailKey.split('/').pop()?.split('.')[0] ?? '';
  return `/api/boards/${board.id}/thumbnail?v=${encodeURIComponent(version)}`;
}

/** The viewer's own role derived from the included relations (no share link). */
export function ownRoleOf(board: BoardWithSummary, userId: string | null): BoardRole | null {
  return computeEffectiveRole({
    isOwner: userId !== null && board.ownerId === userId,
    memberRole: board.members[0]?.role ?? null,
    workspaceRole: board.workspace.members[0]?.role ?? null,
    workspaceAccess: board.workspaceAccess,
    linkRole: null,
  }).role;
}

export function toBoardSummary(board: BoardWithSummary, role: BoardRole): BoardSummaryDto {
  return {
    id: board.id,
    workspaceId: board.workspaceId,
    projectId: board.projectId,
    folderId: board.folderId,
    title: board.title,
    role,
    workspaceAccess: board.workspaceAccess,
    isFavorite: board.favorites.length > 0,
    thumbnailUrl: thumbnailUrl(board),
    owner: toPublicUser(board.owner),
    elementCount: board.elementCount,
    createdAt: iso(board.createdAt),
    updatedAt: iso(board.updatedAt),
    deletedAt: iso(board.deletedAt),
    lastViewedAt: iso(board.views[0]?.lastViewedAt ?? null),
  };
}

/** Boards a signed-in user can open through their own roles. */
export function accessibleBoardsWhere(userId: string): Prisma.BoardWhereInput {
  return {
    OR: [
      { ownerId: userId },
      { members: { some: { userId } } },
      { workspace: { members: { some: { userId, role: { in: ['OWNER', 'ADMIN'] } } } } },
      { workspaceAccess: { in: ['VIEWER', 'EDITOR'] }, workspace: { members: { some: { userId } } } },
    ],
  };
}

/** Boards whose trash the user may manage (own OWNER role). */
export function manageableBoardsWhere(userId: string): Prisma.BoardWhereInput {
  return {
    OR: [
      { ownerId: userId },
      { members: { some: { userId, role: 'OWNER' } } },
      { workspace: { members: { some: { userId, role: { in: ['OWNER', 'ADMIN'] } } } } },
    ],
  };
}
