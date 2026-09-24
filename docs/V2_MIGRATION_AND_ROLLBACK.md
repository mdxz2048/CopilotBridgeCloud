# V2 database migration and rollback

The V2 migration is additive: `packages/db/migrations/0001_abandoned_shotgun.sql`. It creates V2 domain tables, adds `plans.monthly_points`, `plans.rollover_policy`, and `devices.updated_at`, plus constraints and immutable-ledger triggers. It does **not** delete or reinterpret `usage_records`, subscription rows, existing device UUIDs, provider credentials, or Gateway V1 contract data. Historical V1 usage remains legacy usage; neither point debits nor provider costs are inferred from it.

## Migration gate

1. Keep `V2_BILLING_ENABLED` unset/false. Verify the V1 `PRODUCTION_INTEGRATION_MANIFEST.md` and its pinned OpenAPI SHA-256 are unchanged.
2. Build the new API image without replacing the running API. Apply V1 then V2 migrations to an isolated empty PostgreSQL database; run real DB tests for ledger concurrency, idempotency, subscription grant, rate pinning, disconnect and provider failure. Repeat on a sanitized copy of production when available.
3. Take and verify a fresh custom-format production dump using `scripts/backup.sh`. Retain the prior API image ID and current source commit. Check free disk space and the shared host's Nginx/Caddy bindings.
4. Apply the forward migration using the API startup `pnpm --filter @bridge/db migrate`. Deploy with `V2_BILLING_ENABLED=false`; run `/health`, auth, device, `/v1/models`, Mock JSON/SSE/tool continuation, account/usage, dashboard, Admin and backup smoke checks.
5. Configure exactly one active rate version per billable provider/model/policy, grant wallet points through audited subscription or Admin flows, and validate a real provider's reported usage/cost. Set `monthly_points>0` only with `rollover_policy=UNLIMITED` until point-lot expiration is built.
6. Enable V2 billing only for a controlled real-provider cohort after the preceding checks and App contract review. The current flag is global; cohort selection is pending, so leave it false in public production until that control exists.

The V2 migration was executed successfully on the dedicated empty database `bridge_v2_test_0924` on 2026-09-24. This proves SQL syntax and DDL order, not financial service behavior or production compatibility. The production database has not yet been migrated as of this document's creation.

## Data integrity and reconciliation

- `usage_events.request_id` and `event_key` are unique, and the database rejects event updates/deletes.
- `wallet_transactions.idempotency_key` is unique, its rows are immutable, and wallet mutation is serialized with `SELECT FOR UPDATE`.
- `rate_card_versions` allows only one active version per card. Published rate numbers cannot be edited; old versions remain referenced by historical events.
- An `UNPAID` usage event retains the rated amount without debiting a negative wallet; further V2 requests are blocked pending resolution.
- Query `wallets.balance` against the sum of each wallet's immutable transactions after deployment. Investigate mismatches; do not rewrite history.

## Rollback

With `V2_BILLING_ENABLED=false`, revert the API/Web image to the recorded prior V1 image and restore the matching source artifact. Leave additive V2 tables and columns in place; V1 code ignores them. Re-run V1 smoke tests and check the gateway contract hash. **Do not run a destructive down migration.**

If V2 billing has been enabled and written wallet/usage events, first disable the flag and stop new V2 requests. Export the affected request IDs, usage events and wallet ledger; decide how to settle/refund open `UNPAID` events through new compensating transactions. Revert code only after confirming the V1 entitlement behavior required for the affected users. Restoring a full database dump would discard post-backup users, orders and usage, so it is a separate maintenance decision with an explicit data-loss assessment. Existing production backups are stored on the host; an off-host copy is still required before commercial launch.

## Remaining release work

Implement enforceable non-rollover point lots, BYOS credential validation and trusted routing, native progressive provider streaming with observed partial usage, referral/payment risk controls, monetary point valuation for revenue/margin, Admin Web pages, and one real provider E2E. DeepSeek key and real payment merchant parameters are absent; Copilot requires user authorization. These are release blockers, not fields to guess in the Desktop manifest.
