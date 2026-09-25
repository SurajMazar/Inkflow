#!/bin/sh
# Container entrypoint.
#   (no arguments)  apply migrations (unless SKIP_MIGRATIONS=true), then run the API
#   migrate         apply migrations and exit (Kubernetes Job, ECS one-off task, Cloud Run job)
#   <command…>      run an arbitrary command (e.g. `node dist/seed/seed.js`)
# The API runs as PID 1 via exec so SIGTERM reaches Node and triggers graceful shutdown.
set -eu

migrate() {
  cd /app/packages/database
  node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
  cd /app
}

if [ "$#" -gt 0 ]; then
  if [ "$1" = "migrate" ]; then
    migrate
    exit 0
  fi
  exec "$@"
fi

if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  migrate
fi
exec node apps/api/dist/main.js
