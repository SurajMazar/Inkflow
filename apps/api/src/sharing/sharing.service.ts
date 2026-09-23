import { Injectable } from '@nestjs/common';
import type { BoardRole, ShareLink } from '@inkflow/database';
import {
  boardRoleAtLeast,
  type AddBoardShareRequest,
  type BoardMemberDto,
  type BoardSharingDto,
  type CreateShareLinkRequest,
  type ResolvedShareLinkDto,
  type ShareLinkDto,
  type UpdateBoardMemberRequest,
} from '@inkflow/shared';
import { AccessService } from '../access/access.service';
import { RealtimeService } from '../collaboration/realtime.service';
import { AppConfig } from '../config/app-config';
import { decryptString, deriveKey, encryptString, randomToken, sha256Hex } from '../common/crypto';
import { Errors } from '../common/errors';
import { iso, publicUserSelect, toPublicUser, type PublicUserRow } from '../common/mappers';
import type { Principal } from '../common/request';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { OnboardingService } from '../users/onboarding.service';

export const SHARE_LINK_KEY_PURPOSE = 'share-link-token';

/** Encrypts share-link tokens at rest so owners can copy links again (hash is used for lookups). */
export class ShareLinkCipher {
  private readonly key: Buffer;
  constructor(sessionSecret: string) {
    this.key = deriveKey(sessionSecret, SHARE_LINK_KEY_PURPOSE);
  }
  /** New random token with its hash and ciphertext. */
  issue(): { token: string; tokenHash: string; ciphertext: string } {
    const token = randomToken(32);
    return { token, tokenHash: sha256Hex(token), ciphertext: encryptString(this.key, token) };
  }
  reveal(ciphertext: string): string | null {
    return decryptString(this.key, ciphertext);
  }
}

@Injectable()
export class SharingService {
  private readonly cipher: ShareLinkCipher;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly realtime: RealtimeService,
    private readonly config: AppConfig,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly onboarding: OnboardingService,
  ) {
    this.cipher = new ShareLinkCipher(config.env.SESSION_SECRET);
  }

  private toLink(link: ShareLink & { createdBy: PublicUserRow }): ShareLinkDto | null {
    const token = this.cipher.reveal(link.tokenCiphertext);
    if (!token) return null;
    return {
      id: link.id,
      boardId: link.boardId,
      role: link.role,
      token,
      url: this.config.webLink(`/s/${token}`),
      expiresAt: iso(link.expiresAt),
      createdAt: iso(link.createdAt),
      createdBy: toPublicUser(link.createdBy),
      lastUsedAt: iso(link.lastUsedAt),
    };
  }

  async sharing(boardId: string): Promise<BoardSharingDto> {
    const board = await this.prisma.board.findUniqueOrThrow({
      where: { id: boardId },
      include: {
        owner: { select: publicUserSelect },
        members: { include: { user: { select: publicUserSelect } }, orderBy: { createdAt: 'asc' } },
        shares: {
          include: { invitedBy: { select: publicUserSelect } },
          orderBy: { createdAt: 'asc' },
        },
        shareLinks: {
          where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          include: { createdBy: { select: publicUserSelect } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    const members: BoardMemberDto[] = [
      { user: toPublicUser(board.owner), role: 'OWNER', addedAt: iso(board.createdAt) },
      ...board.members
        .filter((m) => m.userId !== board.ownerId)
        .map((m) => ({ user: toPublicUser(m.user), role: m.role, addedAt: iso(m.createdAt) })),
    ];
    return {
      members,
      pending: board.shares.map((s) => ({
        id: s.id,
        email: s.email,
        role: s.role,
        invitedBy: toPublicUser(s.invitedBy),
        createdAt: iso(s.createdAt),
      })),
      workspaceAccess: board.workspaceAccess,
      links: board.shareLinks.flatMap((l) => {
        const dto = this.toLink(l);
        return dto ? [dto] : [];
      }),
    };
  }

  async get(principal: Principal, boardId: string): Promise<BoardSharingDto> {
    await this.access.requireBoard(boardId, principal, 'EDITOR');
    return this.sharing(boardId);
  }

  async share(
    principal: Principal,
    boardId: string,
    input: AddBoardShareRequest,
  ): Promise<BoardSharingDto> {
    const access = await this.access.requireBoard(boardId, principal, 'EDITOR');
    if (!access.userId) throw Errors.unauthorized('Sign in to share boards');
    const role = (input.role ?? 'EDITOR') as BoardRole;
    if (!boardRoleAtLeast(access.role, role))
      throw Errors.forbidden('You cannot grant a role higher than your own');
    const email = input.email.trim().toLowerCase();
    const board = access.board;
    const [inviter, target] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: access.userId },
        select: publicUserSelect,
      }),
      this.prisma.user.findUnique({ where: { email } }),
    ]);

    if (target && target.emailVerifiedAt) {
      if (target.id !== board.ownerId) {
        const existing = await this.prisma.boardMember.findUnique({
          where: { boardId_userId: { boardId, userId: target.id } },
        });
        if (!existing) {
          await this.prisma.boardMember.create({
            data: { boardId, userId: target.id, role, addedById: access.userId },
          });
        } else if (!boardRoleAtLeast(existing.role, role)) {
          await this.prisma.boardMember.update({
            where: { boardId_userId: { boardId, userId: target.id } },
            data: { role },
          });
        }
        await this.prisma.share.deleteMany({ where: { boardId, email } });
        const mail = this.onboarding.boardSharedMail({
          inviterName: inviter.name,
          boardTitle: board.title,
          boardId,
          role,
          message: input.message,
          existingUser: true,
          email,
        });
        await this.notifications.notify([
          {
            userId: target.id,
            type: 'BOARD_SHARED',
            actorId: access.userId,
            title: `${inviter.name} shared “${board.title}” with you`,
            body: input.message ?? `You can now ${role === 'VIEWER' ? 'view' : 'edit'} this board.`,
            link: `/b/${boardId}`,
            data: { boardId },
            email: mail,
          },
        ]);
        await this.realtime.emitEvent(boardId, { kind: 'permissions-changed' });
      }
    } else {
      await this.prisma.share.upsert({
        where: { boardId_email: { boardId, email } },
        create: {
          boardId,
          email,
          role,
          message: input.message ?? null,
          invitedById: access.userId,
        },
        update: { role, message: input.message ?? null, invitedById: access.userId },
      });
      const mail = this.onboarding.boardSharedMail({
        inviterName: inviter.name,
        boardTitle: board.title,
        boardId,
        role,
        message: input.message,
        existingUser: false,
        email,
      });
      await this.mail.send({ ...mail, to: email });
    }
    return this.sharing(boardId);
  }

  async updateMember(
    principal: Principal,
    boardId: string,
    userId: string,
    input: UpdateBoardMemberRequest,
  ): Promise<BoardSharingDto> {
    const access = await this.access.requireBoard(boardId, principal, 'OWNER');
    if (userId === access.board.ownerId)
      throw Errors.conflict("The board owner's role cannot be changed");
    const res = await this.prisma.boardMember.updateMany({
      where: { boardId, userId },
      data: { role: input.role },
    });
    if (res.count === 0) throw Errors.notFound('Member');
    await this.realtime.emitEvent(boardId, { kind: 'permissions-changed' });
    return this.sharing(boardId);
  }

  async removeMember(
    principal: Principal,
    boardId: string,
    userId: string,
  ): Promise<BoardSharingDto> {
    const self = principal.userId === userId;
    const access = await this.access.requireBoard(boardId, principal, self ? 'VIEWER' : 'OWNER');
    if (userId === access.board.ownerId) throw Errors.conflict('The board owner cannot be removed');
    const res = await this.prisma.boardMember.deleteMany({ where: { boardId, userId } });
    if (res.count === 0) throw Errors.notFound('Member');
    await this.realtime.emitEvent(boardId, { kind: 'permissions-changed' });
    const after = await this.access.getBoardAccess(boardId, principal);
    if (!after || !boardRoleAtLeast(after.role, 'EDITOR')) {
      return { members: [], pending: [], workspaceAccess: access.board.workspaceAccess, links: [] };
    }
    return this.sharing(boardId);
  }

  async revokeShare(
    principal: Principal,
    boardId: string,
    shareId: string,
  ): Promise<BoardSharingDto> {
    await this.access.requireBoard(boardId, principal, 'EDITOR');
    const res = await this.prisma.share.deleteMany({ where: { id: shareId, boardId } });
    if (res.count === 0) throw Errors.notFound('Share');
    return this.sharing(boardId);
  }

  async createLink(
    principal: Principal,
    boardId: string,
    input: CreateShareLinkRequest,
  ): Promise<ShareLinkDto> {
    const access = await this.access.requireBoard(boardId, principal, 'EDITOR');
    if (!access.userId) throw Errors.unauthorized('Sign in to create share links');
    const role = input.role ?? 'VIEWER';
    if (!boardRoleAtLeast(access.role, role))
      throw Errors.forbidden('You cannot grant a role higher than your own');
    const issued = this.cipher.issue();
    const link = await this.prisma.shareLink.create({
      data: {
        boardId,
        role,
        tokenHash: issued.tokenHash,
        tokenCiphertext: issued.ciphertext,
        createdById: access.userId,
        expiresAt: input.expiresInHours
          ? new Date(Date.now() + input.expiresInHours * 3_600_000)
          : null,
      },
      include: { createdBy: { select: publicUserSelect } },
    });
    return this.toLink(link)!;
  }

  async revokeLink(principal: Principal, boardId: string, linkId: string): Promise<void> {
    await this.access.requireBoard(boardId, principal, 'EDITOR');
    const res = await this.prisma.shareLink.updateMany({
      where: { id: linkId, boardId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw Errors.notFound('Share link');
    await this.realtime.emitEvent(boardId, { kind: 'permissions-changed' });
  }

  async resolve(token: string): Promise<ResolvedShareLinkDto> {
    const link = await this.access.resolveShareLink(token);
    if (!link) throw Errors.notFound('Share link');
    const board = await this.prisma.board.findUnique({
      where: { id: link.boardId },
      select: { title: true, deletedAt: true },
    });
    if (!board || board.deletedAt) throw Errors.notFound('Share link');
    return {
      boardId: link.boardId,
      boardTitle: board.title,
      role: link.role,
      expiresAt: iso(link.expiresAt),
    };
  }
}
