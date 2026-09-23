import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return fallback;
      if (typeof v === 'boolean') return v;
      return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    });

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const DEV_SECRET_MARKER = 'dev-only';

export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4310),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: bool(false),

    /** Public origin of the web app (used for CORS, links in emails and OAuth redirects). */
    WEB_ORIGIN: z.url().default('http://localhost:5173'),
    /** Public base URL of the API as reachable from browsers (for OAuth callbacks). */
    PUBLIC_API_URL: z.url().default('http://localhost:5173/api'),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    COOKIE_SECURE: bool(false),
    COOKIE_DOMAIN: optionalString,
    REQUIRE_EMAIL_VERIFICATION: bool(true),

    S3_ENDPOINT: optionalString,
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().min(1).default('inkflow'),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool(true),

    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().default(1025),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SMTP_SECURE: bool(false),
    MAIL_FROM: z.string().default('Inkflow <no-reply@inkflow.local>'),

    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,

    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(600),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),

    /** Create an automatic version after this many operations since the last version. */
    AUTO_VERSION_EVERY_OPS: z.coerce.number().int().min(10).default(500),
    /** ...or after this many minutes of editing since the last version. */
    AUTO_VERSION_EVERY_MINUTES: z.coerce.number().int().min(1).default(15),
    /** Days a board stays in the trash before it is purged automatically. */
    TRASH_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['JWT_SECRET', 'SESSION_SECRET'] as const) {
      if (env[key].includes(DEV_SECRET_MARKER)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} still contains the development placeholder; set a strong secret for production`,
        });
      }
    }
    if (!env.COOKIE_SECURE && env.WEB_ORIGIN.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be enabled when serving over HTTPS in production',
      });
    }
  });

export type ApiEnv = z.output<typeof apiEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

export function parseApiEnv(source: Record<string, string | undefined>): ApiEnv {
  const result = apiEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

export function isOAuthConfigured(env: ApiEnv, provider: 'google' | 'github'): boolean {
  return provider === 'google'
    ? Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
    : Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}
