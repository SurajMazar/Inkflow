import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseApiEnv, type ApiEnv } from '@inkflow/config';

/** Redis logical database reserved for integration tests (flushed before each run). */
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
export const TEST_BUCKET = process.env.TEST_S3_BUCKET ?? 'inkflow-test';
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8026';

let loaded = false;
export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = resolve(__dirname, '../../../.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export function testDatabaseUrl(): string {
  loadRootEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set (see .env.example)');
  return url;
}

/** Environment for an API instance under test (real services, test database/bucket/redis db). */
export function testEnv(overrides: Record<string, string> = {}): ApiEnv {
  loadRootEnv();
  return parseApiEnv({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    PORT: '4999',
    DATABASE_URL: testDatabaseUrl(),
    REDIS_URL: TEST_REDIS_URL,
    S3_BUCKET: TEST_BUCKET,
    SMTP_HOST: process.env.SMTP_HOST || 'localhost',
    SMTP_PORT: process.env.SMTP_PORT || '1026',
    WEB_ORIGIN: 'http://localhost:5173',
    PUBLIC_API_URL: 'http://localhost:5173/api',
    REQUIRE_EMAIL_VERIFICATION: 'true',
    RATE_LIMIT_MAX: '100000',
    AUTH_RATE_LIMIT_MAX: '100000',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
    ...overrides,
  });
}
