import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { describe, expect, it } from 'vitest';
import { Prisma } from '@inkflow/database';
import { z } from 'zod';
import { buildErrorBody, renderException } from './exception.filter';
import { Errors } from './errors';

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'test', meta: { target: ['email'] } });
}

describe('exception rendering', () => {
  it('passes application errors through', () => {
    expect(renderException(Errors.notFound('Board'))).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'Board not found' });
    const limited = renderException(Errors.rateLimited(12));
    expect(limited).toMatchObject({ status: 429, code: 'RATE_LIMITED', headers: { 'Retry-After': '12' } });
  });

  it('maps Prisma, Zod, throttler and HTTP exceptions', () => {
    expect(renderException(prismaError('P2002'))).toMatchObject({ status: 409, code: 'CONFLICT', details: { target: ['email'] } });
    expect(renderException(prismaError('P2025'))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    const zodError = z.object({ a: z.string() }).safeParse({ a: 1 }).error!;
    expect(renderException(zodError)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', details: [{ path: ['a'] }] });
    expect(renderException(new ThrottlerException())).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(renderException(new NotFoundException('Cannot GET /x'))).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'Cannot GET /x' });
    expect(renderException(new PayloadTooLargeException('File too large'))).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
    expect(renderException(new BadRequestException('nope'))).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(renderException({ status: 413, type: 'entity.too.large' })).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('never leaks internals of unknown errors', () => {
    const rendered = renderException(new Error('password=hunter2 at db.query'));
    expect(rendered).toEqual({ status: 500, code: 'INTERNAL', message: 'Internal server error' });
    expect(buildErrorBody(rendered, 'req-1')).toEqual({
      error: { code: 'INTERNAL', message: 'Internal server error', requestId: 'req-1' },
    });
  });
});
