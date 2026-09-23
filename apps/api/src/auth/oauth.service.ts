import { Injectable, Logger } from '@nestjs/common';
import type { OAuthProvider } from '@inkflow/shared';
import { AppConfig } from '../config/app-config';
import {
  deriveKey,
  pkceChallenge,
  randomToken,
  safeEqual,
  signPayload,
  verifySignedPayload,
} from '../common/crypto';
import { Errors } from '../common/errors';
import type { ClientMeta } from '../common/request';
import { safeNextPath } from '../common/mappers';
import { PrismaService } from '../prisma/prisma.service';
import { OnboardingService } from '../users/onboarding.service';
import { OAUTH_STATE_TTL_SECONDS } from '../common/cookies';
import { SessionsService, type IssuedSession } from './sessions.service';

export interface OAuthStateCookie {
  provider: OAuthProvider;
  state: string;
  verifier: string;
  next: string;
  exp: number;
}

export interface OAuthProfile {
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
}

interface ProviderEndpoints {
  authorize: string;
  token: string;
  scope: string;
}

const ENDPOINTS: Record<OAuthProvider, ProviderEndpoints> = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
  },
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
  },
};

const FETCH_TIMEOUT_MS = 10_000;

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value === 'google' || value === 'github';
}

/** OAuth 2.0 authorization-code flow with `state` + PKCE (S256) for Google and GitHub. */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly stateKey: Buffer;

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly onboarding: OnboardingService,
  ) {
    this.stateKey = deriveKey(config.env.SESSION_SECRET, 'oauth-state');
  }

  isConfigured(provider: OAuthProvider): boolean {
    return this.config.oauthConfigured(provider);
  }

  private credentials(provider: OAuthProvider): { clientId: string; clientSecret: string } {
    const env = this.config.env;
    const clientId = provider === 'google' ? env.GOOGLE_CLIENT_ID : env.GITHUB_CLIENT_ID;
    const clientSecret =
      provider === 'google' ? env.GOOGLE_CLIENT_SECRET : env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw Errors.notFound('OAuth provider');
    return { clientId, clientSecret };
  }

  redirectUri(provider: OAuthProvider): string {
    return `${this.config.publicApiUrl}/auth/oauth/${provider}/callback`;
  }

  /** Builds the provider authorization URL and the signed state cookie value. */
  begin(provider: OAuthProvider, next: unknown): { url: string; cookie: string } {
    const { clientId } = this.credentials(provider);
    const state = randomToken(24);
    const verifier = randomToken(48);
    const payload: OAuthStateCookie = {
      provider,
      state,
      verifier,
      next: safeNextPath(next),
      exp: Date.now() + OAUTH_STATE_TTL_SECONDS * 1000,
    };
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.redirectUri(provider),
      response_type: 'code',
      scope: ENDPOINTS[provider].scope,
      state,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: 'S256',
    });
    if (provider === 'google') params.set('prompt', 'select_account');
    if (provider === 'github') params.set('allow_signup', 'true');
    return {
      url: `${ENDPOINTS[provider].authorize}?${params.toString()}`,
      cookie: signPayload(this.stateKey, payload),
    };
  }

  /** Validates the callback against the state cookie. */
  verifyState(
    provider: OAuthProvider,
    cookie: string | undefined,
    state: unknown,
  ): OAuthStateCookie {
    const payload = verifySignedPayload<OAuthStateCookie>(this.stateKey, cookie);
    if (!payload || payload.provider !== provider || payload.exp < Date.now())
      throw Errors.oauthFailed('Sign-in expired, please try again');
    if (typeof state !== 'string' || !safeEqual(state, payload.state))
      throw Errors.oauthFailed('Invalid OAuth state');
    return payload;
  }

  private async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
    return (await res.json()) as T;
  }

  private async exchangeCode(
    provider: OAuthProvider,
    code: string,
    verifier: string,
  ): Promise<string> {
    const { clientId, clientSecret } = this.credentials(provider);
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: this.redirectUri(provider),
      grant_type: 'authorization_code',
    });
    const token = await this.fetchJson<{ access_token?: string; error?: string }>(
      ENDPOINTS[provider].token,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
      },
    );
    if (!token.access_token)
      throw new Error(`Token exchange failed: ${token.error ?? 'no access token'}`);
    return token.access_token;
  }

  private async fetchProfile(provider: OAuthProvider, accessToken: string): Promise<OAuthProfile> {
    if (provider === 'google') {
      const info = await this.fetchJson<{
        sub?: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
        picture?: string;
      }>('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!info.sub || !info.email) throw new Error('Google profile is missing an email address');
      return {
        providerAccountId: info.sub,
        email: info.email.toLowerCase(),
        emailVerified: info.email_verified === true,
        name: info.name?.trim() || info.email.split('@')[0]!,
        avatarUrl: info.picture ?? null,
      };
    }
    const headers = {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'Inkflow',
      'x-github-api-version': '2022-11-28',
    };
    const user = await this.fetchJson<{
      id?: number;
      login?: string;
      name?: string | null;
      avatar_url?: string;
    }>('https://api.github.com/user', { headers });
    const emails = await this.fetchJson<{ email: string; primary: boolean; verified: boolean }[]>(
      'https://api.github.com/user/emails',
      { headers },
    );
    const primary = emails.find((e) => e.primary && e.verified) ?? null;
    if (!user.id || !primary) throw new Error('GitHub account has no verified primary email');
    return {
      providerAccountId: String(user.id),
      email: primary.email.toLowerCase(),
      emailVerified: true,
      name: user.name?.trim() || user.login || primary.email.split('@')[0]!,
      avatarUrl: user.avatar_url ?? null,
    };
  }

  /** Completes the flow: links or creates the account and starts a session. */
  async complete(
    provider: OAuthProvider,
    code: string,
    state: OAuthStateCookie,
    meta: ClientMeta,
  ): Promise<IssuedSession> {
    let profile: OAuthProfile;
    try {
      const accessToken = await this.exchangeCode(provider, code, state.verifier);
      profile = await this.fetchProfile(provider, accessToken);
    } catch (err) {
      this.logger.warn(`OAuth (${provider}) failed: ${(err as Error).message}`);
      throw Errors.oauthFailed();
    }
    if (!profile.emailVerified)
      throw Errors.oauthFailed('Your provider account email is not verified');
    const userId = await this.linkOrCreate(provider, profile);
    return this.sessions.create(userId, meta);
  }

  private async linkOrCreate(provider: OAuthProvider, profile: OAuthProfile): Promise<string> {
    const linked = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: { provider, providerAccountId: profile.providerAccountId },
      },
      select: { userId: true },
    });
    if (linked) return linked.userId;

    const existing = await this.prisma.user.findUnique({ where: { email: profile.email } });
    if (existing) {
      await this.prisma.oAuthAccount.upsert({
        where: { userId_provider: { userId: existing.id, provider } },
        create: {
          userId: existing.id,
          provider,
          providerAccountId: profile.providerAccountId,
          email: profile.email,
        },
        update: { providerAccountId: profile.providerAccountId, email: profile.email },
      });
      if (!existing.emailVerifiedAt) {
        // The password of an unverified account was never proven to belong to the address owner
        // (pre-account-takeover): drop it and its sessions before trusting the provider's email.
        await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            emailVerifiedAt: new Date(),
            passwordHash: null,
            ...(existing.avatarUrl ? {} : { avatarUrl: profile.avatarUrl }),
          },
        });
        await this.sessions.revokeAllForUser(existing.id, 'oauth-takeover-protection');
        await this.onboarding.claimPendingInvitations(existing.id, existing.email);
      }
      return existing.id;
    }

    const user = await this.prisma.user.create({
      data: {
        email: profile.email,
        name: profile.name.slice(0, 80),
        avatarUrl: profile.avatarUrl && profile.avatarUrl.length <= 2048 ? profile.avatarUrl : null,
        emailVerifiedAt: new Date(),
        oauthAccounts: {
          create: { provider, providerAccountId: profile.providerAccountId, email: profile.email },
        },
      },
    });
    await this.onboarding.createPersonalWorkspace(user.id, user.name);
    await this.onboarding.claimPendingInvitations(user.id, user.email);
    return user.id;
  }
}
