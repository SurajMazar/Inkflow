import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { ApiEnv } from '@inkflow/config';
import { ACCESS_COOKIE, CSRF_HEADER, SHARE_TOKEN_HEADER } from '@inkflow/shared';
import { AppModule } from './app.module';
import { buildErrorBody, renderException } from './common/exception.filter';

export const JSON_BODY_LIMIT = '10mb';
export const DOCS_PATH = 'docs';

/** Formats errors raised by Express middleware before Nest routing (e.g. malformed/oversized JSON). */
function middlewareErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const rendered = renderException(err);
  const id = (req as Request & { id?: unknown }).id;
  res
    .status(rendered.status)
    .json(buildErrorBody(rendered, id === undefined ? undefined : String(id)));
}

/** Assigns the request id first, so every response (even body-parser errors) carries it. */
function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && /^[\w.-]{1,64}$/.test(incoming) ? incoming : randomUUID();
  (req as Request & { id?: string }).id = id;
  res.setHeader('x-request-id', id);
  next();
}

/** Applies middleware, security headers, CORS, OpenAPI and shutdown hooks. */
export function configureApp(app: NestExpressApplication, env: ApiEnv): void {
  app.useLogger(app.get(Logger));
  app.use(requestIdMiddleware);
  app.setGlobalPrefix('api');
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  const production = env.NODE_ENV === 'production';
  const apiHelmet = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
  });
  const docsHelmet = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        frameAncestors: ["'none'"],
      },
    },
    hsts: production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith(`/api/${DOCS_PATH}`)
      ? docsHelmet(req, res, next)
      : apiHelmet(req, res, next),
  );
  app.enableCors({
    origin: env.WEB_ORIGIN.replace(/\/+$/, ''),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'authorization',
      CSRF_HEADER,
      SHARE_TOKEN_HEADER,
      'x-request-id',
    ],
    exposedHeaders: ['x-request-id', 'retry-after'],
    maxAge: 600,
  });
  app.use(cookieParser());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(middlewareErrorHandler);

  const openApi = new DocumentBuilder()
    .setTitle('Inkflow API')
    .setDescription(
      'REST API of Inkflow. Real-time collaboration uses the WebSocket at /api/ws (see docs/API_CONTRACT.md).',
    )
    .setVersion('1.0')
    .addCookieAuth(ACCESS_COOKIE)
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, openApi);
  SwaggerModule.setup(DOCS_PATH, app, document, {
    useGlobalPrefix: true,
    jsonDocumentUrl: `${DOCS_PATH}-json`,
  });

  app.enableShutdownHooks();
}

/** Creates the fully configured (not yet listening) application. */
export async function createApp(env: ApiEnv): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bufferLogs: true,
    bodyParser: false,
  });
  configureApp(app, env);
  return app;
}

/**
 * Standalone application context (no HTTP server) for scripts such as the seed: every service
 * (boards, operations, templates…) can be resolved with `ctx.get(Service)`. Call `ctx.close()`.
 */
export async function createAppContext(env: ApiEnv): Promise<INestApplicationContext> {
  const ctx = await NestFactory.createApplicationContext(AppModule.forRoot(env), {
    bufferLogs: true,
  });
  ctx.useLogger(ctx.get(Logger));
  ctx.enableShutdownHooks();
  return ctx;
}
