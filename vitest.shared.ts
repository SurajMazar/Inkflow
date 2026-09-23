import { defineConfig } from 'vitest/config';

/**
 * Shared Vitest configuration. The `source` export condition resolves workspace packages to their
 * TypeScript sources so tests never depend on stale build output.
 */
export const sharedVitestConfig = defineConfig({
  resolve: {
    conditions: ['source', 'module', 'browser', 'development|production'],
  },
  ssr: {
    resolve: {
      conditions: ['source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
