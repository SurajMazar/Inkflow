import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';
export { PrismaClient, Prisma } from '@prisma/client';

export interface CreatePrismaClientOptions {
  /** Log Prisma warnings/errors to stderr (default true). */
  logWarnings?: boolean;
}

/**
 * Creates a Prisma client for the given connection string (defaults to `DATABASE_URL`).
 * Callers own the client and must `$disconnect()` it.
 */
export function createPrismaClient(
  url?: string,
  options: CreatePrismaClientOptions = {},
): PrismaClient {
  const log: ('warn' | 'error')[] = options.logWarnings === false ? [] : ['warn', 'error'];
  return new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log,
  });
}
