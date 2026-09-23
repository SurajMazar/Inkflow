import { Injectable } from '@nestjs/common';
import type { Board, ShareLink, WorkspaceRole } from '@inkflow/database';
import { boardRoleAtLeast, isUuid, workspaceRoleAtLeast, type BoardRole } from '@inkflow/shared';
import { safeEqual, sha256Hex } from '../common/crypto';
import { Errors } from '../common/errors';
import { NIL_UUID } from '../common/mappers';
import type { Principal } from '../common/request';
import { PrismaService } from '../prisma/prisma.service';
import { computeEffectiveRole } from './effective-role';

export interface BoardAccess {
  board: Board;
  role: BoardRole;
  /** Role without the share link (null for anonymous visitors / link-only access). */
  ownRole: BoardRole | null;
  viaShareLink: boolean;
  shareLinkId: string | null;
  userId: string | null;
  workspaceRole: WorkspaceRole | null;
}

export interface AccessOptions {
  /** Allow boards in the trash (only principals with their own OWNER role can see them). */
  includeDeleted?: boolean;
}

const LINK_TOUCH_INTERVAL_MS = 60_000;

/** Central effective-role resolver for every board-scoped HTTP route and WebSocket message. */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** A share link that is currently valid (not revoked, not expired, board not deleted). */
  async resolveShareLink(
    token: string | null | undefined,
    boardId?: string,
  ): Promise<ShareLink | null> {
    if (!token || token.length < 16 || token.length > 512) return null;
    const tokenHash = sha256Hex(token);
    const link = await this.prisma.shareLink.findUnique({ where: { tokenHash } });
    if (!link || !safeEqual(link.tokenHash, tokenHash)) return null;
    if (link.revokedAt) return null;
    if (link.expiresAt && link.expiresAt <= new Date()) return null;
    if (boardId && link.boardId !== boardId) return null;
    if (!link.lastUsedAt || Date.now() - link.lastUsedAt.getTime() > LINK_TOUCH_INTERVAL_MS) {
      void this.prisma.shareLink
        .update({ where: { id: link.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }
    return link;
  }

  /** Resolves the principal's effective role on a board; null when the board is invisible to them. */
  async getBoardAccess(
    boardId: string,
    principal: Principal,
    options: AccessOptions = {},
  ): Promise<BoardAccess | null> {
    if (!isUuid(boardId)) return null;
    const userId = principal.userId && isUuid(principal.userId) ? principal.userId : null;
    const uid = userId ?? NIL_UUID;
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      include: {
        members: { where: { userId: uid }, select: { role: true } },
        workspace: { select: { members: { where: { userId: uid }, select: { role: true } } } },
      },
    });
    if (!board) return null;
    const workspaceRole = board.workspace.members[0]?.role ?? null;
    const link = board.deletedAt
      ? null
      : await this.resolveShareLink(principal.shareToken, board.id);
    const { role, ownRole, viaShareLink } = computeEffectiveRole({
      isOwner: userId !== null && board.ownerId === userId,
      memberRole: board.members[0]?.role ?? null,
      workspaceRole,
      workspaceAccess: board.workspaceAccess,
      linkRole: link?.role ?? null,
    });
    if (!role) return null;
    if (board.deletedAt && (!options.includeDeleted || ownRole !== 'OWNER')) return null;
    const { members: _m, workspace: _w, ...plain } = board;
    return {
      board: plain,
      role,
      ownRole,
      viaShareLink,
      shareLinkId: viaShareLink && link ? link.id : null,
      userId,
      workspaceRole,
    };
  }

  /** Like `getBoardAccess` but throws 404 (no access) / 403 (insufficient role). */
  async requireBoard(
    boardId: string,
    principal: Principal,
    minRole: BoardRole,
    options: AccessOptions = {},
  ): Promise<BoardAccess> {
    const access = await this.getBoardAccess(boardId, principal, options);
    if (!access) throw Errors.notFound('Board');
    if (!boardRoleAtLeast(access.role, minRole)) throw Errors.forbidden();
    return access;
  }

  /** The user's role in a workspace, or null. */
  async workspaceRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    if (!isUuid(workspaceId)) return null;
    const m = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    return m?.role ?? null;
  }

  /** Throws 404 when the user is not a member, 403 when the role is too low. */
  async requireWorkspace(
    workspaceId: string,
    userId: string,
    minRole: WorkspaceRole = 'MEMBER',
  ): Promise<WorkspaceRole> {
    const role = await this.workspaceRole(workspaceId, userId);
    if (!role) throw Errors.notFound('Workspace');
    if (!workspaceRoleAtLeast(role, minRole)) throw Errors.forbidden();
    return role;
  }
}
