import { applyDecorators, Body, Param, Query, type PipeTransform } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { isUuid } from '@inkflow/shared';
import { z } from 'zod';
import { Errors } from './errors';

export interface ValidationIssue {
  path: (string | number)[];
  message: string;
  code: string;
}

export function formatZodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
    message: issue.message,
    code: issue.code,
  }));
}

/** Validates (and transforms) input with a Zod schema; failures become `400 VALIDATION_FAILED`. */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(
    private readonly schema: S,
    private readonly options: { emptyAsObject?: boolean } = {},
  ) {}

  transform(value: unknown): z.output<S> {
    const input = value === undefined && this.options.emptyAsObject ? {} : value;
    const result = this.schema.safeParse(input);
    if (!result.success)
      throw Errors.validation('Request validation failed', formatZodIssues(result.error));
    return result.data;
  }
}

/** Parses a value with a schema, throwing the API validation error. */
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  return new ZodValidationPipe(schema).transform(value);
}

/** Body parameter validated by a Zod schema (a missing body is treated as `{}`). */
export const ZBody = <S extends z.ZodType>(schema: S) =>
  Body(new ZodValidationPipe(schema, { emptyAsObject: true }));
/** Query object validated by a Zod schema. */
export const ZQuery = <S extends z.ZodType>(schema: S) =>
  Query(new ZodValidationPipe(schema, { emptyAsObject: true }));

/** Route params that must be UUIDs: anything else cannot exist, so it is a 404 (never a DB error). */
export class UuidPipe implements PipeTransform<unknown, string> {
  constructor(private readonly what = 'Resource') {}
  transform(value: unknown): string {
    if (typeof value !== 'string' || !isUuid(value)) throw Errors.notFound(this.what);
    return value.toLowerCase();
  }
}

export const IdParam = (name = 'id', what = 'Resource') => Param(name, new UuidPipe(what));

/** OpenAPI JSON schema from a Zod schema (input side). */
export function toOpenApiSchema(schema: z.ZodType): Record<string, unknown> {
  try {
    const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<
      string,
      unknown
    >;
    const { $schema: _ignored, ...rest } = json;
    return rest;
  } catch {
    return { type: 'object' };
  }
}

/** Documents a JSON request body in OpenAPI. */
export const ApiZodBody = (schema: z.ZodType) => ApiBody({ schema: toOpenApiSchema(schema) });

/** Documents the properties of a query object in OpenAPI. */
export function ApiZodQuery(schema: z.ZodObject) {
  const json = toOpenApiSchema(schema) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const decorators = Object.entries(json.properties ?? {}).map(([name, prop]) =>
    ApiQuery({ name, required: json.required?.includes(name) ?? false, schema: prop }),
  );
  return applyDecorators(...decorators);
}
