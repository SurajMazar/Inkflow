import { Injectable, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
  type ThrottlerStorage,
} from '@nestjs/throttler';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { sha256Hex } from './crypto';
import { Errors } from './errors';

/** Named throttlers. `default` applies everywhere; the auth ones only on `@AuthRateLimit()` routes. */
export const THROTTLER_DEFAULT = 'default';
export const THROTTLER_AUTH_IP = 'auth';
export const THROTTLER_AUTH_EMAIL = 'auth-email';

const AUTH_RATE_LIMIT = 'inkflow:auth-rate-limit';
export interface AuthRateLimitOptions {
  /** Also limit per email address found in the body (login, forgot password…). */
  perEmail?: boolean;
}
/** Applies the stricter auth limits (per IP, optionally also per email). */
export const AuthRateLimit = (options: AuthRateLimitOptions = {}) =>
  SetMetadata(AUTH_RATE_LIMIT, options);

const INCREMENT_SCRIPT = `
local hits_key = KEYS[1]
local block_key = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local block = tonumber(ARGV[3])
local blocked = redis.call('PTTL', block_key)
if blocked > 0 then
  local hits = tonumber(redis.call('GET', hits_key) or '0')
  local pttl = redis.call('PTTL', hits_key)
  if pttl < 0 then pttl = 0 end
  return {hits, pttl, 1, blocked}
end
local hits = redis.call('INCR', hits_key)
local pttl = redis.call('PTTL', hits_key)
if pttl < 0 then
  redis.call('PEXPIRE', hits_key, ttl)
  pttl = ttl
end
if hits > limit then
  redis.call('SET', block_key, '1', 'PX', block)
  return {hits, pttl, 1, block}
end
return {hits, pttl, 0, 0}
`;

/** Fixed-window counter + block key in Redis, shared by every API instance. */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'inkflow:rl:',
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${this.prefix}${throttlerName}:${key}`;
    const result = (await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      `${base}:hits`,
      `${base}:block`,
      String(Math.max(1, Math.round(ttl))),
      String(limit),
      String(Math.max(1, Math.round(blockDuration))),
    )) as [number, number, number, number];
    const [totalHits, pttl, blocked, blockPttl] = result;
    return {
      totalHits,
      timeToExpire: Math.ceil(pttl / 1000),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.ceil(blockPttl / 1000),
    };
  }
}

/** Normalized email from a JSON body, when present. */
function bodyEmail(req: Request): string | null {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 && normalized.length <= 254 ? normalized : null;
}

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storage, reflector);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return super.canActivate(context);
  }

  protected override async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    const name = props.throttler.name;
    if (name === THROTTLER_AUTH_IP || name === THROTTLER_AUTH_EMAIL) {
      const options = this.reflector.getAllAndOverride<AuthRateLimitOptions | undefined>(
        AUTH_RATE_LIMIT,
        [props.context.getHandler(), props.context.getClass()],
      );
      if (!options) return true;
      if (name === THROTTLER_AUTH_EMAIL) {
        if (!options.perEmail) return true;
        const email = bodyEmail(props.context.switchToHttp().getRequest<Request>());
        if (!email) return true;
        return super.handleRequest({ ...props, getTracker: () => `email:${sha256Hex(email)}` });
      }
    }
    return super.handleRequest(props);
  }

  /** The global limit is per client across all routes; auth limits are per route. */
  protected override generateKey(context: ExecutionContext, suffix: string, name: string): string {
    if (name === THROTTLER_DEFAULT) return sha256Hex(`${name}-${suffix}`);
    return super.generateKey(context, suffix, name);
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse<Response>();
    const retryAfter = Math.max(1, detail.timeToBlockExpire || detail.timeToExpire || 1);
    res.setHeader('Retry-After', String(retryAfter));
    throw Errors.rateLimited(retryAfter);
  }
}
