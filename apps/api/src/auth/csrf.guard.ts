import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { CSRF_HEADER } from '@inkflow/shared';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '../common/cookies';
import { safeEqual } from '../common/crypto';
import { Errors } from '../common/errors';
import { TokensService } from './tokens.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfCheckInput {
  method: string;
  hasBearer: boolean;
  cookies: Record<string, string | undefined>;
  header: string | undefined;
}

/**
 * Double-submit rule: unsafe requests that carry an auth cookie (and no bearer token) must echo the
 * `inkflow_csrf` cookie in `x-csrf-token`, and the token must carry a valid server signature.
 */
export function csrfCheck(
  input: CsrfCheckInput,
  isValidToken: (token: string) => boolean,
): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return true;
  if (input.hasBearer) return true;
  const cookieAuthenticated = Boolean(
    input.cookies[ACCESS_COOKIE] || input.cookies[REFRESH_COOKIE],
  );
  if (!cookieAuthenticated) return true;
  const cookie = input.cookies[CSRF_COOKIE];
  const header = input.header;
  if (!cookie || !header) return false;
  if (!safeEqual(cookie, header)) return false;
  return isValidToken(header);
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly tokens: TokensService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request & { cookies?: Record<string, string> }>();
    const header = req.headers[CSRF_HEADER];
    const authorization = req.headers.authorization;
    const ok = csrfCheck(
      {
        method: req.method,
        hasBearer:
          typeof authorization === 'string' && authorization.toLowerCase().startsWith('bearer '),
        cookies: req.cookies ?? {},
        header: Array.isArray(header) ? header[0] : header,
      },
      (token) => this.tokens.isValidCsrfToken(token),
    );
    if (!ok) throw Errors.csrf();
    return true;
  }
}
