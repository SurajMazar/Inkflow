import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { Prisma } from '@inkflow/database';
import type { ApiErrorBody, ErrorCode } from '@inkflow/shared';
import { ZodError } from 'zod';
import { AppError, type AppErrorPayload } from './errors';
import { requestId, type AppRequest } from './request';
import { formatZodIssues } from './validation';

interface Rendered {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
  headers?: Record<string, string>;
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

function messageOf(response: unknown, fallback: string): string {
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') {
    const m = (response as { message?: unknown }).message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m) && typeof m[0] === 'string') return m.join('; ');
  }
  return fallback;
}

/** Maps any thrown value to the API error representation. Never exposes internals for 5xx. */
export function renderException(exception: unknown): Rendered {
  if (exception instanceof AppError) {
    const payload = exception.getResponse() as AppErrorPayload;
    return {
      status: exception.getStatus(),
      code: payload.code,
      message: payload.message,
      details: payload.details,
      headers: exception.headers,
    };
  }
  if (exception instanceof ThrottlerException) {
    return { status: 429, code: 'RATE_LIMITED', message: 'Too many requests, please slow down' };
  }
  if (exception instanceof ZodError) {
    return { status: 400, code: 'VALIDATION_FAILED', message: 'Request validation failed', details: formatZodIssues(exception) };
  }
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      case 'P2002':
        return {
          status: 409,
          code: 'CONFLICT',
          message: 'A record with the same unique value already exists',
          details: { target: (exception.meta as { target?: unknown } | undefined)?.target ?? null },
        };
      case 'P2025':
      case 'P2023':
        return { status: 404, code: 'NOT_FOUND', message: 'Resource not found' };
      case 'P2003':
        return { status: 409, code: 'CONFLICT', message: 'The operation conflicts with related records' };
      default:
        break;
    }
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED');
    if (status >= 500) {
      return { status, code: status === 503 ? 'SERVICE_UNAVAILABLE' : 'INTERNAL', message: 'Internal server error' };
    }
    return { status, code, message: messageOf(exception.getResponse(), exception.message) };
  }
  // Errors raised by Express middleware (body parser) carry `status`/`type`.
  if (exception && typeof exception === 'object' && 'status' in exception && 'type' in exception) {
    const e = exception as { status: number; type: string };
    if (e.type === 'entity.too.large') return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
    if (e.type === 'entity.parse.failed') return { status: 400, code: 'VALIDATION_FAILED', message: 'Malformed JSON body' };
    if (typeof e.status === 'number' && e.status >= 400 && e.status < 500) {
      return { status: e.status, code: STATUS_CODES[e.status] ?? 'VALIDATION_FAILED', message: 'Bad request' };
    }
  }
  return { status: 500, code: 'INTERNAL', message: 'Internal server error' };
}

export function buildErrorBody(rendered: Rendered, reqId: string | undefined): ApiErrorBody {
  return {
    error: {
      code: rendered.code,
      message: rendered.message,
      ...(rendered.details !== undefined ? { details: rendered.details } : {}),
      ...(reqId ? { requestId: reqId } : {}),
    },
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AppRequest>();
    const rendered = renderException(exception);
    const reqId = requestId(req);
    if (rendered.status >= 500) {
      this.logger.error(
        { err: exception, requestId: reqId, method: req.method, url: req.originalUrl?.split('?')[0] },
        'Unhandled error',
      );
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    if (rendered.status === 429 && !rendered.headers?.['Retry-After'] && !res.getHeader('Retry-After')) {
      res.setHeader('Retry-After', '60');
    }
    for (const [name, value] of Object.entries(rendered.headers ?? {})) res.setHeader(name, value);
    res.status(rendered.status).json(buildErrorBody(rendered, reqId));
  }
}
