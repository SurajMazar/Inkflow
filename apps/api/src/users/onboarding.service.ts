import { Injectable, Logger } from '@nestjs/common';
import { boardRoleAtLeast } from '@inkflow/shared';
import { AppConfig } from '../config/app-config';
import { NotificationsService, type NotifyInput } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { boardSharedEmail, workspaceInviteEmail } from '../mail/templates';
import { createWorkspaceRecord, personalWorkspaceName } from '../workspaces/workspace-factory';
import { RealtimeService } from '../collaboration/realtime.service';

/** Account lifecycle side effects: personal workspace and conversion of pending invitations. */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
    private readonly realtime: RealtimeService,
  ) {}

  async createPersonalWorkspace(userId: string, userName: string): Promise<void> {
    await createWorkspaceRecord(this.prisma, userId, personalWorkspaceName(userName));
  }

  /**
   * Called once an email address is proven to belong to the user: pending board shares and
   * workspace invitations addressed to it become memberships (and notifications).
   */
  async claimPendingInvitations(userId: string, email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const notifications: NotifyInput[] = [];
    const changedBoards: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const shares = await tx.share.findMany({
        where: { email: normalized, board: { deletedAt: null } },
        include: { board: { select: { id: true, title: true, ownerId: true } }, invitedBy: { select: { name: true } } },
      });
      for (const share of shares) {
        if (share.board.ownerId !== userId) {
          const existing = await tx.boardMember.findUnique({
            where: { boardId_userId: { boardId: share.boardId, userId } },
          });
          if (!existing) {
            await tx.boardMember.create({
              data: { boardId: share.boardId, userId, role: share.role, addedById: share.invitedById },
            });
          } else if (!boardRoleAtLeast(existing.role, share.role)) {
            await tx.boardMember.update({
              where: { boardId_userId: { boardId: share.boardId, userId } },
              data: { role: share.role },
            });
          }
          changedBoards.push(share.boardId);
          const link = `/b/${share.boardId}`;
          notifications.push({
            userId,
            type: 'BOARD_SHARED',
            actorId: share.invitedById,
            title: `${share.invitedBy.name} shared “${share.board.title}” with you`,
            body: share.message ?? `You can now ${share.role === 'VIEWER' ? 'view' : 'edit'} this board.`,
            link,
            data: { boardId: share.boardId },
          });
        }
      }
      if (shares.length > 0) await tx.share.deleteMany({ where: { id: { in: shares.map((s) => s.id) } } });

      const invitations = await tx.workspaceInvitation.findMany({
        where: { email: normalized, expiresAt: { gt: new Date() } },
        include: { workspace: { select: { id: true, name: true } }, invitedBy: { select: { name: true } } },
      });
      for (const inv of invitations) {
        const existing = await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId } },
        });
        if (!existing) {
          await tx.workspaceMember.create({ data: { workspaceId: inv.workspaceId, userId, role: inv.role } });
          notifications.push({
            userId,
            type: 'WORKSPACE_INVITE',
            actorId: inv.invitedById,
            title: `${inv.invitedBy.name} added you to ${inv.workspace.name}`,
            body: `You are now a member of the workspace “${inv.workspace.name}”.`,
            link: `/w/${inv.workspaceId}`,
            data: { workspaceId: inv.workspaceId },
          });
        }
      }
      if (invitations.length > 0) {
        await tx.workspaceInvitation.deleteMany({ where: { id: { in: invitations.map((i) => i.id) } } });
      }
    });
    if (notifications.length > 0) {
      await this.notifications.notify(notifications).catch((err: Error) => this.logger.warn(err.message));
    }
    for (const boardId of changedBoards) void this.realtime.emitEvent(boardId, { kind: 'permissions-changed' });
  }

  /** Emails for a board shared with an address (existing verified account or not). */
  boardSharedMail(input: { inviterName: string; boardTitle: string; boardId: string; role: string; message?: string | null; existingUser: boolean; email: string }) {
    const url = input.existingUser
      ? this.config.webLink(`/b/${input.boardId}`)
      : this.config.webLink(`/register?email=${encodeURIComponent(input.email)}&next=${encodeURIComponent(`/b/${input.boardId}`)}`);
    return { ...boardSharedEmail({ ...input, url }), link: url };
  }

  workspaceInviteMail(input: { inviterName: string; workspaceName: string; url: string; existingUser: boolean }) {
    return { ...workspaceInviteEmail(input), link: input.url };
  }
}
