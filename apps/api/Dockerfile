# syntax=docker/dockerfile:1
# Inkflow API image. Build context = repository root:
#   podman build -f apps/api/Dockerfile -t inkflow-api .
ARG NODE_VERSION=24

FROM docker.io/library/node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# OpenSSL is required by the Prisma query engine.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /repo

# ─── build: install with the lockfile, build the workspace packages the API depends on + the API ───
FROM base AS build
COPY . .
RUN corepack install \
 && pnpm install --frozen-lockfile --filter "@inkflow/api..." --filter inkflow
# Sequential builds keep peak memory low (tsup DTS builds are memory hungry).
RUN pnpm --workspace-concurrency=1 --filter "@inkflow/api..." run build \
 && tar -cf /tmp/dist.tar apps/api/dist $(ls -d packages/*/dist)

# ─── prod: fresh production-only install + the build output ───
FROM base AS prod
COPY . .
RUN corepack install \
 && pnpm install --frozen-lockfile --prod --filter "@inkflow/api..."
COPY --from=build /tmp/dist.tar /tmp/dist.tar
RUN tar -xf /tmp/dist.tar && rm /tmp/dist.tar \
 && pnpm --filter @inkflow/database exec prisma generate \
 && rm -rf apps/web e2e \
 && find packages apps -maxdepth 2 -name src -type d -prune -exec rm -rf {} + \
 && chmod +x apps/api/docker-entrypoint.sh

# ─── runtime ───
FROM docker.io/library/node:${NODE_VERSION}-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=prod --chown=node:node /repo /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Applies pending migrations (prisma migrate deploy), then starts the API.
ENTRYPOINT ["/app/apps/api/docker-entrypoint.sh"]
