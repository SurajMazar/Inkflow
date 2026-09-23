import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { E2E } from './env';

/** Applies migrations to the E2E database, wipes data, and clears captured emails. */
export default async function globalSetup(): Promise<void> {
  const root = resolve(import.meta.dirname, '..');
  execSync('pnpm --filter @inkflow/database exec prisma migrate deploy', {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: E2E.databaseUrl },
  });
  const client = new pg.Client({ connectionString: E2E.databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length) {
      await client.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await client.end();
  }
  await fetch(`${E2E.mailpitUrl}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined);
}
