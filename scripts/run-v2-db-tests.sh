#!/bin/sh
set -eu
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${V2_TEST_DB_NAME:?V2_TEST_DB_NAME is required}"
case "$V2_TEST_DB_NAME" in
  bridge_v2_test_*) ;;
  *) echo 'Refusing to run V2 DB tests on a non-test database' >&2; exit 2 ;;
esac
export DATABASE_URL="postgres://bridge:${POSTGRES_PASSWORD}@postgres:5432/${V2_TEST_DB_NAME}"
export V2_TEST_DATABASE_URL="$DATABASE_URL"
export NODE_ENV=test
pnpm --filter @bridge/api exec vitest run src/v2.db.test.ts
