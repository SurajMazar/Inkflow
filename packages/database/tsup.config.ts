import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  tsconfig: 'tsconfig.json',
  // The generated client (and its native query engine) must be resolved at runtime.
  external: ['@prisma/client', '.prisma/client'],
});
