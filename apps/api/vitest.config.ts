import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests. SWC emits decorator metadata (esbuild cannot), and the `source` export condition
 * resolves workspace packages to their TypeScript sources.
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
    include: ['src/**/*.spec.ts'],
    passWithNoTests: false,
  },
});
