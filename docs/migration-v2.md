# V2 database migration and rollback

Contract version `2.1.0`. The V2 migrations are additive: `packages/db/migrations/0001_abandoned_shotgun.sql` creates the domain tables, plan/device fields, constraints and immutable-ledger triggers; `0002_heavy_makkari.sql` pins the rate-card version on each AI request and makes the final event unique per request; `0003_motionless_quasimodo.sql` adds expiring wallet lots, spend allocations and immutability guards. They do **not** delete or reinterpret `usage_records`, subscription rows, existing device UUIDs, provider credentials, or Gateway V1 contract data. Historical V1 usage remains legacy usage; neither point debits nor provider costs are inferred from it.

## Migration gate

1. Keep `V2_BILLING_MODE=SHADOW` and `V2_BILLING_ENABLED=false`. Verify both pinned OpenAPI SHA-256 values in the production manifest.
2. Build the new API image without replacing the running API. Apply V1 then V2 migrations to an isolated empty PostgreSQL database; run real DB tests for ledger concurrency, idempotency, subscription grant, rate pinning, disconnect and provider failure. Repeat on a sanitized copy of production when available.
3. Take and verify a fresh custom-format production dump using `scripts/backup.sh`. Retain the prior API image ID and current source commit. Check free disk space and the shared host's Nginx/Caddy bindings.
4. Apply any forward migration using the API startup `pnpm --filter @bridge/db migrate`. Deploy with `V2_BILLING_MODE=SHADOW` and `V2_BILLING_ENABLED=false`; run `/health`, auth, device, `/v1/models`, Mock JSON/SSE/tool continuation, account/usage, Shadow settlement, dashboard, Admin and backup smoke checks.
5. Before `0003`, verify no preexisting V2 wallet credits lack lots. Production currently has zero V2 wallet transactions and no nonzero wallets; other environments need reconciliation/backfill if they have earlier credits. Configure exactly one active rate version per billable provider/model/policy, grant wallet points through audited subscription or Admin flows, and validate a real provider's reported usage/cost. `rollover_policy=NONE` requires the `0003` migration, lot-aware code and hourly expiry timer.
6. Enable `ENFORCED` only for a controlled real-provider cohort after the preceding checks and App contract review. The current mode is global; cohort selection is pending, so leave public production in `SHADOW`.

Migrations `0001` and `0002` were executed successfully on the dedicated empty database `bridge_v2_test_0924` on 2026-09-24. The first real-DB run caught a missing rate-version column; the second migration fixed it. Seven PostgreSQL integration tests passed, including concurrent debit, devices, grants, rate pinning, disconnect/error settlement, referral review and Admin adjustment/publish. A production custom-format backup `backups/bridge-20260924T025320Z.dump` was verified (`0600`, 118 archive-list lines), then both migrations were applied to production with the old API still running. Four user rows and 55 legacy usage rows remained. API/Web source commit `d02a961f83e3af3f6b788f04ae0f4757f3775ed8` was deployed; `V2_BILLING_ENABLED=false`. Public V1 JSON/SSE/tool continuation, production Admin read routes and public Playwright passed. Migration `0003` passed eight PostgreSQL integration tests on isolated database `bridge_v2_test_0924b`. The full Drizzle migration chain and the same eight tests passed on a second fresh database `bridge_v2_test_0924c`. Production backup `backups/bridge-20260924T034328Z.dump` was verified (0600, 210 archive-list lines); production had no earlier V2 wallet transactions or nonzero balances. Migration `0003`, API/Web source `b669b60acb49cdc95bee526c75ff3cefbc60f1bc`, and the hourly expiry timer were deployed with V2 billing disabled. Public Desktop Mock, V2 read, Admin, restart persistence and Web Playwright checks passed. This is an additive deployment, not a point-billing launch.

## Data integrity and reconciliation

- `usage_events.request_id` and `event_key` are unique, and the database rejects event updates/deletes.
- `wallet_transactions.idempotency_key` is unique, its rows are immutable, and wallet mutation is serialized with `SELECT FOR UPDATE`.
- `rate_card_versions` allows only one active version per card. Published rate numbers cannot be edited; old versions remain referenced by historical events.
- An `UNPAID` usage event retains the rated amount without debiting a negative wallet; further V2 requests are blocked pending resolution.
- Query `wallets.balance` against both the sum of immutable transactions and the sum of remaining wallet lots after deploying `0003`. Investigate mismatches; do not rewrite history.

## Rollback

With `V2_BILLING_MODE=SHADOW`, set the mode to `OFF` or revert the API image to the recorded `src-api:v2-b669b60` tag and restore its matching source artifact. Leave additive V2 tables and columns in place; the older code ignores them. Re-run V1 and V2 read smoke tests and check both contract hashes. **Do not run a destructive down migration.**

## V2.1 Shadow deployment record, 2026-09-24

The full migration chain and 10 PostgreSQL invariants passed on an isolated disposable database. No new SQL migration was required for `SHADOW`; the existing `billing_status` field accepts it. A private custom-format production backup `backups/bridge-20260924T071531Z.dump` was verified before API rollout. API source `0cb3307d9fce0ea8a5bf8ffef43e00364abf1738` was deployed with `V2_BILLING_MODE=SHADOW` and `V2_BILLING_ENABLED=false`; Web, Caddy and PostgreSQL images were unchanged. The dedicated test account received an idempotent 10000-point `TEST_GRANT` through the wallet ledger. Production HTTPS Shadow settlement rated 1 point, charged 0, and preserved the 10000-point wallet, including after an API restart. `backups/bridge-20260924T072700Z.dump` succeeded after rollout.

During the Docker image build, free disk reached zero and PostgreSQL restarted before automatic recovery. Obsolete tagged images and dangling build layers were removed; the four services were healthy with about 3.5 GB free after cleanup. Require a free-space preflight before any further image build.

If `ENFORCED` has written wallet/usage events, first set the mode to `OFF` and stop new billed requests. Export the affected request IDs, usage events and wallet ledger; decide how to settle/refund open `UNPAID` events through new compensating transactions. Revert code only after confirming the V1 entitlement behavior required for the affected users. Restoring a full database dump would discard post-backup users, orders and usage, so it is a separate maintenance decision with an explicit data-loss assessment. Existing production backups are stored on the host; an off-host copy is still required before commercial launch.

## Remaining release work

Finish native progressive provider streaming with observed partial usage, referral/payment risk controls, monetary point valuation for revenue/margin, and one real provider E2E. DeepSeek BYOS validation/routing and Admin V2 Web panels are implemented, but no real key E2E exists. DeepSeek managed key and real payment merchant parameters are absent; Copilot requires user authorization. These are release blockers, not fields to guess in the Desktop manifest.
