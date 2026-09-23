import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@inkflow/database';
import type {
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  UserDto,
} from '@inkflow/shared';
import { AppConfig } from '../config/app-config';
import { randomToken, safeEqual, sha256Hex } from '../common/crypto';
import { Errors } from '../common/errors';
import type { ClientMeta } from '../common/request';
import { MailService } from '../mail/mail.service';
import { passwordResetEmail, verificationEmail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { OnboardingService } from '../users/onboarding.service';
import { UsersService } from '../users/users.service';
import { hashPassword, verifyDummyPassword, verifyPassword } from './passwords';
import { SessionsService, type IssuedSession } from './sessions.service';

export const VERIFICATION_TTL_MS = 24 * 3_600_000;
export const RESET_TTL_MS = 3_600_000;

export interface AuthResult {
  user: UserDto;
  session: IssuedSession | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
    private readonly onboarding: OnboardingService,
    private readonly mail: MailService,
  ) {}

  async register(input: RegisterRequest, meta: ClientMeta): Promise<{ result: AuthResult; requiresVerification: boolean }> {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await hashPassword(input.password);
    let userId: string;
    try {
      const user = await this.prisma.user.create({ data: { email, name: input.name.trim(), passwordHash } });
      userId = user.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('An account with this email address already exists');
      }
      throw err;
    }
    await this.onboarding.createPersonalWorkspace(userId, input.name);
    await this.sendVerification(userId, email, input.name.trim());
    const requiresVerification = this.config.env.REQUIRE_EMAIL_VERIFICATION;
    const session = requiresVerification ? null : await this.sessions.create(userId, meta);
    return { result: { user: await this.users.getDto(userId), session }, requiresVerification };
  }

  private async sendVerification(userId: string, email: string, name: string): Promise<void> {
    const token = randomToken(32);
    await this.prisma.emailVerification.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.prisma.emailVerification.create({
      data: { userId, email, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS) },
    });
    const url = this.config.webLink(`/verify-email?token=${encodeURIComponent(token)}`);
    await this.mail.send({ ...verificationEmail({ name, url }), to: email, link: url });
  }

  async verifyEmail(token: string, meta: ClientMeta): Promise<AuthResult> {
    const tokenHash = sha256Hex(token);
    const record = await this.prisma.emailVerification.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!record || !safeEqual(record.tokenHash, tokenHash) || record.usedAt) throw Errors.tokenInvalid();
    if (record.expiresAt <= new Date()) throw Errors.tokenExpired('This verification link has expired; request a new one');
    if (record.email !== record.user.email) throw Errors.tokenInvalid();
    const claimed = await this.prisma.emailVerification.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) throw Errors.tokenInvalid();
    if (!record.user.emailVerifiedAt) {
      await this.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
      await this.onboarding.claimPendingInvitations(record.userId, record.user.email);
    }
    const session = await this.sessions.create(record.userId, meta);
    return { user: await this.users.getDto(record.userId), session };
  }

  async resendVerification(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt) return;
    await this.sendVerification(user.id, user.email, user.name);
  }

  async login(input: LoginRequest, meta: ClientMeta): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = user?.passwordHash
      ? await verifyPassword(user.passwordHash, input.password)
      : await verifyDummyPassword(input.password);
    if (!user || !ok) throw Errors.invalidCredentials();
    if (this.config.env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerifiedAt) throw Errors.emailNotVerified();
    const session = await this.sessions.create(user.id, meta);
    return { user: await this.users.getDto(user.id), session };
  }

  async forgotPassword(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;
    const token = randomToken(32);
    await this.prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await this.prisma.passwordReset.create({
      data: { userId: user.id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });
    const url = this.config.webLink(`/reset-password?token=${encodeURIComponent(token)}`);
    await this.mail.send({ ...passwordResetEmail({ name: user.name, url }), to: user.email, link: url });
  }

  async resetPassword(input: ResetPasswordRequest): Promise<void> {
    const tokenHash = sha256Hex(input.token);
    const record = await this.prisma.passwordReset.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!record || !safeEqual(record.tokenHash, tokenHash) || record.usedAt) throw Errors.tokenInvalid();
    if (record.expiresAt <= new Date()) throw Errors.tokenExpired('This password reset link has expired');
    const passwordHash = await hashPassword(input.password);
    const wasVerified = record.user.emailVerifiedAt !== null;
    const claimed = await this.prisma.$transaction(async (tx) => {
      const res = await tx.passwordReset.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
      if (res.count === 0) return false;
      await tx.passwordReset.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: new Date() } });
      await tx.user.update({
        where: { id: record.userId },
        // Receiving the reset email proves ownership of the address.
        data: { passwordHash, ...(wasVerified ? {} : { emailVerifiedAt: new Date() }) },
      });
      return true;
    });
    if (!claimed) throw Errors.tokenInvalid();
    await this.sessions.revokeAllForUser(record.userId, 'password-reset');
    if (!wasVerified) await this.onboarding.claimPendingInvitations(record.userId, record.user.email);
  }

  async changePassword(userId: string, sessionId: string, input: ChangePasswordRequest): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.unauthorized();
    if (!user.passwordHash) {
      throw Errors.validation('This account has no password yet; use “Forgot password” to set one');
    }
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw Errors.validation('Current password is incorrect', [
        { path: ['currentPassword'], message: 'Current password is incorrect', code: 'custom' },
      ]);
    }
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(input.newPassword) } });
    await this.sessions.revokeAllForUser(userId, 'password-changed', sessionId);
    this.logger.log(`Password changed for user ${userId}`);
  }
}
