import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { PrismaClient } from '@inkflow/database';
import { Redis } from 'ioredis';
import { TEST_REDIS_URL, testDatabaseUrl } from './env';

const repoRoot = resolve(__dirname, '../../..');
const databasePackage = resolve(repoRoot, 'packages/database');

/** Applies migrations to the test database and wipes all data before the integration run. */
export default async function setup(): Promise<void> {
  const rootEnv = resolve(repoRoot, '.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const url = testDatabaseUrl();

  const require = createRequire(resolve(databasePackage, 'package.json'));
  const prismaCli = require.resolve('prisma/build/index.js');
  const migrate = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: databasePackage,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
  if (migrate.status !== 0) {
    throw new Error(`prisma migrate deploy failed:\n${migrate.stdout}\n${migrate.stderr}`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length > 0) {
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }

  const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: 2 });
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}
