import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfig } from '../config/app-config';

/**
 * Redis connections: `client` for commands, `publisher` for pub/sub fan-out and a dedicated
 * `subscriber` (a subscribed connection cannot run other commands).
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  readonly publisher: Redis;
  readonly subscriber: Redis;

  constructor(config: AppConfig) {
    const make = (name: string) => {
      const conn = new Redis(config.env.REDIS_URL, {
        connectionName: `inkflow-api-${name}`,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        retryStrategy: (times) => Math.min(times * 200, 5000),
      });
      conn.on('error', (err: Error) => this.logger.warn(`Redis (${name}) error: ${err.message}`));
      return conn;
    };
    this.client = make('cmd');
    this.publisher = make('pub');
    this.subscriber = make('sub');
  }

  async ping(): Promise<void> {
    const reply = await this.client.ping();
    if (reply !== 'PONG') throw new Error(`Unexpected PING reply: ${reply}`);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.subscriber.quit(), this.publisher.quit(), this.client.quit()]);
  }
}
