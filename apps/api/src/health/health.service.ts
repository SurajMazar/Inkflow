import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { HealthCheckDto, HealthStatus } from '@inkflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';

const CHECK_TIMEOUT_MS = 3_000;
const startedAt = Date.now();

function readVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    // src/health or dist/health → apps/api/package.json
    return (JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const API_VERSION = readVersion();

async function timed(fn: () => Promise<unknown>): Promise<{ status: HealthStatus; latencyMs: number; error?: string }> {
  const start = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS} ms`)), CHECK_TIMEOUT_MS);
      }),
    ]);
    return { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { status: 'down', latencyMs: Math.round(performance.now() - start), error: (err as Error).message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  liveness(): HealthCheckDto {
    return { status: 'ok', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), version: API_VERSION, checks: {} };
  }

  async readiness(): Promise<HealthCheckDto> {
    const [database, redis, storage] = await Promise.all([
      timed(() => this.prisma.$queryRaw`SELECT 1`),
      timed(() => this.redis.ping()),
      timed(() => this.storage.headBucket()),
    ]);
    const checks = { database, redis, storage };
    const status: HealthStatus = Object.values(checks).every((c) => c.status === 'ok') ? 'ok' : 'down';
    return { status, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), version: API_VERSION, checks };
  }
}
