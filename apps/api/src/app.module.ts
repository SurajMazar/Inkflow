import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module, RequestMethod, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import type { ApiEnv } from '@inkflow/config';
import { CoreModule } from './access/core.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { CsrfGuard } from './auth/csrf.guard';
import { SecurityModule } from './auth/security.module';
import { BoardsModule } from './boards/boards.module';
import { CollaborationModule } from './collaboration/collaboration.module';
import { CommentsModule } from './comments/comments.module';
import { AllExceptionsFilter } from './common/exception.filter';
import {
  AppThrottlerGuard,
  RedisThrottlerStorage,
  THROTTLER_AUTH_EMAIL,
  THROTTLER_AUTH_IP,
  THROTTLER_DEFAULT,
} from './common/rate-limit';
import { AppConfig } from './config/app-config';
import { ConfigModule } from './config/config.module';
import { FilesModule } from './files/files.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { MailModule } from './mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OperationsModule } from './operations/operations.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { SearchModule } from './search/search.module';
import { SharingModule } from './sharing/sharing.module';
import { StorageModule } from './storage/storage.module';
import { TemplatesModule } from './templates/templates.module';
import { UsersModule } from './users/users.module';
import { VersionsModule } from './versions/versions.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

const SENSITIVE_QUERY = /([?&](?:st|token|code|state)=)[^&]*/gi;

/** Request URL with secrets (share tokens, OAuth codes) removed, for logs. */
export function redactUrl(url: string | undefined): string | undefined {
  return url?.replace(SENSITIVE_QUERY, '$1[redacted]');
}

function loggerModule(env: ApiEnv): DynamicModule {
  const pretty = env.NODE_ENV === 'development';
  return LoggerModule.forRoot({
    // Express 5 / path-to-regexp v8 named wildcard (the default '*' is deprecated).
    forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
    pinoHttp: {
      level: env.LOG_LEVEL,
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const existing = (req as IncomingMessage & { id?: unknown }).id;
        if (typeof existing === 'string') return existing;
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && /^[\w.-]{1,64}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["x-csrf-token"]',
          'req.headers["x-share-token"]',
          'res.headers["set-cookie"]',
          '*.password',
          '*.currentPassword',
          '*.newPassword',
          '*.token',
          '*.refreshToken',
          '*.accessToken',
        ],
        censor: '[redacted]',
      },
      serializers: {
        req: (req: {
          id?: unknown;
          method?: string;
          url?: string;
          remoteAddress?: string;
          headers?: Record<string, unknown>;
        }) => ({
          id: req.id,
          method: req.method,
          url: redactUrl(req.url),
          remoteAddress: req.remoteAddress,
          userAgent: req.headers?.['user-agent'],
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      autoLogging: { ignore: (req: IncomingMessage) => (req.url ?? '').startsWith('/api/health') },
      ...(pretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: { singleLine: true, colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
            },
          }
        : {}),
    },
  });
}

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    const windowMs = env.RATE_LIMIT_WINDOW_SECONDS * 1000;
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        loggerModule(env),
        PrismaModule,
        RedisModule,
        ThrottlerModule.forRootAsync({
          inject: [AppConfig, RedisService],
          useFactory: (_config: AppConfig, redis: RedisService) => ({
            storage: new RedisThrottlerStorage(redis.client),
            throttlers: [
              { name: THROTTLER_DEFAULT, ttl: windowMs, limit: env.RATE_LIMIT_MAX },
              { name: THROTTLER_AUTH_IP, ttl: windowMs, limit: env.AUTH_RATE_LIMIT_MAX },
              // Per-account limit (login lockout / reset spam): blocks the address for 5 windows.
              {
                name: THROTTLER_AUTH_EMAIL,
                ttl: windowMs,
                limit: Math.max(3, Math.ceil(env.AUTH_RATE_LIMIT_MAX / 2)),
                blockDuration: windowMs * 5,
              },
            ],
          }),
        }),
        StorageModule,
        MailModule,
        SecurityModule,
        CoreModule,
        NotificationsModule,
        UsersModule,
        FilesModule,
        AuthModule,
        WorkspacesModule,
        ProjectsModule,
        TemplatesModule,
        BoardsModule,
        SharingModule,
        VersionsModule,
        OperationsModule,
        CommentsModule,
        SearchModule,
        HealthModule,
        JobsModule,
        CollaborationModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
