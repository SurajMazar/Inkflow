import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests: boot the real Nest application against PostgreSQL (`TEST_DATABASE_URL`),
 * Redis, MinIO and Mailpit. Files run sequentially because they share those services.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  // Workspace packages resolve to their TypeScript sources (`source` condition); dependencies use
  // their Node (CommonJS) entry points like the compiled API does.
  resolve: {
    conditions: ['source', 'node', 'development|production'],
    mainFields: ['main'],
  },
  ssr: {
    resolve: {
      conditions: ['source', 'node', 'development|production'],
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.int.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
