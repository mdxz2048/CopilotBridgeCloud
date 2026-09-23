#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")/.."
dc() {
  if [ "${SHARED_HOST:-0}" = "1" ]; then
    docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.shared-host.yml "$@"
  else
    docker compose --env-file .env.production -f docker-compose.yml "$@"
  fi
}
mkdir -p backups
chmod 700 backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="backups/.bridge-${stamp}.dump.tmp"
trap 'rm -f "$tmp"' EXIT
dc exec -T postgres pg_dump -U bridge -d bridge -Fc > "$tmp"
dc exec -T postgres pg_restore -l < "$tmp" > /dev/null
mv "$tmp" "backups/bridge-${stamp}.dump"
trap - EXIT
find backups -maxdepth 1 -type f -name 'bridge-*.dump' -mtime +7 -delete
echo "Backup written: backups/bridge-${stamp}.dump"
