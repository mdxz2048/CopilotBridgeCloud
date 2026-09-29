# Copilot Bridge Cloud

Modular-monolith cloud service for Copilot Bridge Desktop. The server owns accounts, devices, subscriptions, model access, AI Gateway, usage, billing orders, releases, and administration. Desktop owns local files and tool execution.

## Start Desktop integration now

```powershell
pnpm install
pnpm dev:mock
```

The mock API listens on `http://127.0.0.1:3001` and has no database dependency. Use `desktop@example.test` / `MockDesktop123!`, a stable random UUID for `device.deviceId`, and model `mock/mock-chat`. Override the test password with `MOCK_DESKTOP_PASSWORD`. This environment is bound to loopback and is reset on restart.

Contract: [Gateway API](docs/protocol/GATEWAY_API_V1.md), [Desktop Integration](docs/protocol/DESKTOP_INTEGRATION.md), [OpenAPI 3.1](docs/protocol/openapi.v1.json), [Zod schemas](packages/contract/src/schemas.ts). Regenerate OpenAPI with `pnpm contract:generate`.

V2 App/Server contract `2.2.0`: [API contract](docs/api-v2.md) (sole V2 wire authority), [architecture](docs/architecture-v2.md), [billing](docs/billing-v2.md), [database](docs/database-v2.md), [migration](docs/migration-v2.md), and [deployment status](docs/deployment-v2.md). The corresponding additive Zod shapes are in [v2-schemas.ts](packages/contract/src/v2-schemas.ts). The [production integration manifest](docs/protocol/PRODUCTION_INTEGRATION_MANIFEST.md) records the 2026-09-29 API/Web and `0004` rollout (isolated DB 14/14, production gated-Mock SHADOW smoke); source archive SHA-256 is recorded there pending a commit mapping. Copilot OAuth is `NOT_AUTHENTICATED`, real payment and Desktop release remain unavailable, and production V2 point billing is not enabled. The website QR is test activation information, not a payment method.

## Development

1. Copy `.env.example` to `.env` and set database URL and random secrets. Set `PUBLIC_BASE_URL=http://localhost:3000` for browser CSRF checks.
2. Start PostgreSQL, then run `pnpm --filter @bridge/db migrate` and `pnpm --filter @bridge/api seed`.
3. Set plan prices and limits through seed environment variables or the Admin UI. Seeded plans stay disabled until all limits are set.
4. Run `pnpm dev` for API and Web. Website: `http://localhost:3000`.
5. Create the first administrator with `ADMIN_BOOTSTRAP_EMAIL` and a password of at least 16 characters. The CLI accepts the password on stdin or from `ADMIN_BOOTSTRAP_PASSWORD`. Do not pass the password as a CLI argument or save it in the repository. The production terminal recipe is in [Deployment](docs/DEPLOYMENT.md).

DeepSeek requires an API key entered in Admin. The Copilot Provider is disabled pending an approved GitHub integration and commercial authorization review. WeChat and Alipay interfaces are reserved and reject order creation until connected.

Production integration can optionally enable `INTEGRATION_MOCK_ENABLED=true` with a dedicated `INTEGRATION_MOCK_TEST_EMAIL`. A one-off CLI configures the hidden Pro fixture, Mock provider, and user-only model access after that account registers. The production model gate rejects Mock requests from every other account. The loopback Mock server remains the default Desktop development path.

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
