import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { AppConfig } from '../config/app-config';
import { deriveKey, hmacSha256, randomToken, safeEqual } from '../common/crypto';
import { RedisService } from '../redis/redis.service';

export interface AccessClaims {
  sub: string;
  sid: string;
}

export type AccessVerification =
  | { status: 'valid'; claims: AccessClaims }
  | { status: 'expired' }
  | { status: 'invalid' };

const ISSUER = 'inkflow';
const AUDIENCE = 'inkflow-api';
const revokedKey = (sid: string) => `inkflow:revoked-session:${sid}`;

/** Access JWTs, CSRF tokens and the session revocation list. */
@Injectable()
export class TokensService {
  private readonly csrfKey: Buffer;

  constructor(
    private readonly config: AppConfig,
    private readonly redis: RedisService,
  ) {
    this.csrfKey = deriveKey(config.env.SESSION_SECRET, 'csrf');
  }

  signAccessToken(userId: string, sessionId: string): string {
    return jwt.sign({ sid: sessionId, typ: 'access' }, this.config.env.JWT_SECRET, {
      algorithm: 'HS256',
      subject: userId,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: this.config.env.ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  verifyAccessToken(token: string): AccessVerification {
    try {
      const payload = jwt.verify(token, this.config.env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      if (typeof payload === 'string') return { status: 'invalid' };
      const { sub, sid, typ } = payload as { sub?: unknown; sid?: unknown; typ?: unknown };
      if (typeof sub !== 'string' || typeof sid !== 'string' || typ !== 'access') return { status: 'invalid' };
      return { status: 'valid', claims: { sub, sid } };
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) return { status: 'expired' };
      return { status: 'invalid' };
    }
  }

  /** Marks a session family as revoked for the remaining lifetime of its access tokens. */
  async markSessionsRevoked(sessionIds: string[]): Promise<void> {
    if (sessionIds.length === 0) return;
    const ttl = this.config.env.ACCESS_TOKEN_TTL_SECONDS + 60;
    const pipeline = this.redis.client.pipeline();
    for (const sid of new Set(sessionIds)) pipeline.set(revokedKey(sid), '1', 'EX', ttl);
    await pipeline.exec();
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.client.exists(revokedKey(sessionId))) === 1;
  }

  /** Signed double-submit token: `<random>.<hmac(random)>`. */
  createCsrfToken(): string {
    const nonce = randomToken(24);
    return `${nonce}.${hmacSha256(this.csrfKey, nonce)}`;
  }

  isValidCsrfToken(token: string | undefined | null): boolean {
    if (!token || token.length > 256) return false;
    const dot = token.indexOf('.');
    if (dot <= 0) return false;
    return safeEqual(token.slice(dot + 1), hmacSha256(this.csrfKey, token.slice(0, dot)));
  }
}
