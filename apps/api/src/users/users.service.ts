import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '@inkflow/database';
import {
  DEFAULT_USER_PREFERENCES,
  type OAuthProvider,
  type PublicUserDto,
  type UpdateMeRequest,
  type UserDto,
  type UserPreferences,
} from '@inkflow/shared';
import { Errors } from '../common/errors';
import { iso, publicUserSelect, toPublicUser } from '../common/mappers';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';

type UserWithProviders = User & { oauthAccounts: { provider: OAuthProvider }[] };

/** Merges stored (partial, possibly outdated) preferences over the defaults. */
export function resolvePreferences(stored: unknown): UserPreferences {
  const raw =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const out: Record<string, unknown> = { ...DEFAULT_USER_PREFERENCES };
  for (const [key, def] of Object.entries(DEFAULT_USER_PREFERENCES)) {
    const value = raw[key];
    if (value === undefined) continue;
    if (def && typeof def === 'object' && !Array.isArray(def)) {
      if (value && typeof value === 'object' && !Array.isArray(value))
        out[key] = { ...def, ...(value as object) };
    } else if (typeof value === typeof def) {
      out[key] = value;
    }
  }
  return out as unknown as UserPreferences;
}

export function toUserDto(user: UserWithProviders): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    emailVerified: user.emailVerifiedAt !== null,
    hasPassword: user.passwordHash !== null,
    oauthProviders: [...new Set(user.oauthAccounts.map((a) => a.provider))],
    preferences: resolvePreferences(user.preferences),
    createdAt: iso(user.createdAt),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async getDto(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { oauthAccounts: { select: { provider: true } } },
    });
    if (!user) throw Errors.unauthorized();
    return toUserDto(user);
  }

  async updateMe(userId: string, input: UpdateMeRequest): Promise<UserDto> {
    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;
    if (input.preferences !== undefined) {
      const current = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { preferences: true },
      });
      const stored =
        current.preferences && typeof current.preferences === 'object'
          ? (current.preferences as Record<string, unknown>)
          : {};
      data.preferences = { ...stored, ...input.preferences } as Prisma.InputJsonValue;
    }
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.getDto(userId);
  }

  /**
   * Users that share the given workspace or board with the requester (for @mentions and invites).
   * Without a scope, users sharing any workspace with the requester.
   */
  async search(
    requesterId: string,
    query: { q?: string; workspaceId?: string; boardId?: string },
  ): Promise<PublicUserDto[]> {
    const q = query.q?.trim().slice(0, 100) ?? '';
    const textFilter: Prisma.UserWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q.toLowerCase() } },
          ],
        }
      : {};
    let scope: Prisma.UserWhereInput;
    if (query.boardId) {
      const access = await this.access.getBoardAccess(query.boardId, {
        userId: requesterId,
        shareToken: null,
      });
      if (!access) throw Errors.notFound('Board');
      const board = access.board;
      scope = {
        OR: [
          { id: board.ownerId },
          { boardMemberships: { some: { boardId: board.id } } },
          {
            workspaceMemberships: {
              some: {
                workspaceId: board.workspaceId,
                ...(board.workspaceAccess === 'NONE' ? { role: { in: ['OWNER', 'ADMIN'] } } : {}),
              },
            },
          },
        ],
      };
    } else if (query.workspaceId) {
      const membership = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: query.workspaceId, userId: requesterId } },
      });
      if (!membership) throw Errors.notFound('Workspace');
      scope = { workspaceMemberships: { some: { workspaceId: query.workspaceId } } };
    } else {
      scope = {
        workspaceMemberships: {
          some: { workspace: { members: { some: { userId: requesterId } } } },
        },
      };
    }
    const users = await this.prisma.user.findMany({
      where: { AND: [scope, textFilter] },
      select: publicUserSelect,
      orderBy: { name: 'asc' },
      take: 20,
    });
    return users.map(toPublicUser);
  }
}
