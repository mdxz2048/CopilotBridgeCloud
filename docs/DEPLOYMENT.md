# Production deployment

## Current installation (2026-09-24)

The service is installed at `https://ai.mddxz.top` on `linuxuser@66.245.221.236` in `/home/linuxuser/copilot-bridge-cloud/src`. The domain resolves to this server. Existing Nginx owns public ports 80 and 443 and terminates TLS with a Certbot certificate (expiry 2026-12-22). Its dedicated `ai.mddxz.top` virtual host proxies to this project's Caddy on `127.0.0.1:14880`. Caddy, Web, API and a dedicated PostgreSQL 17 volume run under Docker Compose with the shared-host override. No project database or Caddy port is exposed publicly. The other Nginx sites are left in place.

The public home page, `/health`, `/api/v1/plans`, registration, browser login, authenticated account, RBAC rejection, logout, and public page layouts were tested over HTTPS. Production plans remain disabled until prices and limits are chosen. The administrator was bootstrapped and authenticated; DeepSeek key, Copilot authorization, and payment integrations remain outstanding. Additive V2 domain migrations and API/Web commit `d02a961f83e3af3f6b788f04ae0f4757f3775ed8` are deployed with `V2_BILLING_ENABLED=false`; see [V2 migration record](V2_MIGRATION_AND_ROLLBACK.md) and [Release Gate](acceptance/SERVER_RELEASE_GATE.md).

For Desktop production integration, a dedicated test account has a hidden Pro fixture and a server-gated Mock model. See the [Integration Manifest](protocol/PRODUCTION_INTEGRATION_MANIFEST.md) and [four-axis gate](acceptance/PRODUCTION_INTEGRATION_GATE.md). The fixed loopback Mock password and `X-Mock-Error-Code` are unavailable in production. The integration gate is explicitly enabled only for the named test email in the server-only environment file. Disable `INTEGRATION_MOCK_ENABLED` and the Mock provider after real-provider acceptance.

## Deploy and inspect

Connect using the existing SSH configuration. Do not read, print, copy or commit the SSH private key. On the server:

```bash
cd /home/linuxuser/copilot-bridge-cloud/src
sudo docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.shared-host.yml ps
curl -fsS https://ai.mddxz.top/health
```

The production `.env.production` is server-only, mode `0600`. It contains random database, token and provider encryption secrets and `PUBLIC_BASE_URL=https://ai.mddxz.top`. Never commit it. Review the `PUBLIC_*_BIND` values before running Compose: the shared host must bind only to loopback. Build and start this project with:

```bash
sudo docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.shared-host.yml up -d --build
```

The API container runs forward migrations and idempotent seeds on start. Before upgrading, take a backup. Retain the previous images for rollback until the new release passes smoke checks. If rollback is needed, restore the previous image and code artifact, run Compose again, and restore the database backup only if the migration is incompatible. Database restore replaces current data and therefore requires an explicit maintenance decision.

## Administrator bootstrap

The production administrator `zhipeng2048@gmail.com` was created and browser authentication plus V2 Admin read endpoints passed over HTTPS on 2026-09-24. Its randomly generated password is stored outside the repository in the current Windows user's DPAPI file `C:\Users\HP\.codex\bridge-cloud-admin.dpapi`. Never print or commit it. For a fresh installation, bootstrap an administrator **in an interactive SSH terminal**:

```bash
cd /home/linuxuser/copilot-bridge-cloud/src
ADMIN_BOOTSTRAP_EMAIL=zhipeng2048@gmail.com SHARED_HOST=1 bash scripts/create-admin.sh
```

The script prompts without echo and requires at least 16 characters. Enter a new password there. The password is piped to the one-off API CLI and is neither a command argument nor saved in `.env.production`. Do not send it in chat. The CLI refuses an existing email. Sign in at `https://ai.mddxz.top/login` and visit `/admin` to configure plans, provider keys, models and releases.

## Backups and restore

The daily backup task runs `scripts/backup.sh` with `SHARED_HOST=1` and stores custom-format PostgreSQL dumps in `backups/`. The script removes dumps older than seven days. Verify every scheduled run and monitor disk space; copy backups off this host before treating the service as production ready. To take a manual backup:

```bash
cd /home/linuxuser/copilot-bridge-cloud/src
sudo env SHARED_HOST=1 sh scripts/backup.sh
sudo docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.shared-host.yml exec -T postgres pg_restore -l < backups/bridge-YYYYMMDDTHHMMSSZ.dump >/dev/null
```

To restore, stop API and Web traffic, select a verified dump, then run `sudo env SHARED_HOST=1 sh scripts/restore.sh backups/bridge-YYYYMMDDTHHMMSSZ.dump --yes`. Start the services and repeat the health, login and account smoke checks. Restore is intentionally destructive to current database contents.

## Release smoke checks

Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm contract:generate` and `pnpm test:e2e` locally. For production public pages, set `PROD_BASE_URL=https://ai.mddxz.top` and run `pnpm test:e2e`. Validate the HTTPS certificate, `/health`, register/login/logout, dashboard, authorized Admin, device login, model list, response, usage, billing, restart persistence and backup recovery before promoting the release. The current release does not pass all of these checks.
