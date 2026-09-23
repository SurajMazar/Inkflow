import { Injectable } from '@nestjs/common';
import type { Workspace, WorkspaceRole } from '@inkflow/database';
import {
  workspaceRoleAtLeast,
  type CreateWorkspaceRequest,
  type InvitationPreviewDto,
  type InviteMemberRequest,
  type InviteMemberResponse,
  type UpdateMemberRoleRequest,
  type UpdateWorkspaceRequest,
  type WorkspaceDto,
  type WorkspaceInvitationDto,
  type WorkspaceMemberDto,
} from '@inkflow/shared';
import { AccessService } from '../access/access.service';
import { AppConfig } from '../config/app-config';
import { randomToken, safeEqual, sha256Hex } from '../common/crypto';
import { Errors } from '../common/errors';
import { iso, publicUserSelect, toPublicUser, type PublicUserRow } from '../common/mappers';
import { PurgeService } from '../files/purge.service';
import { MailService } from '../mail/mail.service';
import { workspaceInviteEmail } from '../mail/templates';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../collaboration/realtime.service';
import { OnboardingService } from '../users/onboarding.service';
import { createWorkspaceRecord } from './workspace-factory';

export const INVITATION_TTL_MS = 7 * 86_400_000;

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly config: AppConfig,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly purge: PurgeService,
    private readonly realtime: RealtimeService,
    private readonly onboarding: OnboardingService,
  ) {}

  private async toDtos(
    workspaces: (Workspace & { members: { role: WorkspaceRole }[] })[],
  ): Promise<WorkspaceDto[]> {
    if (workspaces.length === 0) return [];
    const ids = workspaces.map((w) => w.id);
    const [memberCounts, boardCounts] = await Promise.all([
      this.prisma.workspaceMember.groupBy({
        by: ['workspaceId'],
        where: { workspaceId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.board.groupBy({
        by: ['workspaceId'],
        where: { workspaceId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const members = new Map(memberCounts.map((m) => [m.workspaceId, m._count._all]));
    const boards = new Map(boardCounts.map((b) => [b.workspaceId, b._count._all]));
    return workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      role: w.members[0]?.role ?? 'MEMBER',
      memberCount: members.get(w.id) ?? 0,
      boardCount: boards.get(w.id) ?? 0,
      createdAt: iso(w.createdAt),
      updatedAt: iso(w.updatedAt),
    }));
  }

  async list(userId: string): Promise<WorkspaceDto[]> {
    const workspaces = await this.prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      include: { members: { where: { userId }, select: { role: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return this.toDtos(workspaces);
  }

  async get(userId: string, workspaceId: string): Promise<WorkspaceDto> {
    await this.access.requireWorkspace(workspaceId, userId);
    const ws = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      include: { members: { where: { userId }, select: { role: true } } },
    });
    return (await this.toDtos([ws]))[0]!;
  }

  async create(userId: string, input: CreateWorkspaceRequest): Promise<WorkspaceDto> {
    const ws = await createWorkspaceRecord(this.prisma, userId, input.name.trim());
    return this.get(userId, ws.id);
  }

  async update(
    userId: string,
    workspaceId: string,
    input: UpdateWorkspaceRequest,
  ): Promise<WorkspaceDto> {
    await this.access.requireWorkspace(workspaceId, userId, 'ADMIN');
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: input.name.trim() },
    });
    return this.get(userId, workspaceId);
  }

  async remove(userId: string, workspaceId: string): Promise<void> {
    await this.access.requireWorkspace(workspaceId, userId, 'OWNER');
    await this.purge.purgeWorkspace(workspaceId);
  }

  // ───────────── members ─────────────

  private toMember(m: {
    role: WorkspaceRole;
    createdAt: Date;
    user: PublicUserRow;
  }): WorkspaceMemberDto {
    return { user: toPublicUser(m.user), role: m.role, joinedAt: iso(m.createdAt) };
  }

  async members(userId: string, workspaceId: string): Promise<WorkspaceMemberDto[]> {
    await this.access.requireWorkspace(workspaceId, userId);
    const rows = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: publicUserSelect } },
      orderBy: [{ createdAt: 'asc' }],
    });
    return rows.map((m) => this.toMember(m));
  }

  private async ownerCount(workspaceId: string): Promise<number> {
    return this.prisma.workspaceMember.count({ where: { workspaceId, role: 'OWNER' } });
  }

  async updateMemberRole(
    userId: string,
    workspaceId: string,
    targetUserId: string,
    input: UpdateMemberRoleRequest,
  ): Promise<WorkspaceMemberDto> {
    const myRole = await this.access.requireWorkspace(workspaceId, userId, 'ADMIN');
    const target = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) throw Errors.notFound('Member');
    if ((input.role === 'OWNER' || target.role === 'OWNER') && myRole !== 'OWNER') {
      throw Errors.forbidden('Only workspace owners can grant or change the owner role');
    }
    if (
      target.role === 'OWNER' &&
      input.role !== 'OWNER' &&
      (await this.ownerCount(workspaceId)) <= 1
    ) {
      throw Errors.conflict('A workspace must keep at least one owner');
    }
    const updated = await this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      data: { role: input.role },
      include: { user: { select: publicUserSelect } },
    });
    await this.announcePermissionChange(workspaceId);
    return this.toMember(updated);
  }

  async removeMember(userId: string, workspaceId: string, targetUserId: string): Promise<void> {
    const myRole = await this.access.requireWorkspace(workspaceId, userId);
    const self = userId === targetUserId;
    if (!self && !workspaceRoleAtLeast(myRole, 'ADMIN')) throw Errors.forbidden();
    const target = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) throw Errors.notFound('Member');
    if (target.role === 'OWNER') {
      if (!self && myRole !== 'OWNER') throw Errors.forbidden('Only owners can remove an owner');
      if ((await this.ownerCount(workspaceId)) <= 1)
        throw Errors.conflict('The last owner cannot leave the workspace');
    }
    await this.prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    await this.announcePermissionChange(workspaceId);
  }

  /** Workspace role changes alter effective board roles: tell every board's sockets to re-check. */
  private async announcePermissionChange(workspaceId: string): Promise<void> {
    const boards = await this.prisma.board.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true },
    });
    const active = await this.realtime.activeBoards(boards.map((b) => b.id));
    await Promise.all(
      active.map((id) => this.realtime.emitEvent(id, { kind: 'permissions-changed' })),
    );
  }

  // ───────────── invitations ─────────────

  private toInvitation(inv: {
    id: string;
    workspaceId: string;
    email: string;
    role: WorkspaceRole;
    expiresAt: Date;
    createdAt: Date;
    invitedBy: PublicUserRow;
  }): WorkspaceInvitationDto {
    return {
      id: inv.id,
      workspaceId: inv.workspaceId,
      email: inv.email,
      role: inv.role,
      invitedBy: toPublicUser(inv.invitedBy),
      expiresAt: iso(inv.expiresAt),
      createdAt: iso(inv.createdAt),
    };
  }

  async invitations(userId: string, workspaceId: string): Promise<WorkspaceInvitationDto[]> {
    await this.access.requireWorkspace(workspaceId, userId, 'ADMIN');
    const rows = await this.prisma.workspaceInvitation.findMany({
      where: { workspaceId },
      include: { invitedBy: { select: publicUserSelect } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toInvitation(r));
  }

  async invite(
    userId: string,
    workspaceId: string,
    input: InviteMemberRequest,
  ): Promise<InviteMemberResponse> {
    await this.access.requireWorkspace(workspaceId, userId, 'ADMIN');
    const email = input.email.trim().toLowerCase();
    const role = (input.role ?? 'MEMBER') as WorkspaceRole;
    const [workspace, inviter, existingUser] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: publicUserSelect }),
      this.prisma.user.findUnique({ where: { email } }),
    ]);

    if (existingUser && existingUser.emailVerifiedAt) {
      const already = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: existingUser.id } },
      });
      if (already) throw Errors.conflict('This user is already a member of the workspace');
      const member = await this.prisma.workspaceMember.create({
        data: { workspaceId, userId: existingUser.id, role },
        include: { user: { select: publicUserSelect } },
      });
      await this.prisma.workspaceInvitation.deleteMany({ where: { workspaceId, email } });
      const url = this.config.webLink(`/w/${workspaceId}`);
      await this.notifications.notify([
        {
          userId: existingUser.id,
          type: 'WORKSPACE_INVITE',
          actorId: userId,
          title: `${inviter.name} added you to ${workspace.name}`,
          body: `You are now a member of the workspace “${workspace.name}”.`,
          link: `/w/${workspaceId}`,
          data: { workspaceId },
          email: {
            ...workspaceInviteEmail({
              inviterName: inviter.name,
              workspaceName: workspace.name,
              url,
              existingUser: true,
            }),
            link: url,
          },
        },
      ]);
      return { status: 'added', member: this.toMember(member) };
    }

    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const invitation = await this.prisma.workspaceInvitation.upsert({
      where: { workspaceId_email: { workspaceId, email } },
      create: {
        workspaceId,
        email,
        role,
        tokenHash: sha256Hex(token),
        invitedById: userId,
        expiresAt,
      },
      update: { role, tokenHash: sha256Hex(token), invitedById: userId, expiresAt },
      include: { invitedBy: { select: publicUserSelect } },
    });
    const url = this.config.webLink(`/invite/${token}`);
    await this.mail.send({
      ...workspaceInviteEmail({
        inviterName: inviter.name,
        workspaceName: workspace.name,
        url,
        existingUser: false,
      }),
      to: email,
      link: url,
    });
    return { status: 'invited', invitation: this.toInvitation(invitation) };
  }

  async revokeInvitation(userId: string, workspaceId: string, invitationId: string): Promise<void> {
    await this.access.requireWorkspace(workspaceId, userId, 'ADMIN');
    const res = await this.prisma.workspaceInvitation.deleteMany({
      where: { id: invitationId, workspaceId },
    });
    if (res.count === 0) throw Errors.notFound('Invitation');
  }

  private async findInvitation(token: string) {
    if (!token || token.length < 16 || token.length > 256) throw Errors.notFound('Invitation');
    const tokenHash = sha256Hex(token);
    const inv = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash },
      include: {
        workspace: { select: { id: true, name: true } },
        invitedBy: { select: { name: true } },
      },
    });
    if (!inv || !safeEqual(inv.tokenHash, tokenHash)) throw Errors.notFound('Invitation');
    if (inv.expiresAt <= new Date()) throw Errors.tokenExpired('This invitation has expired');
    return inv;
  }

  async preview(token: string): Promise<InvitationPreviewDto> {
    const inv = await this.findInvitation(token);
    return {
      workspaceName: inv.workspace.name,
      invitedBy: inv.invitedBy.name,
      email: inv.email,
      role: inv.role,
      expiresAt: iso(inv.expiresAt),
    };
  }

  async accept(userId: string, token: string): Promise<WorkspaceDto> {
    const inv = await this.findInvitation(token);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email !== inv.email)
      throw Errors.forbidden('This invitation was sent to a different email address');
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId } },
      });
      if (!existing)
        await tx.workspaceMember.create({
          data: { workspaceId: inv.workspaceId, userId, role: inv.role },
        });
      await tx.workspaceInvitation.delete({ where: { id: inv.id } });
    });
    if (!user.emailVerifiedAt) {
      // Opening the emailed link proves ownership of the address.
      await this.prisma.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date() },
      });
      await this.onboarding.claimPendingInvitations(userId, user.email);
    }
    return this.get(userId, inv.workspaceId);
  }
}
