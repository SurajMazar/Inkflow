import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { SHARE_TOKEN_HEADER, SHARE_TOKEN_QUERY } from '@inkflow/shared';
import { Errors } from './errors';

export interface AuthInfo {
  userId: string;
  /** Session family id (`sid` claim). */
  sessionId: string;
  via: 'cookie' | 'bearer';
}

export type AppRequest = Request & {
  auth?: AuthInfo | null;
  /** Set by pino-http. */
  id?: string | number;
};

/** Who is performing a board-scoped request: an optional signed-in user and an optional share token. */
export interface Principal {
  userId: string | null;
  shareToken: string | null;
}

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

export const IS_PUBLIC = 'inkflow:public';
export const ALLOW_SHARE_TOKEN = 'inkflow:allow-share-token';

/** Route does not require authentication (auth is still attached when present and valid). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route may be called anonymously when a share token is supplied. */
export const AllowShareToken = () => SetMetadata(ALLOW_SHARE_TOKEN, true);

export function getShareToken(req: Request): string | null {
  const header = req.headers[SHARE_TOKEN_HEADER];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (fromHeader && fromHeader.length <= 512) return fromHeader;
  const query = (req.query as Record<string, unknown> | undefined)?.[SHARE_TOKEN_QUERY];
  if (typeof query === 'string' && query.length > 0 && query.length <= 512) return query;
  return null;
}

export function getClientMeta(req: Request): ClientMeta {
  const ua = req.headers['user-agent'];
  return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua.slice(0, 512) : null };
}

/** The signed-in user (throws 401 when the route allowed anonymous access and nobody is signed in). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthInfo => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth) throw Errors.unauthorized();
  return req.auth;
});

/** The signed-in user or null. */
export const OptionalUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthInfo | null => {
  return ctx.switchToHttp().getRequest<AppRequest>().auth ?? null;
});

/** Signed-in user (if any) plus share token (if any). */
export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  return { userId: req.auth?.userId ?? null, shareToken: getShareToken(req) };
});

export const Meta = createParamDecorator((_data: unknown, ctx: ExecutionContext): ClientMeta => {
  return getClientMeta(ctx.switchToHttp().getRequest<Request>());
});

export function requestId(req: AppRequest): string | undefined {
  return req.id === undefined ? undefined : String(req.id);
}
