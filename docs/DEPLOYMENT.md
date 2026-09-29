# Production deployment

## Current installation (updated 2026-09-29)

On 2026-09-29, the incremental `0004` device migration and latest API/Web images were deployed after **14/14 isolated-DB tests**. Production health, Admin reads, gated Mock JSON/SSE/tool continuation, SHADOW settlement without wallet debit and API restart persistence passed. The exact build source was tar archive SHA-256 `26047678958dc76f6280cf3e39d0aa08f75529f5d03f79254b7042a74f388c12`; later commit `6cea3f8233ecb4aebe09bca6d910e9365ea9b576` records matching runtime code plus documentation and a browser test correction. See [deployment-v2.md](deployment-v2.md) and the [production manifest](protocol/PRODUCTION_INTEGRATION_MANIFEST.md) for migration and image evidence. The 2026-09-24 installation below remains historical and does not identify this newer release.

For this release the user explicitly waived a **new production DB backup**. Previous API/Web Docker tags remain available for image rollback, **not** for restoring pre-migration data. About **1.58 GB** remained on disk afterward: clean up and recheck free space before the next build. Copilot OAuth is `NOT_AUTHENTICATED`, production remains `SHADOW` with `ENFORCED` disabled, real payment is unconnected, the website QR is test activation information rather than a payment method, and the Desktop release endpoint returns `null`.

### Initial 2026-09-24 installation (historical)

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

The production `.env.production` is server-only, mode `0600`. It contains random database, token and provider encryption secrets and `PUBLIC_BASE_URL=https://ai.mddxz.top`. Never commit it. Review the `PUBLIC_*_BIND` values before running Compose: the shared host must bind only to loopback. **Do not run the following command as a read-only check:** preflight disk, validate pending migrations on a dedicated database and decide on a verified backup before building. The API auto-migrates on startup. Only after those gates, build and start this project with:

```bash
sudo docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.shared-host.yml up -d --build
```

The API container runs forward migrations and idempotent seeds on start. `0004` was already applied on 2026-09-29. Before a future upgrade, validate any new migration on a dedicated database and normally take a verified backup; the explicit 2026-09-29 waiver did not provide a database restore point. Retain the previous API **and** Web images for rollback until the new release passes smoke checks. If rollback is needed, switch both services to the retained images and code artifact, run Compose again, and consider database restore only with a suitable verified dump and an explicit data-loss decision. Docker image rollback alone cannot undo a migration.

## Administrator bootstrap

The production administrator `zhipeng2048@gmail.com` was created and browser authentication plus V2 Admin read endpoints passed over HTTPS on 2026-09-24. Its randomly generated password is stored outside the repository in the current Windows user's DPAPI file `C:\Users\HP\.codex\bridge-cloud-admin.dpapi`. Never print or commit it. For a fresh installation, bootstrap an administrator **in an interactive SSH terminal**:

```bash
cd /home/linuxuser/copilot-bridge-cloud/src
ADMIN_BOOTSTRAP_EMAIL=zhipeng2048@gmail.com SHARED_HOST=1 bash scripts/create-admin.sh
```

The script prompts without echo and requires at least 16 characters. Enter a new password there. The password is piped to the one-off API CLI and is neither a command argument nor saved in `.env.production`. Do not send it in chat. The CLI refuses an existing email. Sign in at `https://ai.mddxz.top/login` and visit `/admin` to configure plans, provider keys, models and releases.

## Backups and restore

The daily backup task runs `scripts/backup.sh` with `SHARED_HOST=1` and stores custom-format PostgreSQL dumps in `backups/`. The script removes dumps older than seven days. **No new DB backup was taken for the 2026-09-29 migration by explicit user decision; do not assume a scheduled dump is a verified same-release restore point.** Verify every scheduled run and monitor disk space; copy backups off this host before treating the service as production ready. To take a manual backup:

```bash
cd /home/linuxuser/copilot-bridge-cloud/src
sudo env SHARED_HOST=1 sh scripts/backup.sh
sudo docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.shared-host.yml exec -T postgres pg_restore -l < backups/bridge-YYYYMMDDTHHMMSSZ.dump >/dev/null
```

To restore, stop API and Web traffic, select a verified dump, then run `sudo env SHARED_HOST=1 sh scripts/restore.sh backups/bridge-YYYYMMDDTHHMMSSZ.dump --yes`. Start the services and repeat the health, login and account smoke checks. Restore is intentionally destructive to current database contents.

## Release smoke checks

Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm contract:generate` and `pnpm test:e2e` locally. For production public pages, set `PROD_BASE_URL=https://ai.mddxz.top` and run `pnpm test:e2e`. Validate the HTTPS certificate, `/health`, register/login/logout, dashboard, authorized Admin, device login, model list, response, usage, billing, restart persistence and backup recovery before promoting the release. The 2026-09-29 isolated-DB 14/14 and production gated-Mock/API/Web smoke passed; full real-provider, payment and backup-recovery acceptance has **not** passed.
