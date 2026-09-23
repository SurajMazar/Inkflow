import { Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  changePasswordSchema,
  emailOnlySchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
  isUuid,
  type AuthProvidersResponse,
  type AuthResponse,
  type ChangePasswordRequest,
  type CsrfResponse,
  type EmailOnlyRequest,
  type LoginRequest,
  type OkResponse,
  type RegisterRequest,
  type RegisterResponse,
  type ResetPasswordRequest,
  type SessionDto,
  type TokenRequest,
} from '@inkflow/shared';
import { AppConfig } from '../config/app-config';
import {
  ACCESS_COOKIE,
  clearCookieOptions,
  cookieOptions,
  CSRF_COOKIE,
  OAUTH_STATE_COOKIE,
  REFRESH_COOKIE,
} from '../common/cookies';
import { Errors } from '../common/errors';
import { AuthRateLimit } from '../common/rate-limit';
import {
  CurrentUser,
  Meta,
  OptionalUser,
  Public,
  type AuthInfo,
  type ClientMeta,
} from '../common/request';
import { safeNextPath } from '../common/mappers';
import { ApiZodBody, ZBody } from '../common/validation';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { isOAuthProvider, OAuthService } from './oauth.service';
import { SessionsService, type IssuedSession } from './sessions.service';
import { TokensService } from './tokens.service';

type CookieRequest = Request & { cookies?: Record<string, string> };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly tokens: TokensService,
    private readonly oauth: OAuthService,
    private readonly users: UsersService,
    private readonly config: AppConfig,
  ) {}

  // ───────────── cookie helpers ─────────────

  private issueCsrf(res: Response): string {
    const token = this.tokens.createCsrfToken();
    res.cookie(CSRF_COOKIE, token, cookieOptions(this.config.env, 'csrf'));
    return token;
  }

  private setSessionCookies(res: Response, session: IssuedSession): void {
    res.cookie(ACCESS_COOKIE, session.accessToken, cookieOptions(this.config.env, 'access'));
    res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(this.config.env, 'refresh'));
    this.issueCsrf(res);
  }

  private clearSessionCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, clearCookieOptions(this.config.env, 'access'));
    res.clearCookie(REFRESH_COOKIE, clearCookieOptions(this.config.env, 'refresh'));
  }

  // ───────────── routes ─────────────

  @Public()
  @Get('csrf')
  @ApiOperation({ summary: 'Issue a CSRF token (sets the readable inkflow_csrf cookie)' })
  csrf(@Req() req: CookieRequest, @Res({ passthrough: true }) res: Response): CsrfResponse {
    const existing = req.cookies?.[CSRF_COOKIE];
    if (existing && this.tokens.isValidCsrfToken(existing)) {
      // Keep the current token (other tabs may hold it) but refresh its lifetime.
      res.cookie(CSRF_COOKIE, existing, cookieOptions(this.config.env, 'csrf'));
      return { csrfToken: existing };
    }
    return { csrfToken: this.issueCsrf(res) };
  }

  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'Available sign-in methods' })
  providers(): AuthProvidersResponse {
    return {
      password: true,
      google: this.oauth.isConfigured('google'),
      github: this.oauth.isConfigured('github'),
    };
  }

  @Public()
  @AuthRateLimit({ perEmail: true })
  @Post('register')
  @ApiZodBody(registerSchema)
  @ApiOperation({ summary: 'Create an account (sends a verification email)' })
  async register(
    @ZBody(registerSchema) body: RegisterRequest,
    @Meta() meta: ClientMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RegisterResponse> {
    const { result, requiresVerification } = await this.auth.register(body, meta);
    if (result.session) this.setSessionCookies(res, result.session);
    else this.issueCsrf(res);
    return { user: result.user, requiresVerification };
  }

  @Public()
  @AuthRateLimit()
  @Post('verify-email')
  @HttpCode(200)
  @ApiZodBody(tokenSchema)
  @ApiOperation({ summary: 'Verify an email address with the emailed token and sign in' })
  async verifyEmail(
    @ZBody(tokenSchema) body: TokenRequest,
    @Meta() meta: ClientMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.verifyEmail(body.token, meta);
    if (result.session) this.setSessionCookies(res, result.session);
    return { user: result.user };
  }

  @Public()
  @AuthRateLimit({ perEmail: true })
  @Post('resend-verification')
  @HttpCode(200)
  @ApiZodBody(emailOnlySchema)
  @ApiOperation({ summary: 'Resend the verification email (always succeeds)' })
  async resendVerification(@ZBody(emailOnlySchema) body: EmailOnlyRequest): Promise<OkResponse> {
    await this.auth.resendVerification(body.email);
    return { ok: true };
  }

  @Public()
  @AuthRateLimit({ perEmail: true })
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(
    @ZBody(loginSchema) body: LoginRequest,
    @Meta() meta: ClientMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.login(body, meta);
    if (result.session) this.setSessionCookies(res, result.session);
    return { user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token and issue a new access token' })
  async refresh(
    @Req() req: CookieRequest,
    @Meta() meta: ClientMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw Errors.sessionExpired('No active session');
    const result = await this.sessions.rotate(token, meta);
    if (result.status === 'race') {
      // A concurrent refresh (another tab) already rotated this token; its cookies are current.
      throw Errors.sessionExpired('Session was refreshed concurrently; retry the request');
    }
    if (result.status !== 'rotated') {
      this.clearSessionCookies(res);
      throw Errors.sessionExpired();
    }
    this.setSessionCookies(res, result.session);
    return { user: await this.users.getDto(result.session.userId) };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke the current session and clear cookies' })
  async logout(
    @Req() req: CookieRequest,
    @OptionalUser() user: AuthInfo | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OkResponse> {
    const token = req.cookies?.[REFRESH_COOKIE];
    const family = token ? await this.sessions.familyOfToken(token) : null;
    if (family) await this.sessions.revokeFamily(family.familyId, 'logout');
    else if (user) await this.sessions.revokeFamily(user.sessionId, 'logout', user.userId);
    this.clearSessionCookies(res);
    return { ok: true };
  }

  @Public()
  @AuthRateLimit({ perEmail: true })
  @Post('forgot-password')
  @HttpCode(200)
  @ApiZodBody(emailOnlySchema)
  @ApiOperation({ summary: 'Email a password reset link (always succeeds)' })
  async forgotPassword(@ZBody(emailOnlySchema) body: EmailOnlyRequest): Promise<OkResponse> {
    await this.auth.forgotPassword(body.email);
    return { ok: true };
  }

  @Public()
  @AuthRateLimit()
  @Post('reset-password')
  @HttpCode(200)
  @ApiZodBody(resetPasswordSchema)
  @ApiOperation({ summary: 'Set a new password with a reset token (revokes all sessions)' })
  async resetPassword(@ZBody(resetPasswordSchema) body: ResetPasswordRequest): Promise<OkResponse> {
    await this.auth.resetPassword(body);
    return { ok: true };
  }

  @AuthRateLimit()
  @Post('change-password')
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiZodBody(changePasswordSchema)
  @ApiOperation({ summary: 'Change the password (revokes other sessions)' })
  async changePassword(
    @CurrentUser() user: AuthInfo,
    @ZBody(changePasswordSchema) body: ChangePasswordRequest,
  ): Promise<OkResponse> {
    await this.auth.changePassword(user.userId, user.sessionId, body);
    return { ok: true };
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'The signed-in user' })
  async me(@CurrentUser() user: AuthInfo): Promise<AuthResponse> {
    return { user: await this.users.getDto(user.userId) };
  }

  @Get('sessions')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Active sessions of the signed-in user' })
  listSessions(@CurrentUser() user: AuthInfo): Promise<SessionDto[]> {
    return this.sessions.list(user.userId, user.sessionId);
  }

  @Delete('sessions/:id')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Revoke a session' })
  async revokeSession(@CurrentUser() user: AuthInfo, @Param('id') id: string): Promise<OkResponse> {
    const revoked = isUuid(id)
      ? await this.sessions.revokeFamily(id, 'user-revoked', user.userId)
      : false;
    if (!revoked) throw Errors.notFound('Session');
    return { ok: true };
  }

  // ───────────── OAuth ─────────────

  @Public()
  @Get('oauth/:provider')
  @ApiOperation({ summary: 'Start OAuth sign-in (302 to the provider)' })
  oauthStart(
    @Param('provider') provider: string,
    @Query('next') next: unknown,
    @Res() res: Response,
  ): void {
    if (!isOAuthProvider(provider) || !this.oauth.isConfigured(provider))
      throw Errors.notFound('OAuth provider');
    const { url, cookie } = this.oauth.begin(provider, next);
    res.cookie(OAUTH_STATE_COOKIE, cookie, cookieOptions(this.config.env, 'oauth'));
    res.redirect(302, url);
  }

  @Public()
  @Get('oauth/:provider/callback')
  @ApiOperation({ summary: 'OAuth callback (302 to the web app)' })
  async oauthCallback(
    @Param('provider') provider: string,
    @Query() query: Record<string, unknown>,
    @Req() req: CookieRequest,
    @Meta() meta: ClientMeta,
    @Res() res: Response,
  ): Promise<void> {
    if (!isOAuthProvider(provider) || !this.oauth.isConfigured(provider))
      throw Errors.notFound('OAuth provider');
    const cookie = req.cookies?.[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE, clearCookieOptions(this.config.env, 'oauth'));
    const redirect = (params: Record<string, string>) =>
      res.redirect(
        302,
        `${this.config.webLink('/auth/callback')}?${new URLSearchParams(params).toString()}`,
      );
    let next = '/';
    try {
      const state = this.oauth.verifyState(provider, cookie, query.state);
      next = safeNextPath(state.next);
      if (typeof query.error === 'string') {
        redirect({ status: 'error', code: 'OAUTH_FAILED', next });
        return;
      }
      if (typeof query.code !== 'string' || query.code.length === 0 || query.code.length > 2048) {
        throw Errors.oauthFailed('Missing authorization code');
      }
      const session = await this.oauth.complete(provider, query.code, state, meta);
      this.setSessionCookies(res, session);
      redirect({ status: 'success', next });
    } catch {
      redirect({ status: 'error', code: 'OAUTH_FAILED', next });
    }
  }
}
