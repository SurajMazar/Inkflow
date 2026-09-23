import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { loadEnvironment } from './config/app-config';

async function main(): Promise<void> {
  const env = loadEnvironment();
  const app = await createApp(env);
  await app.listen(env.PORT, env.HOST);
  new Logger('Bootstrap').log(`Inkflow API listening on http://${env.HOST}:${env.PORT}/api (docs: /api/docs)`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
