/** Ports and endpoints used by the end-to-end environment (isolated from `pnpm dev`). */
export const E2E = {
  apiPort: Number(process.env.E2E_API_PORT ?? 4320),
  webPort: Number(process.env.E2E_WEB_PORT ?? 5183),
  databaseUrl:
    process.env.E2E_DATABASE_URL ??
    process.env.TEST_DATABASE_URL ??
    'postgresql://inkflow:inkflow@localhost:5433/inkflow_test?schema=public',
  mailpitUrl: process.env.E2E_MAILPIT_URL ?? 'http://localhost:8026',
} as const;

export const WEB_URL = `http://localhost:${E2E.webPort}`;
