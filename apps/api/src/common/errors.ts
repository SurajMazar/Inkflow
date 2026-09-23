import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@inkflow/shared';

export interface AppErrorPayload {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** An error with a machine-readable code, rendered as `ApiErrorBody` by the exception filter. */
export class AppError extends HttpException {
  constructor(
    status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
    public readonly headers?: Record<string, string>,
  ) {
    super({ code, message, details } satisfies AppErrorPayload, status);
  }
}

export const Errors = {
  validation: (message = 'Request validation failed', details?: unknown) =>
    new AppError(400, 'VALIDATION_FAILED', message, details),
  unauthorized: (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message),
  sessionExpired: (message = 'Your session has expired') =>
    new AppError(401, 'SESSION_EXPIRED', message),
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'),
  emailNotVerified: () =>
    new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address before signing in'),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new AppError(403, 'FORBIDDEN', message),
  csrf: () => new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token'),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`),
  conflict: (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details),
  tokenInvalid: (message = 'This link is invalid or has already been used') =>
    new AppError(400, 'TOKEN_INVALID', message),
  tokenExpired: (message = 'This link has expired') => new AppError(400, 'TOKEN_EXPIRED', message),
  payloadTooLarge: (message = 'Payload too large') =>
    new AppError(413, 'PAYLOAD_TOO_LARGE', message),
  unsupportedMediaType: (message: string) => new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', message),
  rateLimited: (retryAfterSeconds: number) =>
    new AppError(
      429,
      'RATE_LIMITED',
      'Too many requests, please slow down',
      { retryAfter: retryAfterSeconds },
      {
        'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
      },
    ),
  oauthFailed: (message = 'Sign-in with the provider failed') =>
    new AppError(400, 'OAUTH_FAILED', message),
  unavailable: (message = 'Service temporarily unavailable') =>
    new AppError(503, 'SERVICE_UNAVAILABLE', message),
};
