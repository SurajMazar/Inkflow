import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { SessionDto } from '@inkflow/shared';
import { AppConfig } from '../config/app-config';
import { randomToken, safeEqual, sha256Hex } from '../common/crypto';
import type { ClientMeta } from '../common/request';
import { iso } from '../common/mappers';
import { PrismaService } from '../prisma/prisma.service';
import { TokensService } from './tokens.service';

export interface IssuedSession {
  userId: string;
  familyId: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: Date;
}

export type RotationResult =
  | { status: 'rotated'; session: IssuedSession }
  /** Unknown, expired or revoked token. */
  | { status: 'invalid' }
  /** A token that was already rotated was presented again: the family has been revoked. */
  | { status: 'reused' }
  /** The token was rotated moments ago by a concurrent request (another tab); nothing was revoked. */
  | { status: 'race' };

/**
 * A rotated token presented again within this window is treated as a benign race between tabs
 * (both refreshed concurrently) rather than theft: the request fails without revoking the family.
 */
export const ROTATION_GRACE_MS = 10_000;

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  /** Overridable (tests); see `ROTATION_GRACE_MS`. */
  rotationGraceMs = ROTATION_GRACE_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly config: AppConfig,
  ) {}

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  }

  /** Starts a new session family for a user. */
  async create(userId: string, meta: ClientMeta): Promise<IssuedSession> {
    const refreshToken = randomToken(32);
    const familyId = randomUUID();
    const expiresAt = this.refreshExpiry();
    await this.prisma.session.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256Hex(refreshToken),
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt,
      },
    });
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    return {
      userId,
      familyId,
      refreshToken,
      expiresAt,
      accessToken: this.tokens.signAccessToken(userId, familyId),
    };
  }

  /** Exchanges a refresh token for a new one (rotation with reuse detection). */
  async rotate(refreshToken: string, meta: ClientMeta): Promise<RotationResult> {
    if (!refreshToken || refreshToken.length > 256) return { status: 'invalid' };
    const tokenHash = sha256Hex(refreshToken);
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM sessions WHERE token_hash = ${tokenHash} FOR UPDATE`;
      if (rows.length === 0) return { status: 'invalid' as const };
      const current = await tx.session.findUniqueOrThrow({ where: { id: rows[0]!.id } });
      if (!safeEqual(current.tokenHash, tokenHash)) return { status: 'invalid' as const };
      if (current.revokedAt || current.expiresAt <= now) return { status: 'invalid' as const };
      if (current.rotatedAt) {
        if (now.getTime() - current.rotatedAt.getTime() <= this.rotationGraceMs)
          return { status: 'race' as const };
        await tx.session.updateMany({
          where: { familyId: current.familyId, revokedAt: null },
          data: { revokedAt: now, revokedReason: 'refresh-token-reuse' },
        });
        return { status: 'reused' as const, familyId: current.familyId, userId: current.userId };
      }
      const nextToken = randomToken(32);
      const expiresAt = this.refreshExpiry();
      await tx.session.update({
        where: { id: current.id },
        data: { rotatedAt: now, lastUsedAt: now },
      });
      await tx.session.create({
        data: {
          userId: current.userId,
          familyId: current.familyId,
          tokenHash: sha256Hex(nextToken),
          startedAt: current.startedAt,
          userAgent: meta.userAgent ?? current.userAgent,
          ip: meta.ip ?? current.ip,
          lastUsedAt: now,
          expiresAt,
        },
      });
      return {
        status: 'rotated' as const,
        session: {
          userId: current.userId,
          familyId: current.familyId,
          refreshToken: nextToken,
          expiresAt,
          accessToken: this.tokens.signAccessToken(current.userId, current.familyId),
        },
      };
    });
    if (result.status === 'reused') {
      this.logger.warn(
        `Refresh token reuse detected for user ${result.userId}; session family revoked`,
      );
      await this.tokens.markSessionsRevoked([result.familyId]);
      return { status: 'reused' };
    }
    return result;
  }

  /** Finds the family of a (possibly already rotated) refresh token. */
  async familyOfToken(refreshToken: string): Promise<{ familyId: string; userId: string } | null> {
    if (!refreshToken || refreshToken.length > 256) return null;
    const row = await this.prisma.session.findUnique({
      where: { tokenHash: sha256Hex(refreshToken) },
      select: { familyId: true, userId: true },
    });
    return row;
  }

  async revokeFamily(familyId: string, reason: string, userId?: string): Promise<boolean> {
    const res = await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null, ...(userId ? { userId } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    if (res.count > 0) await this.tokens.markSessionsRevoked([familyId]);
    return res.count > 0;
  }

  /** Revokes every session of a user, optionally keeping one family (the caller's). */
  async revokeAllForUser(userId: string, reason: string, exceptFamilyId?: string): Promise<void> {
    const families = await this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptFamilyId ? { familyId: { not: exceptFamilyId } } : {}),
      },
      select: { familyId: true },
      distinct: ['familyId'],
    });
    if (families.length === 0) return;
    const ids = families.map((f) => f.familyId);
    await this.prisma.session.updateMany({
      where: { userId, familyId: { in: ids }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    await this.tokens.markSessionsRevoked(ids);
  }

  /** Active sessions (one per family: its current, un-rotated token). */
  async list(userId: string, currentFamilyId: string | null): Promise<SessionDto[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, rotatedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.familyId,
      userAgent: row.userAgent,
      ip: row.ip,
      createdAt: iso(row.startedAt),
      lastUsedAt: iso(row.lastUsedAt),
      expiresAt: iso(row.expiresAt),
      current: row.familyId === currentFamilyId,
    }));
  }

  /** Whether a session family is still active (used by long-lived WebSocket connections). */
  async isFamilyActive(familyId: string): Promise<boolean> {
    const row = await this.prisma.session.findFirst({
      where: { familyId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return row !== null;
  }
}
