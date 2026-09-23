import { describe, expect, it } from 'vitest';
import { createBoardSchema } from '@inkflow/shared';
import { AppError } from './errors';
import { toOpenApiSchema, UuidPipe, ZodValidationPipe } from './validation';

describe('validation', () => {
  it('returns parsed data (with defaults) or a VALIDATION_FAILED error', () => {
    const pipe = new ZodValidationPipe(createBoardSchema, { emptyAsObject: true });
    expect(pipe.transform({ workspaceId: 'w' })).toMatchObject({
      workspaceId: 'w',
      title: 'Untitled board',
    });
    try {
      pipe.transform(undefined);
      throw new Error('should fail');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('VALIDATION_FAILED');
      expect((err as AppError).details).toEqual([
        expect.objectContaining({ path: ['workspaceId'] }),
      ]);
    }
  });

  it('treats malformed ids as not found', () => {
    const pipe = new UuidPipe('Board');
    expect(pipe.transform('7B2E7C4E-0F8B-4C54-9F33-6A1E2D3C4B5A')).toBe(
      '7b2e7c4e-0f8b-4c54-9f33-6a1e2d3c4b5a',
    );
    expect(() => pipe.transform('nope')).toThrow('Board not found');
  });

  it('produces OpenAPI schemas from Zod schemas', () => {
    const schema = toOpenApiSchema(createBoardSchema) as {
      type: string;
      properties: Record<string, unknown>;
    };
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['workspaceId', 'title', 'document']),
    );
  });
});
