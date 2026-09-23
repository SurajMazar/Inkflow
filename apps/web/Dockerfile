# syntax=docker/dockerfile:1.7
#
# Inkflow web client. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t inkflow-web .
#   podman build -f apps/web/Dockerfile -t inkflow-web .
# Serves the static SPA on :8080 and proxies /api (HTTP + WebSocket) to http://api:4000.

############################
# 1) Build
############################
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NODE_ENV=production
RUN corepack enable
WORKDIR /repo

# Fetch every dependency into the store using only the lockfile (cached layer).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm fetch --frozen-lockfile

# Install the web app and the workspace packages it depends on (offline, from the store).
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    NODE_ENV=development pnpm install --offline --frozen-lockfile --filter "@inkflow/web..."

# Workspace packages resolve to their TypeScript sources through the `source` export condition.
RUN pnpm --filter @inkflow/web exec vite build

############################
# 2) Serve
############################
FROM nginx:alpine AS runtime
LABEL org.opencontainers.image.title="inkflow-web" \
      org.opencontainers.image.description="Inkflow collaborative whiteboard — web client"
RUN rm -f /etc/nginx/conf.d/default.conf
COPY apps/web/nginx.conf /etc/nginx/conf.d/inkflow.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
