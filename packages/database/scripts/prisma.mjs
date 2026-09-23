// Runs the Prisma CLI with the repository-root `.env` loaded (when present), so `pnpm db:migrate`
// works from any directory. Variables already set in the environment take precedence.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const require = createRequire(import.meta.url);
const cli = require.resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: resolve(here, '..'),
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
