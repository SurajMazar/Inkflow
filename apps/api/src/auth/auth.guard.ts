import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ACCESS_COOKIE } from '../common/cookies';
import { Errors } from '../common/errors';
import {
  ALLOW_SHARE_TOKEN,
  getShareToken,
  IS_PUBLIC,
  type AppRequest,
  type AuthInfo,
} from '../common/request';
import { TokensService } from './tokens.service';

export type ExtractedToken = { token: string; via: 'cookie' | 'bearer' } | null;

/** Access token from `Authorization: Bearer` (preferred) or the access cookie. */
export function extractAccessToken(req: Request): ExtractedToken {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    if (token) return { token, via: 'bearer' };
  }
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const cookie = cookies?.[ACCESS_COOKIE];
  if (typeof cookie === 'string' && cookie) return { token: cookie, via: 'cookie' };
  return null;
}

/**
 * Global authentication guard. Attaches `req.auth`; routes are protected unless marked
 * `@Public()` or (with a share token present) `@AllowShareToken()`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ?? false;
    const allowShare =
      this.reflector.getAllAndOverride<boolean>(ALLOW_SHARE_TOKEN, targets) ?? false;

    const extracted = extractAccessToken(req);
    req.auth = null;
    let failure: 'expired' | 'invalid' | null = null;
    if (extracted) {
      const result = this.tokens.verifyAccessToken(extracted.token);
      if (result.status === 'valid') {
        if (await this.tokens.isSessionRevoked(result.claims.sid)) failure = 'expired';
        else
          req.auth = {
            userId: result.claims.sub,
            sessionId: result.claims.sid,
            via: extracted.via,
          } satisfies AuthInfo;
      } else {
        failure = result.status;
      }
    }
    if (isPublic || req.auth) return true;
    if (failure === 'expired') throw Errors.sessionExpired();
    if (allowShare && getShareToken(req) && !failure) return true;
    if (failure === 'invalid') throw Errors.unauthorized('Invalid access token');
    throw Errors.unauthorized();
  }
}
