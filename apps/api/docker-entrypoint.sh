#!/bin/sh
# Container entrypoint: apply database migrations, then run the API (PID 1 via exec so SIGTERM
# reaches Node and triggers the graceful shutdown hooks).
set -eu
cd /app/packages/database
node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
cd /app
exec node apps/api/dist/main.js
