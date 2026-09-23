#!/bin/sh
set -eu
if [ "${2:-}" != "--yes" ] || [ ! -f "${1:-}" ]; then
  echo "Usage: scripts/restore.sh backups/bridge-YYYYMMDDTHHMMSSZ.dump --yes" >&2
  exit 2
fi
cd "$(dirname "$0")/.."
dc() {
  if [ "${SHARED_HOST:-0}" = "1" ]; then
    docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.shared-host.yml "$@"
  else
    docker compose --env-file .env.production -f docker-compose.yml "$@"
  fi
}
dc exec -T postgres pg_restore -U bridge -d bridge --clean --if-exists < "$1"
echo "Restore complete. Restart services and run smoke checks."
