# Deployment

Inkflow ships as two container images (API and web) plus PostgreSQL, Redis, S3-compatible object
storage and an SMTP relay. Everything is configured through environment variables validated at
startup (`packages/config/src/env.ts`); the API refuses to boot with invalid or placeholder
production secrets.

## Topology

```text
            ┌──────────── HTTPS (TLS terminated at your load balancer / ingress) ───────────┐
Browser ───▶│  web (nginx: SPA + /api reverse proxy incl. WebSocket upgrade)                 │
            └──────────────┬─────────────────────────────────────────────────────────────────┘
                           ▼
              api × N (NestJS, stateless; sticky sessions NOT required)
               │        │          │             │
        PostgreSQL    Redis    S3 / MinIO      SMTP
       (source of   (pub/sub,  (images,     (verification,
         truth)     presence,  thumbnails)   resets, invites)
                    rate limits)
```

API instances are stateless: board operations are serialized by PostgreSQL row locks and fanned
out through Redis pub/sub, so any instance can serve any request or socket.

## Building images

From the repository root (Podman or Docker):

```bash
podman build -f apps/api/Dockerfile -t inkflow-api:latest .
```

```bash
podman build -f apps/web/Dockerfile -t inkflow-web:latest .
```

The API image runs as a non-root user and applies pending migrations (`prisma migrate deploy`)
before starting. To run migrations as a separate release step instead, run the same image with
`pnpm --filter @inkflow/database migrate:deploy` and start the API with `node apps/api/dist/main.js`.

## Required configuration (production)

| Variable                                                                                         | Notes                                                                                                            |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV=production`                                                                            | Enables production validation and secure defaults                                                                |
| `WEB_ORIGIN`                                                                                     | Public origin of the web app, e.g. `https://inkflow.example.com` (CORS, links in emails, WebSocket origin check) |
| `PUBLIC_API_URL`                                                                                 | Public API base, e.g. `https://inkflow.example.com/api` (OAuth callbacks)                                        |
| `DATABASE_URL`                                                                                   | PostgreSQL 15+ connection string (use `sslmode=require` for managed databases)                                   |
| `REDIS_URL`                                                                                      | Redis 6+ (`rediss://` for TLS)                                                                                   |
| `JWT_SECRET`, `SESSION_SECRET`                                                                   | ≥ 32 random characters each (`openssl rand -base64 48`); never reuse between environments                        |
| `COOKIE_SECURE=true`                                                                             | Required behind HTTPS                                                                                            |
| `TRUST_PROXY=true`                                                                               | When behind a load balancer (correct client IPs for rate limits)                                                 |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_FORCE_PATH_STYLE` | Omit `S3_ENDPOINT` for AWS S3; keep the bucket private (files are served through the API with permission checks) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM`                   | Transactional email                                                                                              |
| `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`                                             | Optional OAuth; callback URLs are `${PUBLIC_API_URL}/auth/oauth/{google,github}/callback`                        |

Optional tuning: `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`,
`AUTO_VERSION_EVERY_OPS`, `AUTO_VERSION_EVERY_MINUTES`, `TRASH_RETENTION_DAYS`,
`ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`, `LOG_LEVEL`.

## Database migrations

- Development: `pnpm db:migrate` (creates and applies migrations with `prisma migrate dev`).
- Production: `pnpm db:migrate:deploy` (applies committed migrations only; never generates new ones).
- Migrations are forward-only SQL files in `packages/database/prisma/migrations`. Back up before
  upgrading (`pg_dump --format=custom`), and apply migrations before rolling out new API instances.

## Health checks & operations

- `GET /api/health`: liveness (process up).
- `GET /api/health/ready`: readiness; checks PostgreSQL, Redis and S3 and returns 503 when any is
  down. Use it for load balancer and orchestrator probes.
- Logs are structured JSON (pino) with request ids; secrets, cookies and passwords are redacted.
- Graceful shutdown: on SIGTERM the API stops accepting connections, closes WebSockets with
  "going away" (clients reconnect to another instance), drains Redis and PostgreSQL connections.
- Background jobs (trash purge, operation-log compaction) run on one instance at a time using
  PostgreSQL advisory locks.

## Scaling notes

- Scale API instances horizontally; WebSockets need no stickiness.
- PostgreSQL: the hot tables are `board_elements` (PK `(board_id, element_id)`) and
  `board_operations` (unique `(board_id, seq)`); both are indexed for per-board access. Operation
  logs are compacted automatically.
- Redis memory is small (presence hashes with TTLs, rate-limit counters, pub/sub).
- Serve the web image behind a CDN; hashed assets are cached immutably, `index.html` is not cached.

## Security checklist

- HTTPS everywhere with `COOKIE_SECURE=true`; HSTS at the edge.
- Strong, unique `JWT_SECRET` / `SESSION_SECRET` (rotating them signs everyone out).
- Private S3 bucket; database and Redis not publicly reachable.
- Keep the default rate limits (or stricter) on authentication endpoints.
- Configure SPF/DKIM for `MAIL_FROM`.
