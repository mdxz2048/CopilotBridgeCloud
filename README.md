# Copilot Bridge Cloud

Development handoff: [Console checkpoint (2026-09-30)](docs/CONSOLE_DEVELOPMENT_STATUS_2026-09-30.md).

## Development state after V2.4 (not deployed)

The next console iteration separates USER `/dashboard` from ADMIN `/admin`. The
user landing page shows only the signed-in account status, referral count,
wallet balance, active device count, and Desktop download. Admin can inspect
per-user devices, referrals, payment/point history, provider onboarding,
30-day model usage and aggregate public-page views. The browser submits
anonymous page-view counts for five public pages; these are not unique
visitors or raw access logs.

Admin release upload streams a Windows `.exe` (512 MiB maximum) to
`RELEASE_STORAGE_DIR` (default `~/.bridge-cloud/releases`, outside the source
tree), computes SHA-256, and creates an **unpublished** release. A
published file is served by its release ID; an unpublished file returns 404.
Compose mounts the persistent `bridge_releases` volume. Check host disk space,
reverse-proxy upload limits, migration `0009`, and download smoke tests before
deploying. These changes are not evidence of a production release.

The planned commercial product is usage-priced without monthly fees or
periodic point grants. Legacy subscriptions, periodic grants and monthly
quotas still gate the currently staged server; billing remains SHADOW in
production and actual charging and online payments are not enabled. The
public pricing page no longer presents legacy test prices as a purchasable
monthly plan. Do not turn on commercial charging until the entitlement and
payment migration is designed, tested and explicitly approved.

Modular-monolith cloud service for Copilot Bridge Desktop. The server owns accounts, devices, subscriptions, model access, AI Gateway, usage, billing orders, releases, and administration. Desktop owns local files and tool execution.

## Start Desktop integration now

```powershell
pnpm install
pnpm dev:mock
```

The mock API listens on `http://127.0.0.1:3001` and has no database dependency. Use `desktop@example.test` / `MockDesktop123!`, a stable random UUID for `device.deviceId`, and model `mock/mock-chat`. Override the test password with `MOCK_DESKTOP_PASSWORD`. This environment is bound to loopback and is reset on restart.

Contract: [Gateway API](docs/protocol/GATEWAY_API_V1.md), [Desktop Integration](docs/protocol/DESKTOP_INTEGRATION.md), [OpenAPI 3.1](docs/protocol/openapi.v1.json), [Zod schemas](packages/contract/src/schemas.ts). Regenerate OpenAPI with `pnpm contract:generate`.

V2 App/Server contract `2.4.0` (email and Turnstile endpoints deployed but disabled; Desktop device login remains V2.3 compatible): [API contract](docs/api-v2.md), [architecture](docs/architecture-v2.md), [billing](docs/billing-v2.md), [database](docs/database-v2.md), [migration](docs/migration-v2.md), and [deployment status](docs/deployment-v2.md). The corresponding Zod shapes are in [v2-schemas.ts](packages/contract/src/v2-schemas.ts). The [production integration manifest](docs/protocol/PRODUCTION_INTEGRATION_MANIFEST.md) records the staged 2026-09-30 V2.4 API/Web release and the prior DPoP/low-limit rollout with exact image/source digests. Old Gateway V1 artifacts remain frozen but unsigned requests no longer authenticate. Copilot OAuth is `NOT_AUTHENTICATED`, real payment and Desktop release remain unavailable, and production point billing is not enabled. The website QR is test activation information, not a payment method.

## Development

1. Copy `.env.example` to `.env` and set database URL and random secrets. Set `PUBLIC_BASE_URL=http://localhost:3000` for browser CSRF checks.
2. Start PostgreSQL, then run `pnpm --filter @bridge/db migrate` and `pnpm --filter @bridge/api seed`.
3. Set plan prices and limits through seed environment variables or the Admin UI. Seeded plans stay disabled until all limits are set.
4. Run `pnpm dev` for API and Web. Website: `http://localhost:3000`.
5. Create the first administrator with `ADMIN_BOOTSTRAP_EMAIL` and a password of at least 16 characters. The CLI accepts the password on stdin or from `ADMIN_BOOTSTRAP_PASSWORD`. Do not pass the password as a CLI argument or save it in the repository. The production terminal recipe is in [Deployment](docs/DEPLOYMENT.md).

DeepSeek requires an API key entered in Admin. The Copilot Provider is disabled pending an approved GitHub integration and commercial authorization review. WeChat and Alipay interfaces are reserved and reject order creation until connected.

Production integration can optionally enable `INTEGRATION_MOCK_ENABLED=true` with a dedicated `INTEGRATION_MOCK_TEST_EMAIL`. A one-off CLI configures the hidden Pro fixture, Mock provider, and user-only model access after that account registers. The production model gate rejects Mock requests from every other account. The loopback Mock server remains the default Desktop development path.

### Website verification code deployed, activation pending

The V2.4 API/Web adds short-lived emailed registration codes and server-verified Cloudflare Turnstile to website registration and login. The existing widget's **public site key** `0x4AAAAAAFJ9gF00MwfmQypQ` is recorded in `.env.example`; it is not a secret. Private Turnstile and Resend SMTP settings are in the server-only production environment, with `STAGED_EMAIL_REGISTRATION_ENABLED=false`; they are not in this repository. Cloudflare recognized the secret when presented with an intentionally invalid test token; Resend SMTP accepted non-code test messages to the owner's address from both the temporary sender and `admin@ai.mddxz.top`. Neither check verifies a real widget token, inbox receipt or general-user delivery. The deployed website still uses the legacy **unverified** email/password registration flow while the flag is off. Do not describe current production accounts as email-verified. The Desktop website-only signup entry remains an unpublished candidate; the existing Desktop installer has not been updated.

The existing widget authorizes `mddxz.top`, which also covers `ai.mddxz.top`. The server-only `.env.production` is mode `0600` with `TURNSTILE_EXPECTED_HOSTNAME=ai.mddxz.top` and `SMTP_FROM=admin@ai.mddxz.top`. The owner reported partial Resend domain verification and SMTP accepted a test send to the owner; test delivery to other real recipients before enforcing registration. Administrator **网站配置** can override public settings, replace encrypted private keys and edit the registration-email subject/body (plain text with required `{{code}}`) without restarting. API GET never returns private keys, and USER requests receive 403. Saving does not turn on verification: `STAGED_EMAIL_REGISTRATION_ENABLED` remains a server-managed release gate. Rotate private keys disclosed outside private server configuration before activating. Validate real widget tokens for both `registration_email_code` and `web_login`, plus registration-email delivery, before turning the gate on. Migration `0008` was verified in an isolated database (6/6 registration/admin integration tests) and applied in production.

## Verification

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Playwright uses installed Chrome locally and saves screenshots in `artifacts/screenshots`. Real PostgreSQL, provider, payment, and production smoke checks are tracked in [Server Release Gate](docs/acceptance/SERVER_RELEASE_GATE.md).

## Deployment

See [Deployment](docs/DEPLOYMENT.md). `docker-compose.yml` provides API, Web, PostgreSQL, and Caddy. On a shared host with an existing Nginx listener, use `docker-compose.shared-host.yml` and loopback port bindings; Nginx retains public TLS. Production secrets belong only in `.env.production` and are never committed.
