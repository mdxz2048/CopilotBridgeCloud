#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ADMIN_BOOTSTRAP_EMAIL:?Set ADMIN_BOOTSTRAP_EMAIL to the administrator email}"
IFS= read -r -s -p 'New administrator password (at least 16 characters): ' admin_password </dev/tty
printf '\n' >/dev/tty
trap 'unset admin_password' EXIT
if [ "${#admin_password}" -lt 16 ]; then
  echo 'Password must contain at least 16 characters.' >&2
  exit 2
fi
if [ "${SHARED_HOST:-0}" = '1' ]; then
  compose_files=(-f docker-compose.yml -f docker-compose.shared-host.yml)
else
  compose_files=(-f docker-compose.yml)
fi
printf '%s\n' "$admin_password" | sudo -n docker compose --env-file .env.production "${compose_files[@]}" run --rm -T -e ADMIN_BOOTSTRAP_EMAIL="$ADMIN_BOOTSTRAP_EMAIL" api node apps/api/dist/cli/create-admin.js
