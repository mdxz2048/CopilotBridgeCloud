#!/bin/sh
set -eu
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${V2_MIGRATION_BACKUP_VERIFIED:?Verify a fresh production backup first}"
export DATABASE_URL="postgres://bridge:${POSTGRES_PASSWORD}@postgres:5432/bridge"
pnpm --filter @bridge/db migrate
