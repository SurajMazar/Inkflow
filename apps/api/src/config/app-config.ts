import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isOAuthConfigured, parseApiEnv, type ApiEnv } from '@inkflow/config';

/** Injectable wrapper around the validated environment. */
export class AppConfig {
  constructor(public readonly env: ApiEnv) {}

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  get webOrigin(): string {
    return this.env.WEB_ORIGIN.replace(/\/+$/, '');
  }

  get publicApiUrl(): string {
    return this.env.PUBLIC_API_URL.replace(/\/+$/, '');
  }

  oauthConfigured(provider: 'google' | 'github'): boolean {
    return isOAuthConfigured(this.env, provider);
  }

  /** Absolute link into the web app. */
  webLink(path: string): string {
    return `${this.webOrigin}${path.startsWith('/') ? path : `/${path}`}`;
  }
}

/**
 * Loads the repository-root `.env` (development only, when present) and validates the environment.
 * Variables already present in the process environment take precedence.
 */
export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  if (source.NODE_ENV !== 'production') {
    // src/config or dist/config → repository root is four levels up.
    const candidates = [resolve(process.cwd(), '.env'), resolve(__dirname, '../../../../.env')];
    const found = candidates.find((file) => existsSync(file));
    if (found && source === process.env) process.loadEnvFile(found);
  }
  return parseApiEnv(source);
}
