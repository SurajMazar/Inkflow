import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@inkflow/database';
import { AppConfig } from '../config/app-config';

/** Transaction client type (the argument of interactive `$transaction` callbacks). */
export type Tx = Prisma.TransactionClient;
/** Either the root client or a transaction client. */
export type Db = PrismaClient | Tx;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  constructor(config: AppConfig) {
    super({ datasources: { db: { url: config.env.DATABASE_URL } }, log: ['warn'] });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
