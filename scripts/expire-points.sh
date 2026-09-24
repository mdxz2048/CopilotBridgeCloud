#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ "${SHARED_HOST:-0}" = "1" ]; then
  docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.shared-host.yml exec -T api node /workspace/apps/api/dist/cli/expire-points.js
else
  docker compose --env-file .env.production -f docker-compose.yml exec -T api node /workspace/apps/api/dist/cli/expire-points.js
fi
